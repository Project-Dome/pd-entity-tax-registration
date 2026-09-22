# Especificação — Consulta de CNPJ Multi-Provedor (ReceitaWS + BrasilAPI)

Feature incremental sobre o módulo já documentado em `docs/specs/entity-tax-registration.md`. Esta spec cobre só o que muda: adição do ReceitaWS como provedor primário de consulta de CNPJ, com fallback automático para a BrasilAPI (já existente), controle de limite de consultas por minuto, e um novo registro de configuração de APIs.

## 1. Objetivo

- Consultar o ReceitaWS **antes** da BrasilAPI em toda busca de CNPJ do módulo; se o ReceitaWS falhar ou estiver sem cota, cair automaticamente para a BrasilAPI.
- Respeitar o limite de 3 consultas por minuto do plano contratado do ReceitaWS, sem estourar a cota antes de cair para o fallback.
- Centralizar token, limite de consultas e demais parâmetros das duas APIs num novo registro de configuração local a este projeto (não usar a "Product Configuration" central da Dome nem o bundle `pd_p_netsuite_tools`, ambos usados pelo projeto de referência `pd-p-cnpj-integration`).
- Mover toda chamada às APIs externas para o servidor: o Client Script deixa de chamar `https.get` direto do navegador (o token do ReceitaWS não pode circular no client-side).

## 2. Arquitetura

### Visão geral

| Serviço | Novo/Existente | Responsabilidade |
|---|---|---|
| `pd-petr-cnpj-lookup.js` | **Novo** | Orquestrador: decide ReceitaWS→BrasilAPI, aplica rate limit, chama os dois serviços de API e devolve o resultado já adaptado ao shape canônico. |
| `pd-petr-receitaws-api.js` | **Novo** | Chamada HTTP crua ao ReceitaWS (`GET https://receitaws.com.br/v1/cnpj/{cnpj}`), autenticada com Bearer token lido do novo registro de configuração. |
| `pd-petr-receitaws-adapter.js` | **Novo** | Converte o JSON do ReceitaWS para o shape canônico (= shape da BrasilAPI, o mesmo que `pd-petr-mapper.js`/`pd-petr-validators.js` já consomem hoje). |
| `pd-petr-api-settings.js` | **Novo** | Lê/cacheia o novo registro `customrecord_pd_petr_api_settings` — mesmo padrão de `pd-petr-validation-settings.js` (cache em variável de módulo; sem registro ativo → `null`; sem enforcement de singleton, é convenção de uso). |
| `pd-petr-rate-limiter.js` (util) | **Novo** | Contador em `N/cache`, janela fixa de 60s, usado só para o ReceitaWS. Também calcula quanto tempo falta para a janela resetar, usado na mensagem de erro específica de rate limit (ver §4). |
| `pd-petr-cnpj-api.js` | Existente | Sem alteração de contrato — continua chamando só a BrasilAPI. |
| `pd-petr-mapper.js` | Existente, **1 alteração pontual** | `insertAddress`: quando `codigo_municipio_ibge` não vier no JSON (sempre o caso quando o provedor foi o ReceitaWS), resolve a cidade por `municipio` + `uf` em `customrecord_ftebr_city`, portando a lógica de `pd-pcnpj-suitesuccess-city.service.js` do projeto de referência, usando o util local `pd-petr-search-data.js` (não `pd/search` do bundle externo). Resto do arquivo não muda. |
| `pd-petr-entity.js` | Existente, **3 call sites trocados** | `fetchCNPJ`, `fetchCNPJForRecord` e `manageCsvImport` passam a chamar `pd-petr-cnpj-lookup.js` em vez de `pd-petr-cnpj-api.js` diretamente. |
| Client Script | Existente, **fluxo simplificado** | `fetchCNPJ()` do client script sempre delega para `fetchCNPJViaRestlet` (mesmo caminho hoje usado só no modo view) — não há mais `https`/`cnpjApiService` chamado do browser em nenhum modo. |

### Fluxo do orquestrador — `pd-petr-cnpj-lookup.getCompanyData(cnpj)`

```
1. settings = pd-petr-api-settings.get()
   → sem registro configurado: retorna { success:false, error:'Nenhum provedor de consulta habilitado. Configure o registro de Configuração das APIs.' }

2. Se settings.rwsEnabled:
   a. hasQuota = pd-petr-rate-limiter.consume('pd_petr_rws', settings.rwsRateLimit, 60)
      → sem cota: NÃO chama o ReceitaWS. rateLimited = true. Segue para o passo 3.
   b. Se hasQuota: chama pd-petr-receitaws-api.get(cnpj, settings)
      - HTTP 200 e body.status === 'OK' → data = pd-petr-receitaws-adapter.toCanonical(body)
        → retorna { success:true, provider:'RECEITAWS', data:data }
      - HTTP 429 → loga o motivo. rateLimited = true. Segue para o passo 3.
        (o 429 consome a chamada mesmo sem sucesso — é a rede de segurança contra o cache não-transacional;
        é o próprio ReceitaWS sinalizando estouro de cota, mesmo com o contador local achando que havia cota)
      - HTTP != 200 (outro código), body.status === 'ERROR', exceção/timeout → loga o motivo. rateLimited = false.
        Segue para o passo 3.

3. Se settings.brasilApiEnabled:
   a. chama pd-petr-cnpj-api.get(cnpj)
      - HTTP 200 → retorna { success:true, provider:'BRASILAPI', data: JSON.parse(response.body) }
      - HTTP != 200 ou exceção → segue para o passo 4

   Senão (BrasilAPI desabilitada) e rateLimited === true (decisão confirmada nesta especificação — caso
   especial, ver §4):
      retryAfterSeconds = pd-petr-rate-limiter.getRetryAfterSeconds(60)
      → retorna { success:false, reason:'RATE_LIMIT_NO_FALLBACK', retryAfterSeconds:retryAfterSeconds,
                  error:'Limite de <N> consultas por minuto do ReceitaWS atingido e o provedor BrasilAPI
                  está desabilitado. Aguarde aproximadamente <retryAfterSeconds> segundos e tente novamente.' }
      (<N> = settings.rwsRateLimit)

4. Nenhum provedor respondeu (ou nenhum habilitado, ou BrasilAPI habilitada mas também falhou) → retorna
   { success:false, reason:'NO_PROVIDER_AVAILABLE',
     error:'Não foi possível consultar os dados do CNPJ em nenhum provedor disponível.' }
```

O shape canônico devolvido em `data` é **idêntico ao da BrasilAPI hoje** — é o que `pd-petr-mapper.setFields(record, data)` e `pd-petr-validators.validateApiResponse(data)` já esperam, sem qualquer alteração nesses dois arquivos além da já citada em `insertAddress`.

### Contrato do adapter — `pd-petr-receitaws-adapter.toCanonical(body)`

| Campo canônico (= shape BrasilAPI) | Origem no ReceitaWS | Observação |
|---|---|---|
| `cnpj` | `body.cnpj` | — |
| `razao_social` | `body.nome` | ReceitaWS chama de "nome" o que a BrasilAPI chama de "razão social" |
| `nome_fantasia` | `body.fantasia` | — |
| `descricao_situacao_cadastral` | `body.situacao` | Consumido por `validateApiResponse` sem alteração |
| `logradouro`, `numero`, `complemento`, `bairro`, `cep`, `uf` | campos de mesmo nome | — |
| `municipio` | `body.municipio` | BrasilAPI também tem este campo (hoje não lido pelo mapper — passa a ser lido só como fallback, ver §4) |
| `codigo_municipio_ibge` | *(nunca preenchido)* | ReceitaWS não retorna código IBGE — ver limitação em §4 |
| `email` | `body.email` | — |
| `ddd_telefone_1` | `body.telefone` (primeiro número, se houver mais de um separado por `/`) | `formatPhone()` do mapper já normaliza qualquer formatação via *strip* de não-dígitos — não precisa pré-formatar aqui |
| `ddd_telefone_2`, `ddd_fax` | *(nunca preenchidos)* | ReceitaWS clássico só tem um campo de telefone e nenhum de fax |
| `opcao_pelo_simples` | `body.simples.optante === true` | — |
| `opcao_pelo_mei` | `body.simei.optante === true` | — |
| `regime_tributario` | `[]` (sempre vazio) | Ver limitação de Regime Tributário em §4 — `resolveTaxRegimeLabel` do mapper já prioriza `opcao_pelo_mei`/`opcao_pelo_simples` antes de olhar este array, então a limitação é automática, sem precisar tocar no mapper |
| `qsa` | `body.qsa` | Não mapeado para nenhum campo hoje (mesmo comportamento da BrasilAPI) — só aparece em log de debug |

Se `body.status === 'ERROR'`, o adapter não é chamado — o orquestrador trata como falha usando `body.message` no log.

## 3. Telas / Interfaces

Novo registro de configuração, mesmo padrão visual do já existente "Configuração das Validações":

**"PD | PETR | Configuração das APIs de Consulta"** (`customrecord_pd_petr_api_settings`)

| Grupo | Campo | Tipo | Default |
|---|---|---|---|
| ReceitaWS | Habilitar ReceitaWS | Checkbox | Marcado |
| ReceitaWS | Token ReceitaWS | Password | — |
| ReceitaWS | Limite de Consultas por Minuto | Inteiro | 3 |
| BrasilAPI | Habilitar BrasilAPI | Checkbox | Marcado |

Sem campo de ordem — a ordem ReceitaWS → BrasilAPI é fixa no código (decisão confirmada nesta especificação, ver §4).

## 4. Critérios e regras de negócio

- **Ordem fixa:** ReceitaWS é sempre tentado primeiro quando habilitado; BrasilAPI é sempre o fallback. Não é configurável via UI — só o habilitar/desabilitar de cada um.
- **Provedor desabilitado:** pulado sem tentativa de chamada (não conta contra o rate limit, não gera log de erro — é comportamento esperado, não falha).
- **Rate limit do ReceitaWS:** contador em `N/cache`, janela fixa de 60 segundos, limite configurável (default 3). Antes de chamar o ReceitaWS, verifica se ainda há cota — sem cota, pula direto para a BrasilAPI sem gastar a chamada. Mesmo com cota aparentemente disponível, se a chamada real retornar HTTP 429, também cai para a BrasilAPI (rede de segurança contra concorrência, já que o contador em cache não é transacional).
- **Ambos os provedores falham ou estão desabilitados** (decisão confirmada nesta especificação):
  - Client Script (botão "Consultar CNPJ" e autofetch no save, em create/edit e em view via RESTlet): dialog de erro ao usuário, nada é salvo automaticamente — mesmo comportamento de hoje quando só a BrasilAPI falhava. O restante do cadastro continua podendo ser salvo manualmente pelo usuário.
  - RESTlet (`fetchCNPJForRecord`): devolve `{ success:false, error:'...' }` — mesmo contrato de hoje; quem exibe o erro é o Client Script que chamou.
  - CSV Import (`manageCsvImport`): loga o erro e segue sem enriquecer — não pode abortar a importação do registro, mesmo comportamento de hoje.
- **Caso especial: ReceitaWS falhou especificamente por rate limit E a BrasilAPI está desabilitada** (decisão confirmada nesta especificação, refinando a regra genérica acima): em vez da mensagem genérica de "nenhum provedor disponível", o usuário recebe uma mensagem explicando a causa exata e quanto tempo falta até haver cota novamente — ex.: *"Limite de 3 consultas por minuto do ReceitaWS atingido e o provedor BrasilAPI está desabilitado. Aguarde aproximadamente 42 segundos e tente novamente."*
  - Vale tanto para o caso em que o limite foi detectado **preventivamente** pelo contador local (`pd-petr-rate-limiter`, sem sequer chamar o ReceitaWS) quanto para o caso em que a chamada foi feita e o **próprio ReceitaWS respondeu HTTP 429**.
  - Só se aplica quando a causa da falha do ReceitaWS foi rate limit — se o ReceitaWS falhou por outro motivo (erro de rede, timeout, `status: "ERROR"`, HTTP diferente de 429/200) com a BrasilAPI desabilitada, a mensagem continua sendo a genérica de "nenhum provedor disponível", sem menção a tempo de espera.
  - Se a BrasilAPI estiver **habilitada**, esse caso especial não se aplica mesmo com rate limit no ReceitaWS — o fluxo cai para a BrasilAPI normalmente (fallback padrão) e só vira erro (genérico) se a BrasilAPI também falhar.
  - "Tempo que falta" é calculado a partir da janela fixa de 60s do rate limiter (`getRetryAfterSeconds`), não é um valor armazenado — pode variar de 1 a 60 segundos dependendo de quando dentro do minuto corrente a tentativa aconteceu.
- **Limitação de Regime Tributário quando o ReceitaWS responde** (decisão confirmada nesta especificação — limitação aceita): o ReceitaWS não tem equivalente ao histórico `regime_tributario` (Lucro Presumido/Lucro Real) da BrasilAPI, só um booleano de opção pelo Simples/MEI. Quando o ReceitaWS é quem respondeu com sucesso, o campo Regime Tributário só pode resolver para "Optante pelo Simples Nacional" ou ficar em branco — nunca "Lucro Presumido"/"Lucro Real", mesmo que a empresa seja uma delas. Não há chamada adicional à BrasilAPI só para compensar esse campo.
- **Resolução de cidade quando vem do ReceitaWS:** sem `codigo_municipio_ibge`, a cidade é resolvida por `municipio` + `uf` em `customrecord_ftebr_city` (busca por fórmula SQL, normalizando acentos — portada de `pd-pcnpj-suitesuccess-city.service.js`). Se não encontrar cidade correspondente, o campo fica em branco (mesmo comportamento de hoje quando o código IBGE não resolve).

## 5. Registros e campos envolvidos

**Novo custom record** — `customrecord_pd_petr_api_settings` ("PD | PETR | Configuração das APIs de Consulta"):

| Campo | scriptid | Tipo |
|---|---|---|
| Habilitar ReceitaWS | `custrecord_pd_petr_as_rws_enabled_cb` | Checkbox |
| Token ReceitaWS | `custrecord_pd_petr_as_rws_token_pw` | Password |
| Limite de Consultas por Minuto (ReceitaWS) | `custrecord_pd_petr_as_rws_rate_limit_nu` | Integer Number |
| Habilitar BrasilAPI | `custrecord_pd_petr_as_bra_enabled_cb` | Checkbox |

Todos os scriptids conferidos contra o limite de 40 caracteres (o mais longo, `custrecord_pd_petr_as_rws_rate_limit_nu`, tem 39). Abreviação `rws`/`bra` para ReceitaWS/BrasilAPI confirmada nesta especificação.

**Novos Objects de suporte ao record:**
- `custform_pd_petr_as` — entry form, mesmo padrão de `custform_pd_petr_vs.xml` (grupos "ReceitaWS", "BrasilAPI", "Informações do Sistema").
- `customsearch_pd_petr_as_list` — saved search de listagem, **criada na UI do NetSuite e importada** (não escrita à mão, mesma regra já aplicada em `customsearch_pd_petr_vs_list`).

**Custom records existentes (dependências externas, não recriados aqui):**
- `customrecord_ftebr_city` — passa a ser consultado também por `municipio`+`uf` (campo nativo `name`, formato `"{Cidade} - {UF}"`), além da consulta por `custrecord_ftebr_city_i_ibge_code` já existente.

**Nenhuma alteração** em `custentity_brl_entity_t_fed_tax_reg`, `custentity_brl_entity_t_int_tax_reg`, `custentity_pd_petr_country_ls`, `customrecord_pd_petr_validation_settings` ou seus campos.

## 6. Contratos de scripts

**`pd-petr-cnpj-lookup.js`** (novo, `service/`)
- `getCompanyData(cnpj)` → sucesso: `{ success: true, provider: 'RECEITAWS'|'BRASILAPI', data: <canônico> }`. Falha: `{ success: false, error: string, reason: 'RATE_LIMIT_NO_FALLBACK'|'NO_PROVIDER_AVAILABLE', retryAfterSeconds?: number }` — `error` já vem com a mensagem final pronta para exibir ao usuário (inclusive a mensagem específica de rate limit do §4); `reason`/`retryAfterSeconds` existem só para log/telemetria, os 3 call sites não precisam ramificar sobre eles, só exibir/logar `error`. Nunca lança exceção — toda falha de rede/timeout é capturada internamente (mesmo padrão dos services HTTP existentes).

**`pd-petr-receitaws-api.js`** (novo, `service/`)
- `get(cnpj, options)` → devolve o `response` cru de `https.get` (`{ code, body }`), `options.token` vindo de `pd-petr-api-settings` (opcional — ver §4/§5, é a API Pública gratuita do ReceitaWS, sem autenticação). Sem `timeout` explícito — usa o default do `N/https`, mesmo padrão do resto do módulo. Mesmo padrão de retorno de `pd-petr-cnpj-api.js` (não faz `JSON.parse`, não trata erro de negócio — só a chamada HTTP).

**`pd-petr-receitaws-adapter.js`** (novo, `service/`)
- `toCanonical(body)` → objeto no shape canônico (tabela do §2). Função pura, sem I/O.

**`pd-petr-api-settings.js`** (novo, `service/`)
- `get()` → `{ rwsEnabled, rwsToken, rwsRateLimit, brasilApiEnabled }` ou `null` se não houver registro ativo. Cache em variável de módulo, mesmo padrão de `pd-petr-validation-settings.get()`.

**`pd-petr-rate-limiter.js`** (novo, `util/`)
- `consume(key, limit, windowInSeconds)` → `boolean`. Incrementa o contador em `N/cache` (chave = `key` + bucket do minuto corrente) e devolve `true` se o incremento ainda ficou dentro do `limit`, `false` caso já estivesse no limite (e, nesse caso, **não** incrementa).
- `getRetryAfterSeconds(windowInSeconds)` → `integer`. Calcula quantos segundos faltam para o fim da janela corrente (`windowInSeconds - (epochSeconds % windowInSeconds)`) — cálculo puro baseado no relógio, não precisa ler o cache nem da `key`, então serve tanto para o caso em que o `consume` bloqueou preventivamente quanto para o caso de HTTP 429 vindo do próprio ReceitaWS.

**`pd-petr-entity.js`** (existente — assinaturas de `fetchCNPJ`, `fetchCNPJForRecord`, `manageCsvImport` não mudam; muda só a implementação interna, trocando a chamada a `cnpjApiService.get` por `cnpjLookupService.getCompanyData` e ajustando o tratamento de retorno para o novo formato `{success, provider, data, error}`).

**Client Script `pd-petr-entity-tax-registration.cl.js`** (existente)
- `fetchCNPJ()` deixa de checar `getRecordMode` para decidir entre chamada direta e RESTlet — sempre chama `entityService.fetchCNPJViaRestlet(rec)`. `entityService.fetchCNPJ(currentRecord)` (chamado hoje também no `saveRecord`, modo create/edit) é **removido** como caminho de chamada de API — o autofetch do save também passa a ir pelo RESTlet.

## 7. Fluxo de status

Não aplicável — mesma natureza pontual (consulta síncrona por CNPJ) do módulo original.

## 8. Permissões

Mesmo padrão do restante do módulo: `customrecord_pd_petr_api_settings` com `accesstype=CUSTRECORDENTRYPERM` (igual ao Validation Settings), deployments dos scripts com `allroles=T`. O campo Token (tipo Password) usa `accesslevel=2` como os demais campos do registro — não há papel/permissão nova neste módulo além do que a conta já usa para "Custom Record Entries".

## 9. Fora de escopo

- Rate limit para a BrasilAPI — nenhum limite foi informado para ela; um HTTP 429 nela é tratado como falha genérica (não há um terceiro provedor para cair).
- Campo de ordem configurável entre os provedores (decisão confirmada nesta especificação — ordem fixa no código).
- Mapeamento de `qsa`/sócios de qualquer um dos dois provedores (já fora de escopo no módulo original).
- Uso do array `atividades_secundarias`/`cnaes_secundarios` de qualquer provedor (não há campo de destino no NetSuite para isso hoje).
- Bloquear o save do registro (Client Script) ou a linha do CSV Import quando os dois provedores falharem — decisão confirmada nesta especificação de manter o comportamento atual (avisar/logar, não bloquear).

## 10. Notas de implementação

- **Popup de "Aguarde" travado na tela (não desaparecia).** Causa raiz: em `fetchCompanyDataViaRestlet` e `fetchCNPJViaRestlet`, a chamada `url.resolveScript(...)` ficava **fora** do `try/catch` — qualquer exceção ali subia sem ser capturada, pulando direto o `loadingMessage.hide()` da linha seguinte. Popup ficava preso pra sempre, e em silêncio (sem dialog de erro nenhum, já que a exceção também não era tratada por quem chamou). Corrigido com `try/finally`: `finally` garante o `hide()` independente de sucesso, falha tratada ou exceção — e `fetchCompanyDataViaRestlet` passou a envolver `url.resolveScript` também no seu próprio try, nunca mais lançando exceção pra quem chama. Adicionado também `duration: 30000` no `.show()` como rede de segurança extra (o `hide()` explícito continua sendo o caminho normal).

- **Feedback visual durante a consulta (pedido do usuário, fora da spec original).** A chamada síncrona ao RESTlet (botão em create/edit, autofetch no save, e modo view) travava a tela sem indicativo de progresso. Adicionado `N/ui/message` (mesmo padrão do projeto de referência `pd-p-cnpj-integration`) em `pd-petr-entity.js`: `showLoadingMessage()` exibe "Aguarde! Consultando dados do CNPJ..." antes da chamada e esconde logo que a resposta volta (sucesso ou erro), nos três pontos que chamam o RESTlet.

- **Popup de "Aguarde" escondido cedo demais em respostas rápidas (não dava tempo de aparecer na tela).** Reportado pelo usuário depois da correção do item acima. Causa: em `fetchCNPJ`, o `loadingMessage.hide()` rodava no `finally` logo após `fetchCompanyDataViaRestlet(value)` retornar — antes de checar `result.success`, mostrar o dialog de erro ou chamar `mapperService.setFields`. Quando a resposta do RESTlet volta rápido, `show()` e `hide()` aconteciam quase no mesmo instante, sem o navegador ter tempo de pintar a mensagem: na prática o popup "não aparecia". Mesmo problema em `fetchCNPJViaRestlet` (modo view), com o `hide()` no `finally` logo após o `https.post`. Corrigido movendo todo o tratamento do resultado (dialog de erro, `setFields`, ou `window.location.reload()`) para **dentro** do bloco `try`, deixando só o `loadingMessage.hide()` no `finally` — assim o popup só desaparece depois que o fluxo realmente termina (erro tratado ou valores já setados/página recarregando), não logo após a resposta HTTP chegar.

- **`N/cache.put`/`get` exige `ttl` mínimo de 300 segundos.** Erro real em teste: `Input value ttl must be greater than or equal to 300`. O código passava `windowInSeconds * 2` (120, para janela de 60s) — abaixo do mínimo. `pd-petr-rate-limiter.js` agora usa `Math.max(300, windowInSeconds * 2)`; isso não afeta a contagem, já que a chave do cache inclui o número do bucket (minuto corrente) — um ttl maior só deixa a chave antiga ociosa por mais tempo antes de ser descartada. Aproveitando, `consume()` ganhou um `try/catch`: antes, qualquer falha do `N/cache` (como esse erro) subia como exceção e **impedia até o fallback para a BrasilAPI**, o oposto do comportamento pretendido — agora uma falha no cache é logada e tratada como "há cota" (o HTTP 429 do provedor continua sendo a rede de segurança real).

- **Por que o contador de rate limit fica em `N/cache` e não num custom record** (questionado e reconfirmado durante a implementação): o cache usa `cache.Scope.PUBLIC`, que a documentação da Oracle define como *"all server scripts in your NetSuite account"* — é compartilhado pela conta inteira, **não é por usuário nem por sessão**. Dois usuários diferentes incrementam o mesmo contador, e como o rate limiter só roda server-side (RESTlet/User Event), não há cache por navegador envolvido.

  O ponto mais importante: o limite do ReceitaWS é **por endereço IP**, e as chamadas saem pelo pool de IPs do próprio NetSuite, compartilhado com outras contas. Logo, **nenhum contador local — cache ou custom record — consegue ser exato**: nosso número conta as chamadas desta conta, o do ReceitaWS conta as daquele IP. Trocar para custom record ganharia durabilidade (o cache do NetSuite é best-effort e pode descartar antes do TTL) e auditoria, mas **não resolveria a concorrência** (ler-e-gravar registro tem a mesma corrida do cache, só um lock resolveria) e custaria governança em toda consulta. Decisão: manter o cache como otimização barata para evitar chamadas obviamente perdidas, com o **HTTP 429 do provedor como rede de segurança real** — ele é a única autoridade sobre o próprio limite.

- **`N/cache` é server-only — exigiu separar um arquivo novo (`pd-petr-entity-lookup.js`).** Erro em produção ao abrir um Customer/Vendor: `Invalid define call; unable to load module: .../pd-petr-rate-limiter: Module does not exist: N/cache.js`. Causa: o Client Script importa `pd-petr-entity.js`, que importava `pd-petr-cnpj-lookup.js` → `pd-petr-rate-limiter.js` → `N/cache`. O carregamento de módulos AMD é **eager** (tudo listado no `define()` é resolvido no load, mesmo que a função nunca seja chamada), então o navegador tentava carregar `N/cache`, que só existe no runtime server-side do NetSuite — e quebrava antes de qualquer código rodar, apesar de nenhum caminho client-side chamar o rate limiter.

  Correção: as três funções server-only (`fetchCNPJForRecord`, `fetchCompanyDataForCnpj`, `manageCsvImport`) saíram de `pd-petr-entity.js` para o novo `service/pd-petr-entity-lookup.js`, importado **só** pelo RESTlet e pelo User Event. `pd-petr-entity.js` (o arquivo que o Client Script carrega) não referencia mais `pd-petr-cnpj-lookup` nem `N/record` (que só era usado pelo `fetchCNPJForRecord`). Os helpers privados pequenos (`isNullOrEmpty`, `digitsOnly`, `isBrazil`, `validateFederalRegistrationFormat` e as constantes de mensagem) estão duplicados nos dois arquivos — são wrappers finos sobre `validatorsService`/`scriptParametersService`, não lógica de negócio duplicada. Regra a manter daqui pra frente: **nada que o Client Script importe pode depender, nem transitivamente, de módulo server-only**.

- **Busca de cidade por nome+UF (`lookupCityInternalIdByNameAndUf`) quebra ao rodar no Client Script.** Erro em teste real (CNPJ sem `codigo_municipio_ibge`, caso típico do ReceitaWS): `WRONG_PARAMETER_TYPE: Tipo de parâmetro incorreto: filters é esperado como Array.`, lançado dentro do próprio `N/search` do navegador (client-side), ao montar o filtro com `search.createFilter()` (formula `formulatext`) misturado com `'AND'` no array de `filters` — um padrão totalmente válido *server-side*, mas que o parser de filtros do `N/search` client-side não aceita (rejeita o `Filter` já construído como se não fosse um array, no meio da recursão do parser). O erro já era capturado internamente (log + `return null`), então não travava a consulta, mas dessa forma nenhum aviso chegava ao usuário nem a Cidade era preenchida.

  Causa raiz identificada com o usuário a partir dos logs: `pd-petr-cep-api.js` (chamado logo antes, dentro do `insertAddress`, só para completar rua/bairro pelo CEP) **já devolve um código IBGE** (`ibge.city`) — dado que não estava sendo aproveitado. Correção: `resolveCityInternalId(json, uf, cep)` agora tenta, nesta ordem, (1) `codigo_municipio_ibge` do próprio provedor (só a BrasilAPI), (2) `cep.ibge.city` da consulta de CEP já feita, e só então (3) a busca por nome+UF (mantida como último recurso — continua sujeita à limitação client-side acima, mas deixa de ser o caminho principal para CNPJs com CEP válido, que é a imensa maioria).

- **Falha ao completar o endereço automaticamente não era comunicada ao usuário (só ficava no log).** Reportado pelo usuário depois do item acima, com uma segunda mensagem de erro (`"Digite valor(es) para: Cidade do Brasil"`, capturada no `try/catch` de `insertAddress`): quando a Cidade não é resolvida e o campo é obrigatório no subrecord de endereço, o `commitLine` falha; o `catch` já existia e evitava que isso abortasse a consulta, mas o problema ficava só no log de execução — o usuário via os outros dados preenchidos sem saber que o endereço ficou incompleto. Corrigido fazendo `insertAddress`/`setFields` devolverem um aviso (`{title, message}`) nesses casos (Cidade não identificada, ou subrecord de endereço indisponível), exibido via `dialog.alert` tanto no fluxo client-side (`pd-petr-entity.js`, botão/autofetch) quanto no modo view (`pd-petr-entity-lookup.js`, priorizando o aviso de qualidade de dados já existente quando os dois ocorrem juntos). CSV Import continua só logando (fluxo sem UI para o usuário reagir).

- **Campos de Timeout removidos** (decisão do usuário: nunca foi necessário configurar isso em nenhum outro script do projeto, o timeout padrão do `N/https` sempre foi suficiente — escopo que eu tinha adicionado por conta própria como parte de "outros parâmetros", sem ter sido pedido). Removidos de tudo: `custrecord_pd_petr_as_rws_timeout_nu` e `custrecord_pd_petr_as_bra_timeout_nu` (Object e entry form), `rwsTimeoutSeconds`/`brasilApiTimeoutSeconds` (constants, `pd-petr-api-settings.js`, `pd-petr-cnpj-lookup.js`). `pd-petr-cnpj-api.js` voltou exatamente ao estado original (`get(cnpj)`, sem `options`) — a extensão que eu tinha feito nele só existia para sustentar esse campo. `pd-petr-receitaws-api.js` manteve `get(cnpj, options)`, mas `options` agora só carrega `token`.

  Os dois campos já tinham sido deployados na conta antes dessa decisão — `suitecloud project:deploy` não deleta objects/campos removidos do XML local, só cria/atualiza o que está presente. **Já apagados manualmente pelo usuário na UI** antes do redeploy desta mudança.

- **O redesenho do fluxo create/edit via RESTlet (§2/§6) tinha um problema de correção que só apareceu na implementação**: reaproveitar `fetchCNPJViaRestlet` (por `id`, carrega+salva no servidor, dá `window.location.reload()`) também para o autofetch do `saveRecord` em modo create/edit quebraria de duas formas — em modo *create* ainda não existe `id` (o `record.load` do RESTlet falharia) e em modo *edit* faria um `entityRecord.save()` no servidor no meio do `saveRecord` do cliente, correndo contra o save nativo do NetSuite que continua na sequência.

  Correção adotada: o RESTlet ganhou uma **segunda ação**, despachada pelo corpo da requisição — por `id` (comportamento existente, exclusivo do modo view) ou por `cnpj` (nova, usada em create/edit). A ação por `cnpj` só roda `cnpjLookupService.getCompanyData(cnpj)` e devolve o resultado, sem tocar em nenhum record — quem preenche os campos continua sendo o Client Script, via `mapperService.setFields` local, exatamente como antes. Isso preserva o comportamento de "enriquecimento entra na mesma transação de save" que já existia, e move só a chamada HTTP com o token para o servidor (que é o requisito real por trás da decisão "Client Script deixa de chamar as APIs direto do navegador").

  Na prática isso significa que **o Client Script (`pd-petr-entity-tax-registration.cl.js`) não precisou de nenhuma alteração** — a função `fetchCNPJ(rec, mode)` em `pd-petr-entity.js` já decidia internamente entre os dois caminhos, e passou a decidir entre as duas ações do RESTlet do mesmo jeito. Foram adicionadas `fetchCompanyDataViaRestlet(cnpj)` (client-side, chama a ação nova) e `fetchCompanyDataForCnpj(cnpj)` (server-side, exposta pro RESTlet) em `pd-petr-entity.js`.

## Checklist de implementação

- [x] Parte 1 — Object: `customrecord_pd_petr_api_settings` + campos
- [x] Parte 2 — Object: `custform_pd_petr_as` (entry form)
- [ ] Parte 3 — Object: `customsearch_pd_petr_as_list` (saved search, criada na UI e importada) — **pendente**: só pode ser criada na UI do NetSuite depois que o record estiver deployado na conta; ver instruções abaixo.
- [x] Parte 4 — Service: `pd-petr-api-settings.js`
- [x] Parte 5 — Util: `pd-petr-rate-limiter.js`
- [x] Parte 6 — Service: `pd-petr-receitaws-api.js`
- [x] Parte 7 — Service: `pd-petr-receitaws-adapter.js`
- [x] Parte 8 — Service: `pd-petr-cnpj-lookup.js` (orquestrador)
- [x] Parte 9 — `pd-petr-mapper.js`: fallback de cidade por município+UF
- [x] Parte 10 — `pd-petr-entity.js`: trocar os 3 call sites para o orquestrador (desenho revisado — ver seção 10)
- [x] Parte 11 — Atualizar `<description>` dos Objects de deployment (RL/UE/CL) para refletir o multi-provedor
- [ ] Parte 12 — Revisão final: validar em sandbox se o campo Password (`custrecord_pd_petr_as_rws_token_pw`) é legível via `record.getValue` no server-side (RESTlet/UE) — se não for, trocar para Free-Form Text com `accesslevel` restrito

## Status do deploy

Deployado na conta **11953512 — "Demo Account" (rótulo interno da CLI: `(PRODUCTION) Project Dome`)** em 2026-09-21, branch `start-integration-WSCNPJ`, via `suitecloud project:deploy`. Apesar do apelido "Demo Account", o rótulo de tipo de conta impresso pela CLI no log de instalação é `PRODUCTION` — tratar como ambiente de produção real a partir daqui.

1. **`SUBSCRIPTIONBILLING` — resolvido.** Declarado `required="false"` (em vez de `true`) no manifest, já que não havia confirmação de que a conta tem esse módulo contratado. Deploy passou limpo com essa mudança.
2. **Atributo `standard` do `custform_pd_petr_as.xml` — confirmado correto.** `STANDARDCUSTOMRECORD_PD_PETR_API_SETTINGSFORM` (calculado por analogia, não verificado antes) deployou sem erro — `custform_pd_petr_as` foi criado normalmente.
3. **Parte 3 (saved search) — ainda pendente.** Agora que `customrecord_pd_petr_api_settings` já existe na conta, criar na UI a saved search de listagem (filtro `isinactive = F`, colunas Internal ID + Habilitar ReceitaWS + Habilitar BrasilAPI, ID customizado = `customsearch_pd_petr_as_list`) e importar com `suitecloud object:import --type savedsearch --scriptid customsearch_pd_petr_as_list --destinationfolder /Objects`.
4. **Parte 12 — ainda pendente.** Verificar nesta mesma conta (já que é onde o registro foi deployado) se `custrecord_pd_petr_as_rws_token_pw` (tipo Password) é legível via `record.getValue`/busca no server-side. Como o registro já existe, dá para testar diretamente: criar o registro de configuração preenchendo o token, e checar via log em `pd-petr-api-settings.get()` se `rwsToken` vem preenchido.
5. **Registro de configuração ainda não existe** — `pd-petr-api-settings.get()` vai devolver `null` até alguém criar o registro `PD | PETR | Configuração das APIs` na conta (token do ReceitaWS, limite de consultas/minuto). Até lá, toda consulta cai no erro "Nenhum provedor de consulta habilitado."
7. **Campos de Timeout — resolvido.** `custrecord_pd_petr_as_rws_timeout_nu` e `custrecord_pd_petr_as_bra_timeout_nu` já foram apagados manualmente na UI pelo usuário. Ver nota completa na seção 10.
6. **Confirmado empiricamente: o endpoint do ReceitaWS usado (`https://receitaws.com.br/v1/cnpj/{cnpj}`) é a API Pública gratuita, sem autenticação, limitada a poucas consultas/minuto — o "plano contratado" citado originalmente é, na prática, esse tier gratuito** (testado direto contra o endpoint: HTTP 200 sem nenhum header `Authorization`, resposta trazendo `"billing": {"free": true}`; também testado que enviar um `Authorization` vazio/inválido não quebra a chamada). Ajustes feitos em função disso:
   - `pd-petr-receitaws-api.js` só envia o header `Authorization` quando `options.token` tiver valor — antes enviava sempre, mesmo vazio (inofensivo na prática, mas semanticamente errado).
   - `<help>` dos campos "Token ReceitaWS" e "Limite de Consultas por Minuto" reescritos para deixar claro que o token é opcional (só necessário para o plano Comercial, até 2.000 consultas/minuto) e que o limite de 3/minuto tem que ser aumentado manualmente se esse plano for contratado no futuro — senão o rate limiter local seguiria limitando a 3/min mesmo com plano pago.
   - Nenhuma mudança de arquitetura: a lógica de fallback, rate limit e o campo de token continuam existindo, só ficaram corretamente documentados como preparação para um eventual upgrade comercial, não como requisito atual.

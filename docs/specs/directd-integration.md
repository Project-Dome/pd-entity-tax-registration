# Especificação — Integração DirectD e controle de créditos por provedor

Feature incremental sobre o módulo já documentado em `docs/specs/entity-tax-registration.md`,
`docs/specs/multi-provider-cnpj-lookup.md` e `docs/specs/hub-credit-control.md`. Esta spec cobre só
o que muda:

- Novo provedor **DirectD** (`apiv3.directd.com.br`), com quatro consultas configuráveis por cliente,
  cada uma com seu próprio botão no Customer/Vendor.
- DirectD como **3º nível** da hierarquia ReceitaWS → Hub → DirectD, no botão "Consultar CNPJ" e na
  consulta automática (salvar cadastro novo e CSV Import).
- Registro de consumo **único para todos os provedores pagos** (Hub e DirectD), substituindo o
  registro exclusivo da Hub.
- **Saldo de créditos com bloqueio** por provedor (validade só na Hub), para viabilizar a semana de testes com
  token da Dome.

## 1. Objetivo

- Permitir que cada cliente escolha quais consultas da DirectD usa: Consulta Completa, CNPJ Plus,
  CNPJ Básico e Inscrição Estadual. Cada consulta habilitada vira um botão no cadastro.
- Usar a DirectD como 3º nível de reserva (ReceitaWS → Hub → DirectD) no botão "Consultar CNPJ" e
  na consulta automática. A ordem é fixa; o cliente escolhe nas Validações quais dos três provedores
  entram na hierarquia e qual consulta da DirectD é usada.
- Usar a consulta "Receita Federal - Pessoa Jurídica" da DirectD como reserva quando o CNPJ não for
  encontrado na base da DirectD.
- Registrar o consumo de cada consulta paga (Hub e DirectD) num único registro e bloquear consultas
  quando o saldo de créditos disponíveis do provedor acabar ou, na Hub, a validade vencer.

## 2. Arquitetura

Segue a convenção de pastas já usada pelo módulo
(`src/FileCabinet/SuiteScripts/product_dome/pd_entity_tax_registration/`: `client/`, `userevent/`,
`restlet/`, `service/`, `modules/`, arquivos `pd-petr-{nome}.js`), a mesma decisão de
`hub-credit-control.md` §2. **Nenhum script novo** (entry point) é criado: os botões são do User
Event existente, as funções de clique ficam no Client Script existente, e as consultas passam pelo
RESTlet existente.

### 2.1 Peças

| Peça | Novo/Existente | Responsabilidade |
|---|---|---|
| `service/pd-petr-directd-api.js` | **Novo** | Chamadas HTTP cruas às quatro APIs da DirectD (§6.1). Não faz parse nem trata erro de negócio. |
| `service/pd-petr-directd-adapter.js` | **Novo** | Converte as respostas da DirectD para o shape canônico do módulo (§6.2). Funções puras. |
| `service/pd-petr-directd-lookup.js` | **Novo** | Orquestra cada modo de consulta da DirectD: fallback para a Receita PJ, UF do Sintegra, checagem de saldo e registro de consumo (§4.2). Nunca lança exceção. |
| `service/pd-petr-credit-usage.js` | **Novo** (substitui `pd-petr-hub-credit-usage.js`) | Grava o consumo no novo registro genérico, soma por provedor e período, calcula saldo e valida se uma consulta pode ser feita (§6.4). Server-only. |
| `service/pd-petr-hub-credit-usage.js` | Existente, **removido** | Seus usos (`pd-petr-cnpj-lookup.js`, `pd-petr-credit-report.js`) passam para `pd-petr-credit-usage.js`. |
| `service/pd-petr-cnpj-lookup.js` | Existente, **alterado** | Ganha o 3º nível: ReceitaWS → Hub → DirectD (§4.8), chamando `pd-petr-directd-lookup` no modo configurado. Valida o saldo antes de cada chamada paga à Hub e grava o consumo no novo registro. |
| `service/pd-petr-entity-lookup.js` | Existente, **alterado** | `fetchCNPJForRecord` e `fetchCompanyDataForCnpj` recebem o modo de consulta e despacham para `pd-petr-cnpj-lookup` (modo `DEFAULT`, a hierarquia) ou `pd-petr-directd-lookup` (botões da DirectD). `manageCsvImport` usa sempre o `DEFAULT`. |
| `restlet/pd-petr-entity-tax-registration.rl.js` | Existente, **alterado** | Repassa `mode` e `uf` do corpo da requisição. |
| `service/pd-petr-entity.js` | Existente, **alterado** | `fetchCNPJ` recebe o modo (botão atual e autofetch do save usam `DEFAULT`); no modo IE em create/edit lê a UF do endereço. |
| `service/pd-petr-mapper.js` | Existente, **alterado** | `setFields` ganha opções: gravar IE sem depender da flag da Hub e preencher só a IE (§6.6). |
| `userevent/pd-petr-entity-tax-registration.ue.js` | Existente, **alterado** | Adiciona os botões da DirectD conforme as flags das Validações. |
| `client/pd-petr-entity-tax-registration.cl.js` | Existente, **alterado** | Uma função de clique por botão da DirectD. |
| `service/pd-petr-api-settings.js` | Existente, **alterado** | Devolve os novos campos da DirectD e de saldo. |
| `service/pd-petr-credit-report.js` | Existente, **alterado** | Passa a ler o novo registro de consumo, filtrando provedor = Hub. |
| `modules/pd-petr-constants.js` | Existente, **alterado** | Novas constantes (§5.6). |

Regra mantida de `multi-provider-cnpj-lookup.md` §10: nada que o Client Script importe pode
depender, nem transitivamente, de módulo server-only. `pd-petr-directd-lookup.js` e
`pd-petr-credit-usage.js` são importados só pelo RESTlet e pelo User Event, via
`pd-petr-entity-lookup.js`.

### 2.2 Convivência com o fluxo atual

- O botão **"Consultar CNPJ"** ("Consultar CPF/CNPJ") e a consulta automática usam o **mesmo
  fluxo**, que passa a ter três níveis em ordem fixa: **1. ReceitaWS → 2. Hub → 3. DirectD** (§4.8).
  Cada nível entra ou sai da hierarquia por uma flag nas Validações (§3.3).
  O botão continua controlado por "Habilitar botão Consultar CNPJ".
- Os botões da DirectD são **adicionais** e chamam a DirectD diretamente, sem passar por ReceitaWS
  ou Hub. O cliente desliga o que não quiser.

## 3. Telas / Interfaces

### 3.1 Customer / Vendor — botões

Adicionados pelo User Event em create, edit e view (mesmas condições do botão atual), cada um
quando a flag correspondente está marcada na Configuração das Validações:

| Botão | Flag (Validações) | Modo |
|---|---|---|
| Consulta Completa | Botão Consulta Completa (DirectD) | `DD_FULL` |
| Consultar CNPJ Plus | Botão Consultar CNPJ Plus (DirectD) | `DD_PLUS` |
| Consultar CNPJ Básico | Botão Consultar CNPJ Básico (DirectD) | `DD_BASIC` |
| Consultar Inscrição Estadual | Botão Consultar Inscrição Estadual (DirectD) | `DD_IE` |

Os botões aparecem só pela flag das Validações. Se a DirectD estiver desabilitada ou sem token na
Configuração das APIs, o clique devolve a mensagem de §4.7. Isso evita que o User Event leia a
Configuração das APIs, que guarda os tokens e pode não estar acessível ao papel do usuário.

Feedback igual ao do botão atual: popup "Aguarde! Consultando dados do CNPJ..." durante a chamada,
dialog de erro em caso de falha, dialog de aviso para avisos não bloqueantes (ex.: IE não obtida).

### 3.2 "PD | PETR | Configuração das APIs" (`customrecord_pd_petr_api_settings`)

Novo grupo **"DirectD"** no formulário `custform_pd_petr_as`:

| Campo | Tipo | Default |
|---|---|---|
| Habilitar DirectD | Checkbox | Desmarcado |
| Token DirectD | Password | — |
| Preço CNPJ Plus (R$) | Currency | 0,36 |
| Preço CNPJ Básico (R$) | Currency | 0,16 |
| Preço Sintegra (R$) | Currency | 0,36 |
| Preço Receita Federal PJ (R$) | Currency | 0,36 |
| Créditos Carregados (R$) | Currency | — |
| Início da Contagem | Date | — |

A DirectD não tem "Válido até": é controlada só por crédito (§4.6).

No grupo existente **"Hub do Desenvolvedor"**, três campos novos de saldo:

| Campo | Tipo | Default |
|---|---|---|
| Créditos Carregados | Integer | — |
| Início da Contagem | Date | — |
| Válido até | Date | — |

"Créditos Contratados por Mês" e "Dia de Renovação do Pacote" da Hub continuam existindo, só para o
relatório de créditos. Não bloqueiam nada.

### 3.3 "PD | PETR | Configuração das Validações" (`customrecord_pd_petr_validation_settings`)

Novo grupo **"DirectD"** no formulário `custform_pd_petr_vs`:

| Campo | Tipo | Default |
|---|---|---|
| Botão Consulta Completa (DirectD) | Checkbox | Desmarcado |
| Botão Consultar CNPJ Plus (DirectD) | Checkbox | Desmarcado |
| Botão Consultar CNPJ Básico (DirectD) | Checkbox | Desmarcado |
| Botão Consultar Inscrição Estadual (DirectD) | Checkbox | Desmarcado |

Novo grupo **"Hierarquia da Consulta de CNPJ"** no mesmo formulário (vale para o botão "Consultar
CNPJ" e a consulta automática, §4.8):

| Campo | Tipo | Default |
|---|---|---|
| ReceitaWS na Hierarquia (1º) | Checkbox | Marcado |
| Hub do Desenvolvedor na Hierarquia (2º) | Checkbox | Marcado |
| DirectD na Hierarquia (3º) | Checkbox | Desmarcado |
| Consulta DirectD na Hierarquia | List (`customlist_pd_petr_dd_chain_mode`) | Vazio |

- "Consulta DirectD na Hierarquia" fica desabilitada e vazia enquanto "DirectD na Hierarquia"
  estiver desmarcado (mesmo padrão de `applyCpfDependency` no Client Script das Validações).
- Com "DirectD na Hierarquia" marcado, o save do formulário exige a consulta:
  *"Escolha a Consulta DirectD na Hierarquia."* Em inline edit e CSV não há bloqueio: a regra de
  §4.8 trata a lista vazia como DirectD fora da hierarquia.

### 3.4 Novo registro "PD | PETR | Consumo de Créditos das APIs"

Uma linha por consulta paga (§4.5). Listagem pela saved search `customsearch_pd_petr_cu_list`.

## 4. Critérios e regras de negócio

### 4.1 Consultas da DirectD

| Modo | APIs chamadas | Custo previsto (preços da §3.2) |
|---|---|---|
| `DD_FULL` — Consulta Completa | CNPJ Plus → Sintegra | Plus + Sintegra |
| `DD_PLUS` — CNPJ Plus | CNPJ Plus | Plus |
| `DD_BASIC` — CNPJ Básico | CNPJ Básico | Básico |
| `DD_IE` — Inscrição Estadual | Sintegra | Sintegra |

- Todas as consultas da DirectD atendem **só CNPJ** (14 caracteres). Com CPF no campo, o botão
  devolve: *"As consultas da DirectD atendem apenas CNPJ."* As validações de País e de formato do
  CNPJ são as mesmas do botão atual.
- Requisição autenticada pelo header `Authorization: Bearer {token}`. O token nunca vai na URL nem
  no log.
- **Sucesso** = HTTP 200 com `retorno` preenchido. **Não encontrado** = HTTP 404, ou HTTP 200 com
  `retorno` nulo. Qualquer outro código (400, 401, 408, 500, 503), exceção ou timeout = **falha**.
  O log registra `metaDados.mensagem` e `metaDados.consultaUid`.
- **Sem saldo na DirectD** = HTTP 402, ou falha cuja `metaDados.mensagem` fala em saldo/crédito
  (verificado antes do 401) → *"O saldo da DirectD acabou. Faça uma recarga no painel da DirectD e
  tente novamente."* Na hierarquia (§4.8) conta como bloqueio, igual ao saldo do NetSuite (§4.6). O
  código real dessa resposta é confirmado na Parte 0.

### 4.2 Fluxo de cada modo

**`DD_PLUS` / `DD_BASIC`**
1. Checa a habilitação e o saldo da DirectD para o custo previsto (§4.6).
2. Chama o CNPJ Plus (ou o Básico).
3. **Não encontrado** → reserva na Receita Federal PJ (§4.3). Falha → mensagem de erro, nada é
   preenchido.
4. Preenche o cadastro pelo mapper, respeitando as flags "Atualizar ..." das Validações, como hoje.

**`DD_FULL`**
1. Checa a habilitação e o saldo para Plus + Sintegra.
2. Chama o CNPJ Plus. **Não encontrado** → reserva na Receita Federal PJ (§4.3).
3. UF do Sintegra: `uf` do primeiro item de `enderecos[]` do CNPJ Plus (ou `uf` da Receita PJ).
   Sem UF → pula o Sintegra com aviso.
4. Chama o Sintegra com `Cnpj` + `Uf`.
5. Junta os dados: cadastro pelo CNPJ Plus (ou pela Receita PJ), mais a **Inscrição Estadual** e o
   **código IBGE** (`informacaoIBGE.codigo`) do Sintegra.
6. **Sintegra falhou** (não encontrado, 408, 503 etc.) → preenche o resto e avisa: *"A Inscrição
   Estadual não foi obtida no Sintegra. Os demais dados foram preenchidos."*
7. A IE é gravada sem depender da flag "Consultar Inscrição Estadual (Hub)" (§4.4).

**`DD_IE`**
1. UF: estado do endereço do cadastro, o endereço de faturamento padrão ou, sem ele, a primeira
   linha do `addressbook` com estado. Em create/edit o Client Script lê a UF e a envia ao RESTlet;
   em view o RESTlet lê do record carregado.
   Sem UF → *"Preencha o endereço (Estado) do cadastro antes de consultar a Inscrição Estadual."*,
   sem chamada e sem custo.
2. Checa a habilitação e o saldo para o Sintegra.
3. Chama o Sintegra com `Cnpj` + `Uf`.
4. Preenche **só** a Inscrição Estadual (§4.4). Os demais dados do Sintegra são ignorados.
5. Não encontrado/falha → *"Inscrição Estadual não encontrada no Sintegra de {UF}."* (ou a mensagem
   de falha genérica).

### 4.3 Reserva na Receita Federal PJ

- Disparada **só** quando o CNPJ Plus ou o Básico respondem **não encontrado** (§4.1), nos modos
  `DD_FULL`, `DD_PLUS` e `DD_BASIC`. Falha de comunicação (401, 408, 503, timeout) **não** dispara
  a reserva.
- Não é configurável: vale sempre que o modo é usado.
- Antes da chamada, o saldo é checado de novo para o custo restante (Receita PJ, mais o Sintegra no
  `DD_FULL`). Sem saldo → mensagem de §4.6, nada é preenchido.
- A Receita PJ consulta a Receita em tempo real e **não traz Simples/MEI**. O Regime Tributário
  segue a regra de §4.4.
- Chamada com `Cnpj`, sem `Qsa` e sem `GERARCOMPROVANTE`.

### 4.4 Mapeamento para o cadastro

Shape canônico já usado pelo mapper (`multi-provider-cnpj-lookup.md` §2), tabela completa em §6.2.

- **Inscrição Estadual (Sintegra):** usa `retorno.ie`. Se vier vazio, usa o primeiro item de
  `inscricoesEstaduais[]` com `uf` igual à UF consultada e habilitado (`ativoHabilitada`). Gravada
  **somente se o campo estiver vazio**, como hoje.
- **Regime Tributário:** do CNPJ Plus, por `opcaoMEI`/`opcaoSimples`. Se o cadastro veio do CNPJ
  Básico ou da Receita PJ (sem esses campos) e o modo é `DD_FULL`, usa o `regimeApuracao` do
  Sintegra: contendo "SIMPLES" → "Optante pelo Simples Nacional". Sem essas informações, o campo
  fica em branco. Lucro Presumido/Real não são resolvidos pela DirectD nesta fase.
- **Telefone/e-mail:** primeiro item de `telefones[]` (`telefoneComDDD`) e de `emails[]`
  (`enderecoEmail`).
- **Endereço:** primeiro item de `enderecos[]` (CNPJ Plus/Básico) ou campos diretos (Receita PJ). A
  cidade é resolvida como hoje: código IBGE do Sintegra (só `DD_FULL`), depois o IBGE do CEP, depois
  nome + UF.
- Os valores exatos de `opcaoSimples`, `opcaoMEI`, `tributacao`, `situacaoCadastral`,
  `ativoHabilitada` e `regimeApuracao` precisam ser conferidos numa resposta real (Parte 0 do
  checklist). O adapter é escrito a partir dessas respostas, não do exemplo da documentação.

### 4.5 Registro de consumo (todos os provedores pagos)

- Uma linha em `customrecord_pd_petr_credit_usage` **por chamada paga bem-sucedida**:
  - **Hub:** quando a resposta traz `consumed` > 0 (regra atual de `hub-credit-control.md` §4.1),
    gravando os créditos.
  - **DirectD:** quando a resposta é sucesso (§4.1), gravando o custo em R$ (preço configurado na
    §3.2) e o `consultaUid`.
  - Se a Parte 0 mostrar que a DirectD também cobra respostas "não encontrado", elas passam a ser
    registradas.
- ReceitaWS (gratuito) não gera linha.
- A Hub passa a gravar **só** no novo registro. `customrecord_pd_petr_hub_credit_usage` sai do
  projeto e é excluído manualmente em cada conta (o deploy do SDF não apaga Objects); o histórico
  dele não é migrado (§10).
- Falha ao gravar a linha não interrompe a consulta: é registrada no log (regra atual).
- **Resposta da API:** cada linha guarda o corpo da resposta da chamada cobrada, em JSON, no campo
  "Resposta da API" (Long Text), para conferência e suporte. DirectD: o corpo como veio; Hub: o
  corpo já interpretado, serializado de novo em JSON (mesmo conteúdo, sem a formatação original).
  Cortado em 1.000.000 de caracteres (limite do Long Text); as respostas reais têm poucos KB.
  **Campo oculto** (`displaytype` HIDDEN, fora da listagem): o usuário não o vê no registro. Contém
  dados cadastrais e, no CPF, dados pessoais (nome, data de nascimento); a consulta pela Dome é
  feita por saved search.
- **Saldo Após a Consulta:** cada linha grava o saldo que sobrou depois dela = Créditos Carregados
  − consumo do provedor desde o Início da Contagem, já contando a própria linha (mesma conta do
  §4.6). Hub em créditos ("Saldo Após a Consulta (Hub)"), DirectD em R$ ("Saldo Após a Consulta
  (R$)"). Vazio quando "Créditos Carregados" do provedor está vazio (sem limite). É um retrato do
  momento: recargas ou mudanças no Início da Contagem não recalculam linhas antigas, e duas
  consultas simultâneas podem gravar o mesmo saldo (mesma limitação da checagem). Falha no cálculo
  só deixa o campo vazio; a linha é gravada.

### 4.6 Saldo e bloqueio

Mesma regra para a Hub (em créditos) e a DirectD (em R$), cada um com seus campos (§3.2).

**DirectD: controle de saldo na própria DirectD.** A DirectD cobra por consulta (pré-pago com
recarga ou pós-pago com fatura mensal), e a recarga é feita **pelo cliente** no painel da DirectD,
sem integração com o NetSuite. Por isso, o padrão é deixar "Créditos Carregados", "Início da
Contagem" da DirectD **vazios** (sem limite no NetSuite): quando o saldo acaba, a
própria DirectD recusa a consulta (§4.1). Os campos continuam disponíveis como teto de gasto
opcional; quem os preencher precisa atualizá-los a cada recarga.

- **Hub sem crédito carregado** (decisão de 05/11/2026): "Créditos Carregados (Hub)" é o que diz se
  a Hub foi carregada e quanto pode ser usado. Vazio ou zero → a Hub é tratada como **desligada**:
  na hierarquia de CNPJ ela é pulada sem chamada e sem mensagem (como "Hub do Desenvolvedor na
  Hierarquia" desmarcado ou "Habilitar Hub do Desenvolvedor" desmarcado). Na consulta de CPF, que
  só existe na Hub, aparece a mensagem de CPF sem provedor. A mensagem de saldo da Hub só aparece
  quando houve carga e ela acabou. "Créditos Contratados por Mês" não entra na validação: é só a
  referência do pacote no relatório.
- **DirectD sem limite:** "Créditos Carregados (R$)" vazio → sem bloqueio por saldo no NetSuite (a
  DirectD controla). "Válido até (Hub)" vazio → sem validade.
- **Saldo** = Créditos Carregados − soma do consumo do provedor no novo registro desde "Início da
  Contagem". Com o Início vazio, soma todo o consumo do provedor. O saldo é calculado a cada
  consulta; nada é gravado no registro de configuração. Para recarregar, a Dome ajusta "Créditos
  Carregados" e/ou "Início da Contagem".
- **Créditos Disponíveis** (decisão de 05/11/2026): campos somente leitura "Créditos Disponíveis
  (Hub)" e "Créditos Disponíveis (R$)", ao lado de cada "Créditos Carregados", mostram o saldo
  atual (mesma conta acima) ao abrir a Configuração das APIs. Não são gravados (`storevalue` F):
  calculados no `beforeLoad` de um User Event novo do registro, só na interface. Vazios quando
  "Créditos Carregados" está vazio. Exemplo: carregados R$ 15,00, consumo R$ 0,72 → disponíveis
  R$ 14,28. Podem ficar negativos se o consumo passar do carregado (consultas simultâneas).
- **Validade vencida**, só na Hub (hoje > "Válido até (Hub)") → bloqueia. A DirectD é controlada só
  por crédito e não tem validade:
  *"O período de uso da Hub do Desenvolvedor terminou em {DD/MM/AAAA}. Entre em contato
  com a equipe Dome."*
- **Saldo insuficiente** → bloqueia **antes de começar** quando o saldo não cobre o custo previsto
  da consulta inteira:
  *"Créditos disponíveis da {provedor} insuficientes para esta consulta (saldo: {X}; necessário:
  {Y}). Entre em contato com a equipe Dome."*
  - DirectD: custo previsto pelos preços da §3.2 e pela tabela da §4.1. Na reserva da Receita PJ, a
    checagem se repete para o custo restante (§4.3).
  - Hub: checagem antes de cada chamada paga, com o custo previsto por tipo: CPF base Hub = 1, CPF
    Receita = 5, nome_cpf = 10 (`hub-credit-control.md` §4.3), CNPJ = conforme Parte 0.
    `last_update=2` é gratuito e nunca é bloqueado.
- Na hierarquia ReceitaWS → Hub → DirectD, um provedor bloqueado por saldo ou validade é pulado
  e o fluxo segue para o próximo nível. A mensagem de bloqueio só aparece **depois de todos os
  níveis serem tentados** — nunca no meio da hierarquia. Se nenhum nível responder:
  - um só provedor bloqueado → a mensagem dele, como acima;
  - Hub e DirectD bloqueadas → uma mensagem única com os dois motivos:
    *"Nenhum provedor da hierarquia pôde consultar o CNPJ: Hub do Desenvolvedor (saldo: {X};
    necessário: {Y}); DirectD (saldo: {X}; necessário: {Y}). Entre em contato com a equipe
    Dome."* — o motivo de cada um pode ser saldo, validade vencida (Hub) ou saldo zerado na
    própria DirectD (HTTP 402);
  - nenhum bloqueio → a genérica "nenhum provedor disponível".

  Se um provedor foi bloqueado e o outro falhou por outro motivo (não encontrado, erro), a
  mensagem é a do bloqueio. CPF não entra na hierarquia (só Hub), então a mensagem sai logo
  após a checagem da Hub.
- **Botões:** a mensagem aparece em dialog de erro; o cadastro continua podendo ser salvo
  manualmente.
- **Consulta automática** no save: dialog de aviso, e o save continua. **CSV Import:** só log; a
  importação segue sem enriquecer (regra atual de não abortar).
- **Erro ao calcular o saldo** (a busca do consumo falhou ou o script ficou sem limite de uso) →
  **bloqueia** (decisão de 05/11/2026; antes liberava): *"Não foi possível verificar o saldo de
  créditos da {provedor}, por isso a consulta foi bloqueada. Tente novamente."* — nos botões a tela
  acrescenta "Se o problema persistir, acione a equipe Dome…". Na hierarquia conta como bloqueio:
  o provedor é pulado e o fluxo segue para o próximo nível.
- A checagem não é transacional: duas consultas simultâneas podem passar com o mesmo saldo e
  ultrapassá-lo em até uma consulta cada. Limitação aceita (mesmo raciocínio do rate limiter em
  `multi-provider-cnpj-lookup.md` §10).

### 4.7 Habilitação da DirectD

- Botão clicado ou consulta automática em modo DirectD com "Habilitar DirectD" desmarcado ou sem
  token → *"A DirectD não está habilitada. Configure o registro de Configuração das APIs."*, sem
  chamada.
- HTTP 401 ("IP ou Token inválido") → *"A DirectD recusou a consulta (token inválido ou IP não
  liberado). Entre em contato com a equipe Dome."*. Não é tentado de novo.

### 4.8 Hierarquia ReceitaWS → Hub → DirectD (botão "Consultar CNPJ" e consulta automática)

Vale para os três pontos que hoje usam `pd-petr-cnpj-lookup.getCompanyData`: botão "Consultar
CNPJ" (create/edit e view), autofetch do save e CSV Import.

A **ordem é sempre a mesma**; o cliente só escolhe quem entra, pelos campos do grupo "Hierarquia da
Consulta de CNPJ" (§3.3). Um provedor entra quando está **marcado na hierarquia (Validações)** e
**habilitado com token (Configuração das APIs)**. A primeira condição é escolha do cliente; a
segunda continua sendo controle da Dome.

1. **ReceitaWS**, se "ReceitaWS na Hierarquia" marcado e habilitado (regras atuais de rate limit).
2. **Hub do Desenvolvedor**, se "Hub do Desenvolvedor na Hierarquia" marcado, habilitada com token,
   com "Créditos Carregados (Hub)" maior que zero e com saldo (§4.6).
3. **DirectD**, se "DirectD na Hierarquia" marcado, "Consulta DirectD na Hierarquia" preenchida,
   habilitada com token e com saldo para o custo previsto do modo escolhido:
   - "Consulta Completa" → modo `DD_FULL`;
   - "CNPJ Plus" → modo `DD_PLUS`;
   - "CNPJ Básico" → modo `DD_BASIC`.

   O nível 3 segue as regras de §4.2–§4.6, inclusive a reserva na Receita PJ e a gravação da IE
   no `DD_FULL`. O modo `DD_IE` não é opção da hierarquia.

- Um nível só é tentado se o anterior falhou ou foi pulado (fora da hierarquia, desabilitado, sem
  cota, sem saldo, não encontrado ou erro). Provedor fora da hierarquia, desabilitado ou não
  configurado é pulado sem log de erro (regra atual).
- Exemplos:

  | ReceitaWS | Hub | DirectD | Situação | Sequência |
  |---|---|---|---|---|
  | ✔ | ✔ | ✔ | Normal | ReceitaWS → Hub → DirectD |
  | ✘ | ✔ | ✔ | Normal | Hub → DirectD |
  | ✔ | ✘ | ✔ | Normal | ReceitaWS → DirectD |
  | ✔ | ✔ | ✘ | Normal | ReceitaWS → Hub (comportamento de hoje) |
  | ✘ | ✔ | ✔ | Hub sem saldo ou vencida | DirectD direto |
  | ✘ | ✘ | ✔ | Normal | DirectD direto |

- **Nenhum provedor na hierarquia** (os três desmarcados, ou nenhum marcado está habilitado): botão
  → dialog de erro *"Nenhum provedor está habilitado na hierarquia de consulta de CNPJ. Configure o
  registro de Configuração das Validações."*; save → a mesma mensagem em dialog de aviso, e o save
  continua; CSV Import → só log.
- As flags da hierarquia não afetam os botões da DirectD (§3.1), a consulta de CPF nem a
  Inscrição Estadual pela Hub ("Consultar Inscrição Estadual (Hub)", que continua valendo quando a
  Hub responde na hierarquia).
- O resultado informa o provedor que respondeu (`RECEITAWS`, `HUB` ou `DIRECTD`).
- **Nenhum nível respondeu:** botão → dialog de erro; save → dialog de aviso e o save continua;
  CSV Import → só log (regras atuais). A mensagem segue §4.6 quando houve bloqueio por saldo.
- **Caso especial de rate limit** (`multi-provider-cnpj-lookup.md` §4, `RATE_LIMIT_NO_FALLBACK`):
  a mensagem "aguarde N segundos" passa a exigir que a Hub **e** o nível DirectD estejam
  indisponíveis (fora da hierarquia, desabilitados ou não configurados). Com qualquer um deles
  disponível, o fluxo segue para ele.
- **CPF:** a hierarquia de CPF não muda (só Hub). A DirectD não atende CPF nesta fase (§9).
- Continua valendo a condição atual de "Habilitar Consulta Automática" para o save e o CSV
  Import.

## 5. Registros e campos envolvidos

Todos os scriptids conferidos contra o limite de 40 caracteres. Abreviações: `dd` = DirectD,
`cu` = credit usage, `prc` = preço, `sint` = Sintegra, `rfb` = Receita Federal, `valid_to` =
"Válido até". `..._dd_prc_sintegra_cr` teria 42 caracteres e `..._hub_valid_until_dt` chegaria a
exatamente 40, por isso as formas curtas.

### 5.1 `customrecord_pd_petr_api_settings` — novos campos (arquivo existente `src/Objects/customrecord_pd_petr_api_settings.xml`)

| Campo | scriptid | Tipo |
|---|---|---|
| Habilitar DirectD | `custrecord_pd_petr_as_dd_enabled_cb` | Check Box |
| Token DirectD | `custrecord_pd_petr_as_dd_token_pw` | Password (ver Parte 3) |
| Preço CNPJ Plus (R$) | `custrecord_pd_petr_as_dd_prc_plus_cr` | Currency |
| Preço CNPJ Básico (R$) | `custrecord_pd_petr_as_dd_prc_basic_cr` | Currency |
| Preço Sintegra (R$) | `custrecord_pd_petr_as_dd_prc_sint_cr` | Currency |
| Preço Receita Federal PJ (R$) | `custrecord_pd_petr_as_dd_prc_rfb_cr` | Currency |
| Créditos Carregados (R$) | `custrecord_pd_petr_as_dd_avail_cr` | Currency |
| Créditos Disponíveis (R$) | `custrecord_pd_petr_as_dd_balance_cr` | Currency, somente leitura, não gravado |
| Início da Contagem | `custrecord_pd_petr_as_dd_start_dt` | Date |
| Créditos Carregados (Hub) | `custrecord_pd_petr_as_hub_avail_nu` | Integer |
| Créditos Disponíveis (Hub) | `custrecord_pd_petr_as_hub_balance_nu` | Integer, somente leitura, não gravado |
| Início da Contagem (Hub) | `custrecord_pd_petr_as_hub_start_dt` | Date |
| Válido até (Hub) | `custrecord_pd_petr_as_hub_valid_to_dt` | Date |

Formulário `custform_pd_petr_as` (existente): novo grupo `fieldgroup_pd_petr_as_dd` ("DirectD") e
os três campos novos da Hub no grupo `fieldgroup_pd_petr_as_hub`.

### 5.2 `customrecord_pd_petr_validation_settings` — novos campos (arquivo existente `src/Objects/customrecord_pd_petr_validation_settings.xml`)

| Campo | scriptid | Tipo |
|---|---|---|
| Botão Consulta Completa (DirectD) | `custrecord_pd_petr_vs_dd_full_btn_cb` | Check Box |
| Botão Consultar CNPJ Plus (DirectD) | `custrecord_pd_petr_vs_dd_plus_btn_cb` | Check Box |
| Botão Consultar CNPJ Básico (DirectD) | `custrecord_pd_petr_vs_dd_basic_btn_cb` | Check Box |
| Botão Consultar Inscrição Estadual (DirectD) | `custrecord_pd_petr_vs_dd_ie_btn_cb` | Check Box |
| ReceitaWS na Hierarquia (1º) | `custrecord_pd_petr_vs_rws_in_chain_cb` | Check Box (`defaultchecked=T`) |
| Hub do Desenvolvedor na Hierarquia (2º) | `custrecord_pd_petr_vs_hub_in_chain_cb` | Check Box (`defaultchecked=T`) |
| DirectD na Hierarquia (3º) | `custrecord_pd_petr_vs_dd_in_chain_cb` | Check Box |
| Consulta DirectD na Hierarquia | `custrecord_pd_petr_vs_dd_chain_mode_ls` | List/Record (`customlist_pd_petr_dd_chain_mode`) |

Formulário `custform_pd_petr_vs` (existente): novos grupos `fieldgroup_pd_petr_vs_dd` ("DirectD") e
`fieldgroup_pd_petr_vs_chain` ("Hierarquia da Consulta de CNPJ"). Ordem dos grupos, do geral para o
específico de cada provedor (§10):

1. Validação de Duplicidade.
2. Consulta de CPF/CNPJ (`_lookup`, era "Consulta na Receita"): Consulta Automática e Botão
   "Consultar CPF/CNPJ".
3. Hierarquia da Consulta de CNPJ (`_chain`).
4. Hub do Desenvolvedor (`_hub`, novo): Consultar Inscrição Estadual, Consultar CPF, Busca
   Automática de Data de Nascimento, Ciente em, Ciente por — os rótulos mantêm o "(Hub)", citado em
   mensagens e ajudas.
5. DirectD (`_dd`).
6. Atualização de Campos (`_upd`, era "Atualização de Campos via Receita").
7. Relatório de Créditos (`_report`).
8. Informações do Sistema (`_sys`).

**Compatibilidade com contas já instaladas:** `defaultchecked=T` só vale para registros novos. No
registro de Validações que já existe, "ReceitaWS na Hierarquia" e "Hub do Desenvolvedor na
Hierarquia" ficam desmarcados após o deploy, e a hierarquia ficaria vazia. Por isso, logo após o
deploy em cada conta, a Dome marca os dois campos no registro existente (Parte 4 do checklist), e o
CHANGELOG da versão registra o passo.
Nenhum dos campos é sigiloso, então não entram em `PRIVATE_FIELD_KEYS`: o Suitelet anônimo de busca
os devolve ao User Event. As chaves no `pd-petr-constants.js` não começam com `update`, para ficarem
fora de "Atualizar Todos os Campos".

### 5.3 Novo custom record — `customrecord_pd_petr_credit_usage`

"PD | PETR | Consumo de Créditos das APIs" — `src/Objects/pd_petr/custom_record/customrecord_pd_petr_credit_usage.xml`.
A data da consulta é a data de criação nativa (`created`).

| Campo | scriptid | Tipo |
|---|---|---|
| Provedor | `custrecord_pd_petr_cu_provider_ls` | List/Record (`customlist_pd_petr_api_provider`) |
| Tipo de Consulta | `custrecord_pd_petr_cu_query_type_ds` | Free-Form Text |
| CPF/CNPJ Consultado | `custrecord_pd_petr_cu_document_ds` | Free-Form Text |
| Créditos Consumidos (Hub) | `custrecord_pd_petr_cu_credits_nu` | Integer |
| Custo (R$) | `custrecord_pd_petr_cu_cost_cr` | Currency |
| ID da Consulta no Provedor | `custrecord_pd_petr_cu_query_uid_ds` | Free-Form Text |
| Usuário | `custrecord_pd_petr_cu_user_ls` | List/Record (Employee) |
| Resposta da API | `custrecord_pd_petr_cu_api_response_lt` | Long Text (oculto) |
| Saldo Após a Consulta (Hub) | `custrecord_pd_petr_cu_hub_balance_nu` | Integer |
| Saldo Após a Consulta (R$) | `custrecord_pd_petr_cu_dd_balance_cr` | Currency |

Cada provedor preenche o campo da sua unidade: a Hub, os créditos; a DirectD, o custo e o
`consultaUid`. Saved search de listagem `customsearch_pd_petr_cu_list`, **criada na UI e
importada** (filtro `isinactive = F`; colunas Internal ID, Data de criação, Provedor, Tipo de
Consulta, CPF/CNPJ, Créditos, Custo).

Tipos de consulta gravados: os da Hub de hoje (`HUB_CREDIT_USAGE.QUERY_TYPES`), mais
`CNPJ Plus`, `CNPJ Básico`, `Sintegra` e `Receita Federal PJ`.

### 5.4 Novas custom lists — `src/Objects/pd_petr/custom_list/`

- `customlist_pd_petr_api_provider` — Hub do Desenvolvedor, DirectD.
- `customlist_pd_petr_dd_chain_mode` — Consulta Completa, CNPJ Plus, CNPJ Básico.

### 5.5 Existentes sem alteração de estrutura

- `customrecord_pd_petr_hub_credit_usage` — removido do projeto; exclusão manual em cada conta (§4.5).
- `custentity_brl_entity_t_state_tx_reg` (Inscrição Estadual), `custentity_fte_entity_l_taxregime`
  e os demais campos de entidade já mapeados.

### 5.6 `pd-petr-constants.js`

- `API.DIRECTD_BASE_URL: 'https://apiv3.directd.com.br/api/'`.
- `LOOKUP_MODES`: `DEFAULT`, `DD_FULL`, `DD_PLUS`, `DD_BASIC`, `DD_IE`.
- `BUTTON` ganha um item por botão da DirectD: ids `custpage_pd_petr_dd_full_bt`,
  `custpage_pd_petr_dd_plus_bt`, `custpage_pd_petr_dd_basic_bt`, `custpage_pd_petr_dd_ie_bt`;
  funções `fetchDirectdFull`, `fetchDirectdPlus`, `fetchDirectdBasic`, `fetchDirectdStateReg`.
- `CREDIT_USAGE` (tipo, campos, tipos de consulta, provedores) substitui `HUB_CREDIT_USAGE`.
- Novos campos em `API_SETTINGS.FIELDS` e `VALIDATION_SETTINGS.FIELDS`.

### 5.7 Texto de ajuda (`<help>`) dos campos da DirectD

O `<help>` de cada campo que liga ou precifica uma consulta da DirectD lista **todos os campos que a
consulta retorna**. Os nomes são os de "Campos da API" do marketplace da DirectD, em ordem alfabética.
Depois da lista vem a linha **"Preenchidos no cadastro"**, para o cliente não entender que todos os
campos retornados são gravados.

Fonte: catálogo público da DirectD, consultado em 03/11/2026. Se a DirectD mudar os campos de uma
API, muda só o `<help>`, não o código.

#### 5.7.1 Campos retornados por API

- **`{CAMPOS_PLUS}`** — Cadastro – Pessoa Jurídica – Plus (51 campos):
  Bairro, Cargo, CEP, Cidade, CNAE - Código, CNAE - Código Secundário, CNAE Descrição, CNAE
  Secundário - Descrição, CNPJ, Código da Natureza Jurídica, Complemento, Data de Entrada, Data de
  Fundação, Descrição da Natureza Jurídica, Documento, Endereço de E-mail, Faixa de faturamento,
  Faixa de Funcionários, Faturamento Médio do CNAE, Faturamento Presumido, Flag Matriz, Flag
  Telemarketing Bloqueado, Flag WhatsApp, Lista de CNAE Secundários, Lista de E-mail, Lista de
  Endereço, Lista de Filiais, Lista de Sócios, Lista de Telefones, Logradouro, Nome, Nome Fantasia,
  Número, Opção MEI, Opção Simples, Operadora, Órgão Público, Percentual de Participação, Porte,
  Quantidade de Filiais, Quantidade de Funcionários, Ramo, Razão Social, Situação Cadastral, Telefone
  com DDD, Tipo da Empresa, Tipo da Natureza Jurídica, Tipo de Telefone, Tributação, UF, Última
  Atualização da Pessoa Jurídica.
- **`{CAMPOS_BASICO}`** — Cadastro – Pessoa Jurídica – Básica (45 campos):
  Bairro, Cargo, CEP, Cidade, CNAE - Código, CNAE - Código Secundário, CNAE - Descrição, CNAE
  Secundário - Descrição, CNPJ, Código da Natureza Jurídica, Complemento, Data de Entrada, Data de
  Fundação, Descrição da Natureza Jurídica, Documento, Endereço, Endereço de E-mail, Faixa de
  faturamento, Faixa de Funcionários, Flag Matriz, Flag Telemarketing Bloqueado, Flag WhatsApp, Lista
  de CNAE Secundários, Lista de E-mail, Lista de Endereço, Lista de Sócios, Lista de Telefones,
  Logradouro, Nome, Nome Fantasia, Número, Operadora, Órgão Público, Percentual de Participação,
  Porte, Quantidade de Funcionários, Ramo, Razão Social, Situação Cadastral, Telefone com DDD, Tipo da
  Empresa, Tipo da Natureza Jurídica, Tipo de Telefone, UF, Última Atualização da Pessoa Jurídica.
  Em relação ao Plus, **não traz**: Opção Simples, Opção MEI, Tributação, Faturamento Presumido,
  Faturamento Médio do CNAE, Quantidade de Filiais e Lista de Filiais.
- **`{CAMPOS_SINTEGRA}`** — Sintegra – Cadastros Estaduais (43 campos):
  Atividade Econômica Principal, Bairro, CEP, Cidade, CNPJ, Código, Código de Controle, Complemento,
  CPF, Data da Consulta, Data da Situação Cadastral, Data de Abertura, Data de Início da
  Obrigatoriedade NFe, Data do Credenciamento do Emissor NFe, Data do Fim da Atividade, Data do Início
  da Atividade, Delegacia Regional da Receita, E-mail, Habilitada, IE, Indicador de Obrigatoriedade de
  NFe, Informação do IBGE, Inscrição, Lista de Atividades Econômicas Secundárias, Lista de Inscrições
  Estaduais, Logradouro, Motivo da Situação Cadastral, Município, Natureza Jurídica, Nome Empresarial,
  Nome Fantasia, Número, Observação, Ocorrência Fiscal, Regime de Apuração, Situação, Situação
  Cadastral, Situação do Contribuinte na Data, Telefone, Tipo, UF, UF da IE, Vínculo.
- **`{CAMPOS_RFB}`** — Receita Federal – Pessoa Jurídica (35 campos):
  Atividade Econômica Principal, Bairro ou Distrito, Capital Social QSA, CEP, Complemento, Data da
  Consulta, Data da Situação Cadastral, Data da Situação Especial, Data de Abertura, Data de Emissão,
  Documento do Sócio, EFR, Endereço Eletrônico, Flag de Recuperação Judicial, Flag Matriz, Flag
  Representante Legal, Lista de Atividades Econômicas Secundárias, Lista de Sócios, Logradouro, Motivo
  da Situação Cadastral, Município, Natureza Jurídica, Nome do Representante Legal, Nome Empresarial,
  Nome Fantasia, Nome ou Nome Empresarial, Número, Número de Inscrição, Porte, Qualificação,
  Qualificação do Representante Legal, Situação Cadastral, Situação Especial, Telefone, UF.

#### 5.7.2 Texto de cada campo

Cada `{CAMPOS_...}` é substituído pela lista da §5.7.1, sem a contagem.

**Botão Consultar CNPJ Plus (DirectD)** — `custrecord_pd_petr_vs_dd_plus_btn_cb`
> Adiciona ao Cliente/Fornecedor o botão "Consultar CNPJ Plus", que consulta o CNPJ na API
> Cadastro – Pessoa Jurídica – Plus da DirectD. Se o CNPJ não for encontrado, consulta a Receita
> Federal – Pessoa Jurídica.
> Campos retornados pela DirectD: {CAMPOS_PLUS}
> Preenchidos no cadastro, conforme as opções "Atualizar ...": Razão Social, Nome Fantasia, Telefone
> com DDD, Endereço de E-mail, endereço (Logradouro, Número, Complemento, Bairro, CEP, Cidade, UF) e
> Regime Tributário (por Opção MEI/Opção Simples).

**Botão Consultar CNPJ Básico (DirectD)** — `custrecord_pd_petr_vs_dd_basic_btn_cb`
> Adiciona ao Cliente/Fornecedor o botão "Consultar CNPJ Básico", que consulta o CNPJ na API
> Cadastro – Pessoa Jurídica – Básica da DirectD. É mais barata que a Plus, mas não traz Opção
> Simples nem Opção MEI. Se o CNPJ não for encontrado, consulta a Receita Federal – Pessoa Jurídica.
> Campos retornados pela DirectD: {CAMPOS_BASICO}
> Preenchidos no cadastro, conforme as opções "Atualizar ...": Razão Social, Nome Fantasia, Telefone
> com DDD, Endereço de E-mail e endereço (Logradouro, Número, Complemento, Bairro, CEP, Cidade, UF).
> O Regime Tributário fica em branco.

**Botão Consultar Inscrição Estadual (DirectD)** — `custrecord_pd_petr_vs_dd_ie_btn_cb`
> Adiciona ao Cliente/Fornecedor o botão "Consultar Inscrição Estadual", que consulta o CNPJ no
> Sintegra – Cadastros Estaduais da DirectD, na UF do endereço do cadastro (preencha o Estado antes
> de consultar).
> Campos retornados pela DirectD: {CAMPOS_SINTEGRA}
> Preenchido no cadastro: só a Inscrição Estadual (IE ou, sem ela, a inscrição habilitada da mesma
> UF em Lista de Inscrições Estaduais), quando o campo estiver vazio.

**Botão Consulta Completa (DirectD)** — `custrecord_pd_petr_vs_dd_full_btn_cb`
> Adiciona ao Cliente/Fornecedor o botão "Consulta Completa", que consulta o CNPJ na API
> Cadastro – Pessoa Jurídica – Plus e depois no Sintegra – Cadastros Estaduais, na UF retornada pela
> Plus. Se o CNPJ não for encontrado na Plus, consulta a Receita Federal – Pessoa Jurídica.
> Campos retornados pela Cadastro – Pessoa Jurídica – Plus: {CAMPOS_PLUS}
> Campos retornados pelo Sintegra: {CAMPOS_SINTEGRA}
> Preenchidos no cadastro, conforme as opções "Atualizar ...": os da Plus (Razão Social, Nome
> Fantasia, Telefone com DDD, Endereço de E-mail, endereço e Regime Tributário), mais a Inscrição
> Estadual do Sintegra (quando o campo estiver vazio). A Cidade usa a Informação do IBGE do Sintegra.

**ReceitaWS na Hierarquia (1º)** — `custrecord_pd_petr_vs_rws_in_chain_cb`
> Inclui o ReceitaWS como 1ª opção do botão "Consultar CNPJ" e da consulta automática. A ordem é
> sempre ReceitaWS → Hub do Desenvolvedor → DirectD; desmarcado, a consulta começa pelo próximo
> provedor marcado. O ReceitaWS também precisa estar habilitado na Configuração das APIs.

**Hub do Desenvolvedor na Hierarquia (2º)** — `custrecord_pd_petr_vs_hub_in_chain_cb`
> Inclui a Hub do Desenvolvedor como 2ª opção do botão "Consultar CNPJ" e da consulta automática,
> usada quando o ReceitaWS não responde ou está desmarcado. Sem saldo ou com a validade vencida, a
> Hub é pulada e a consulta segue para a DirectD, se marcada. Não afeta a consulta de CPF. A Hub
> também precisa estar habilitada na Configuração das APIs.

**DirectD na Hierarquia (3º)** — `custrecord_pd_petr_vs_dd_in_chain_cb`
> Inclui a DirectD como 3ª opção do botão "Consultar CNPJ" e da consulta automática, usada quando
> os provedores anteriores não respondem, estão desmarcados ou sem saldo. Escolha a consulta em
> "Consulta DirectD na Hierarquia". Não afeta os botões próprios da DirectD. A DirectD também
> precisa estar habilitada na Configuração das APIs.

**Consulta DirectD na Hierarquia** — `custrecord_pd_petr_vs_dd_chain_mode_ls`
> Consulta da DirectD usada quando "DirectD na Hierarquia" está marcado.
> Consulta Completa: Cadastro – Pessoa Jurídica – Plus + Sintegra, R$ 0,72 por consulta. CNPJ Plus:
> Cadastro – Pessoa Jurídica – Plus, R$ 0,36. CNPJ Básico: Cadastro – Pessoa Jurídica – Básica,
> R$ 0,16. Se o CNPJ não for encontrado, a consulta à Receita Federal – Pessoa Jurídica soma R$ 0,36.
> Valores padrão: o custo registrado segue os preços configurados na Configuração das APIs. Os campos
> retornados por cada consulta estão na ajuda dos campos "Preço ... (R$)" da Configuração das APIs.

Esse campo não repete as listas: com as três opções, o texto passaria do limite de 999 caracteres
do `<help>` (§10). Os valores citados são os padrões da §3.2; se a Dome mudar o preço padrão, a
ajuda precisa ser atualizada junto.

**Preço CNPJ Plus / Preço CNPJ Básico / Preço Sintegra (R$)** — `custrecord_pd_petr_as_dd_prc_plus_cr`,
`_dd_prc_basic_cr`, `_dd_prc_sint_cr`
> Preço em R$ de cada consulta {Cadastro – Pessoa Jurídica – Plus | Cadastro – Pessoa Jurídica –
> Básica | Sintegra – Cadastros Estaduais} na DirectD. Usado para registrar o consumo e calcular o
> saldo.
> Campos retornados pela DirectD: {CAMPOS_PLUS | CAMPOS_BASICO | CAMPOS_SINTEGRA}

**Preço Receita Federal PJ (R$)** — `custrecord_pd_petr_as_dd_prc_rfb_cr`
> Preço em R$ de cada consulta Receita Federal – Pessoa Jurídica na DirectD. Essa consulta não tem
> botão próprio: é feita quando o CNPJ não é encontrado na Cadastro – Pessoa Jurídica – Plus ou
> Básica. Usado para registrar o consumo e calcular o saldo.
> Campos retornados pela DirectD: {CAMPOS_RFB}
> Preenchidos no cadastro, conforme as opções "Atualizar ...": Nome Empresarial (Razão Social), Nome
> Fantasia, Telefone, Endereço Eletrônico (e-mail) e endereço (Logradouro, Número, Complemento,
> Bairro ou Distrito, CEP, Município, UF). Não traz Opção Simples/MEI.

## 6. Contratos de scripts

### 6.1 `pd-petr-directd-api.js`

- `getCompanyPlus(cnpj, options)` → `GET /api/CadastroPessoaJuridicaPlus?CNPJ={cnpj}`
- `getCompanyBasic(cnpj, options)` → `GET /api/CadastroPessoaJuridica?CNPJ={cnpj}`
- `getFederalRevenue(cnpj, options)` → `GET /api/ReceitaFederalPessoaJuridica?Cnpj={cnpj}`
- `getSintegra(cnpj, uf, options)` → `GET /api/Sintegra?Cnpj={cnpj}&Uf={uf}`
- `options.token` é obrigatório, enviado em `Authorization: Bearer`. CNPJ só com dígitos. Devolve o
  `response` cru (`{ code, body }`). Loga URL, status e corpo, nunca o token. Timeout padrão do
  `N/https`.

### 6.2 `pd-petr-directd-adapter.js`

- `toCanonical(retorno)` — CNPJ Plus/Básico:

  | Canônico | DirectD |
  |---|---|
  | `cnpj` | `cnpj` |
  | `razao_social` | `razaoSocial` |
  | `nome_fantasia` | `nomeFantasia` |
  | `descricao_situacao_cadastral` | `situacaoCadastral` |
  | `logradouro`, `numero`, `complemento`, `bairro`, `cep`, `uf`, `municipio` | `enderecos[0]` (`cidade` → `municipio`) |
  | `email` | `emails[0].enderecoEmail` |
  | `ddd_telefone_1` | `telefones[0].telefoneComDDD` |
  | `opcao_pelo_simples` / `opcao_pelo_mei` | `opcaoSimples` / `opcaoMEI` (valores conforme Parte 0; Básico: sempre falso) |
  | `regime_tributario` | `[]` |
  | `qsa` | `socios` (não mapeado, como hoje) |

- `toCanonicalFromFederalRevenue(retorno)` — Receita PJ: `numeroInscricao` → `cnpj`,
  `nomeEmpresarial` → `razao_social`, `bairroDistrito` → `bairro`, `enderecoEletronico` → `email`,
  `telefone` → `ddd_telefone_1`, demais por nome igual; Simples/MEI falsos.
- `toStateRegistration(retorno, uf)` — Sintegra → `{ inscricao_estadual, codigo_municipio_ibge,
  regime_apuracao }` (regra da IE em §4.4).

### 6.3 `pd-petr-directd-lookup.js`

- `lookup(mode, cnpj, options)` — `options.uf` só no `DD_IE`.
  - Sucesso: `{ success: true, provider: 'DIRECTD', data: <canônico>, warning?: { title, message } }`.
  - Falha: `{ success: false, reason, error }`, com `reason` em `NOT_FOUND`, `PROVIDER_ERROR`,
    `UNAUTHORIZED`, `NOT_ENABLED`, `CREDITS_EXHAUSTED`, `EXPIRED`, `MISSING_UF` ou `CPF_NOT_SUPPORTED`.
  - `error` já vem com a mensagem final. Nunca lança.
- No `DD_IE`, `data` traz só `inscricao_estadual` e a marca para o mapper preencher só a IE (§6.6).

### 6.4 `pd-petr-credit-usage.js`

- `track({ provider, queryType, document, credits?, cost?, queryUid? })` — grava uma linha. Nunca
  lança.
- `summarize(provider, from, to)` — soma por tipo de consulta (base do relatório da Hub).
- `checkBalance(provider, expectedAmount, settings)` → `{ allowed: true }` ou
  `{ allowed: false, reason: 'CREDITS_EXHAUSTED' | 'EXPIRED', error }` (§4.6).

### 6.5 RESTlet `pd-petr-entity-tax-registration.rl.js` (existente)

Corpo da requisição ganha `mode` (`LOOKUP_MODES`, padrão `DEFAULT`) e `uf` (só `DD_IE`):

- por `id` (modo view): `fetchCNPJForRecord(recordType, id, mode)` — no `DD_IE` lê a UF do
  record;
- por `cnpj` (create/edit): `fetchCompanyDataForCnpj(cnpj, birthDate, mode, uf)`.

Contrato de retorno inalterado (`{ success, warning?, error? }` / `{ success, data, ... }`).

### 6.6 `pd-petr-mapper.js` (existente)

`setFields(record, data, options)`:
- `options.writeStateRegistration` — grava a IE mesmo sem "Consultar Inscrição Estadual (Hub)"
  marcado (modos `DD_FULL` e `DD_IE`).
- `options.stateRegistrationOnly` — preenche só a IE (`DD_IE`).

Sem `options` → comportamento atual.

### 6.7 Client Script e `pd-petr-entity.js` (existentes)

- `fetchDirectdFull`, `fetchDirectdPlus`, `fetchDirectdBasic`, `fetchDirectdStateReg` →
  `entityService.fetchCNPJ(rec, recordMode, lookupMode)`. `fetchCNPJ()` atual e o autofetch do
  `saveRecord` seguem com `DEFAULT` (a hierarquia de §4.8 é resolvida no servidor).
- `DD_IE` em create/edit: lê a UF do endereço (§4.2) antes de chamar o RESTlet.

## 7. Fluxo de status

Não aplicável: as consultas são síncronas e pontuais, como no resto do módulo.

## 8. Permissões

Mesmo padrão do módulo: `customrecord_pd_petr_credit_usage` com
`accesstype=CUSTRECORDENTRYPERM`, campos com `accesslevel=2`, deployments existentes com
`allroles=T`. Nenhum papel novo.

**Risco aceito na semana de testes:** o token da Dome e o saldo ficam em
`customrecord_pd_petr_api_settings`, que o administrador do cliente pode ver e editar. O token fica
em campo Password (mascarado na tela), mas nenhuma configuração impede um administrador de alterar
o saldo. A exposição fica limitada à semana de teste e ao saldo carregado. Depois dela, o cliente
passa a usar o próprio token.

## 9. Fora de escopo

- Consulta de **CPF** na DirectD (o Sintegra aceita CPF, por exemplo produtor rural).
- Variantes `SintegraCCC` e `SintegraCCC-Completa`, modo assíncrono (`ASync`/webhook) e
  `GERARCOMPROVANTE`.
- DirectD no **relatório de créditos por e-mail**: o relatório continua só da Hub, agora lido do
  novo registro.
- **Migração** do histórico de `customrecord_pd_petr_hub_credit_usage` para o novo registro.
  Consequência: no ciclo do relatório em curso na data do deploy, o consumo anterior ao deploy não
  aparece.
- Mapeamento de sócios, filiais, CNAEs, porte, faturamento e natureza jurídica.
- Resolução de Lucro Presumido/Real pela DirectD.
- Ordem configurável entre ReceitaWS, Hub e DirectD (a ordem é fixa no código; o cliente só
  escolhe quem entra), e ReceitaWS/Hub como reserva dos botões da DirectD.
- Proteção do token e do saldo contra o administrador do cliente (risco aceito, §8).
- Configuração da liberação de IP no painel da DirectD: é operacional, pré-requisito na Parte 0.

## 10. Notas de implementação

Divergências entre o planejado e o implementado (Partes 1 a 15, em 04/11/2026):

- **Token DirectD em texto, não Password** (§3.2, §5.1, §8, Parte 3). Campo Password do NetSuite
  guarda o valor com hash de mão única, para comparação; o script não consegue ler o token de volta
  para montar o header `Authorization`. O campo foi criado como Free-Form Text,
  `custrecord_pd_petr_as_dd_token_ds`, igual aos tokens da Hub e do ReceitaWS. Consequência para o
  risco da §8: o token da Dome fica visível (não mascarado) para quem abre a Configuração das APIs.
- **`customrecord_pd_petr_credit_usage` com `accesstype=NONENEEDED`** (§8 previa
  `CUSTRECORDENTRYPERM`). Mesmo padrão de `customrecord_pd_petr_hub_credit_usage`: a linha é gravada
  e o saldo é somado pelos scripts com o papel do usuário que consultou, que pode não ter permissão
  no registro.
- **Nome da lista `customlist_pd_petr_dd_chain_mode`**: "PD | PETR | Consulta DirectD". O nome
  planejado passava do limite de 30 caracteres de custom list (erro no `project:validate`).
- **Custo previsto da Hub**: CNPJ = 1 crédito, com ou sem IE (já conferido em
  `hub-credit-control.md`, Notas de implementação) — esse item da Parte 0 não é mais necessário. No
  CPF fora da base sem data de nascimento, o saldo é checado para 15 créditos (nome_cpf + Receita)
  antes da primeira chamada paga, para não gastar os 10 do nome_cpf e parar sem saldo para os 5.
- **Sem registro de Configuração das Validações**, a hierarquia usa ReceitaWS e Hub (só pela
  habilitação na Configuração das APIs) e deixa a DirectD de fora — mantém o comportamento anterior.
- **`DD_IE` com IE já preenchida ou sem o campo no formulário**: o mapper não grava e devolve um
  aviso ("Inscrição Estadual mantida" / "não preenchida"), em vez de ignorar em silêncio.
- **Adapter escrito pelo exemplo da documentação** (Parte 10): `opcaoSimples`, `opcaoMEI` e
  `ativoHabilitada` aceitam "S", "SIM", "TRUE", "1", "OPTANTE", "ATIVA", "HABILITADA" etc. até a
  Parte 0 confirmar os valores reais.
- **Ajuda de campos existentes** atualizada para a hierarquia: "Habilitar ReceitaWS", "Habilitar Hub
  do Desenvolvedor" e "Consulta Automática de CPF/CNPJ". Após o primeiro deploy na sandbox, também
  "Botão "Consultar CPF/CNPJ"" (CNPJ segue a hierarquia; CPF sempre na Hub, independente dela) e
  "Consultar Inscrição Estadual (Hub)" (não se aplica à DirectD: a Consulta Completa sempre traz a
  IE pelo Sintegra; CNPJ Plus e Básico não trazem) e "Atualizar Todos os Campos" (cita os três
  provedores).
- **"Válido até" da DirectD removido** (§3.2, §4.6): a DirectD é cobrada por crédito, não por
  período. O campo `custrecord_pd_petr_as_dd_valid_to_dt` saiu do registro, do formulário e do código;
  a validade continua só na Hub. Como o deploy do SDF não apaga campos, ele é excluído à mão na conta
  onde já foi criado (sandbox da Dome).
- **`customrecord_pd_petr_hub_credit_usage` removido do projeto** (§4.5 previa mantê-lo como
  histórico). Nenhum script lê ou grava nele desde a troca para `customrecord_pd_petr_credit_usage`.
  O XML saiu de `src/Objects/`; como o deploy do SDF não apaga Objects, o registro é excluído à mão
  em cada conta (Personalização > Listas, Registros e Campos > Tipos de Registro), o que apaga
  também as linhas antigas.
- **Grupos do formulário de Validações reorganizados** após o primeiro deploy na sandbox (§5.2): o
  grupo "Consulta na Receita" misturava opções genéricas e da Hub. As genéricas ficaram em "Consulta
  de CPF/CNPJ", seguidas da hierarquia; as da Hub foram para o grupo novo "Hub do Desenvolvedor";
  "Atualização de Campos via Receita" virou "Atualização de Campos". Só o formulário mudou — campos
  e código não. O guia funcional e a documentação técnica ainda citam os nomes antigos dos grupos e
  são atualizados na próxima geração da documentação.
- **Validação local** (`suitecloud project:validate`): restavam dois erros que já existiam antes
  desta feature — `loglevel "  DEBUG"` (com espaços) em `customscript_pd_petr_data_lookup_sl.xml`,
  corrigido para `DEBUG` antes do deploy na sandbox, e a dependência `SUBSCRIPTIONBILLING` ausente
  do `manifest.xml` (aparece também no commit `3b12027`), que não barrou o deploy.
- **`<help>` limitado a 999 caracteres** (§5.7): o deploy recusou a ajuda dos campos com as listas
  de campos retornados (até 2.305 caracteres). Ficou assim: a lista completa de cada API está só na
  ajuda do campo de preço correspondente da Configuração das APIs ("Preço CNPJ Plus/CNPJ Básico/
  Sintegra/Receita Federal PJ (R$)"), com abertura curta; a ajuda de cada botão nas Validações diz o
  que o botão consulta, o que preenche no cadastro e em qual campo de preço está a lista completa. A
  ajuda do Preço CNPJ Plus ficou com 998 bytes (o limite pode ser contado em bytes; acentos ocupam 2).
- **Deploy na sandbox da Dome** (`11953512-sb1`) em 04/11/2026: `dryrun` e deploy concluídos, sem
  recusa dos formulários existentes (`_as2`/`_vs2` não foram necessários).
- **Saldo da DirectD controlado na própria DirectD** (decisão de 04/11/2026, depois do deploy): a
  recarga é feita pelo cliente no painel da DirectD, então os campos de saldo da DirectD no NetSuite
  ficam vazios por padrão (§4.6), e a recusa por falta de saldo da DirectD ganhou tratamento próprio
  (§4.1, `NO_BALANCE` em `pd-petr-directd-lookup.js`). A detecção (HTTP 402 ou mensagem com
  "saldo"/"crédito") é provisória até a Parte 0 mostrar a resposta real.
- **Mensagem única com Hub e DirectD bloqueadas** (05/11/2026): antes saía só a mensagem do último
  provedor bloqueado; agora a hierarquia junta os motivos dos dois (§4.6). `checkBalance` e o
  bloqueio da DirectD passaram a devolver também `detail`, o motivo curto.
- **Campo "Resposta da API"** (05/11/2026, pedido depois da implementação): o registro de consumo
  ganhou `custrecord_pd_petr_cu_api_response_lt` com o corpo da resposta de cada chamada cobrada
  (§4.5). Depois tornado oculto, a pedido.
- **Hub sem crédito carregado = desligada** (05/11/2026): "Créditos Carregados (Hub)" vazio deixava
  de ser "sem limite" e passou a desligar a Hub (§4.6, §4.8). Campos "Saldo Após a Consulta (Hub)"
  e "(R$)" adicionados ao registro de consumo (§4.5).
- **"Créditos Disponíveis" virou "Créditos Carregados"** (05/11/2026): só o rótulo mudou (scriptids
  `..._hub_avail_nu` e `..._dd_avail_cr` mantidos, para não perder os valores já preenchidos). O
  nome "Créditos Disponíveis" passou para os novos campos de saldo atual, calculados pelo User
  Event `customscript_pd_petr_as_ue` (§4.6).

## Checklist de implementação

- [ ] Parte 0 — Validação real da API com o token da Dome: uma resposta real de cada API (CNPJ Plus, Básico, Sintegra, Receita PJ) para confirmar os valores de §4.4; confirmar se respostas "não encontrado" são cobradas; confirmar o código HTTP e a `metaDados.mensagem` da recusa por falta de saldo (§4.1) e ajustar a detecção de `NO_BALANCE`; liberar no painel da DirectD os IPs de saída do NetSuite e testar uma chamada a partir da conta (o custo da Hub por CNPJ já foi conferido — §10)
- [x] Parte 1 — Objects: `customlist_pd_petr_api_provider` e `customlist_pd_petr_dd_chain_mode`
- [ ] Parte 2 — Object: `customrecord_pd_petr_credit_usage` ✔ + saved search `customsearch_pd_petr_cu_list` (pendente: criada na UI e importada após o deploy do record)
- [x] Parte 3 — Objects: campos novos em `customrecord_pd_petr_api_settings` + formulário `custform_pd_petr_as`, com o `<help>` da §5.7; confirmar se `custrecord_pd_petr_as_dd_token_pw` (Password) é legível via busca no servidor; se não for, usar `_ds`, como os tokens atuais
- [ ] Parte 4 — (Objects deployados na sandbox da Dome em 04/11/2026; pendente: marcar os dois campos de hierarquia no registro existente de cada conta) Objects: campos novos em `customrecord_pd_petr_validation_settings` + formulário `custform_pd_petr_vs`, com o `<help>` da §5.7 (validar com `dryrun`; se a atualização do formulário for recusada, criar `_as2`/`_vs2`; o `<help>` da Consulta Completa, com as listas da Plus e do Sintegra, tem cerca de 2.300 caracteres: se o deploy recusar pelo tamanho, trocar as listas por uma referência à ajuda dos botões Plus e Inscrição Estadual); após o deploy em cada conta já instalada, marcar "ReceitaWS na Hierarquia" e "Hub do Desenvolvedor na Hierarquia" no registro de Validações existente (§5.2)
- [x] Parte 5 — `pd-petr-constants.js`, `pd-petr-api-settings.js` e leitura dos novos campos das Validações; Client Script das Validações: dependência "DirectD na Hierarquia" → "Consulta DirectD na Hierarquia" e validação no save
- [x] Parte 6 — `pd-petr-credit-usage.js` (track, summarize, checkBalance) e troca dos usos de `pd-petr-hub-credit-usage.js`
- [x] Parte 7 — `pd-petr-credit-report.js` lendo o novo registro (provedor = Hub)
- [x] Parte 8 — `pd-petr-cnpj-lookup.js`: flags de hierarquia dos três provedores, 3º nível DirectD, mensagem de hierarquia vazia, checagem de saldo antes das chamadas pagas da Hub e novo caso especial de rate limit
- [x] Parte 9 — `pd-petr-directd-api.js`
- [ ] Parte 10 — `pd-petr-directd-adapter.js` (escrito pelo exemplo da documentação; falta conferir com as respostas reais da Parte 0)
- [x] Parte 11 — `pd-petr-directd-lookup.js` (modos, reserva na Receita PJ, UF, saldo, consumo)
- [x] Parte 12 — `pd-petr-mapper.js`: opções `writeStateRegistration` / `stateRegistrationOnly`
- [x] Parte 13 — `pd-petr-entity-lookup.js` + RESTlet: `mode`/`uf` e despacho por modo
- [x] Parte 14 — User Event (botões), Client Script (funções de clique) e `pd-petr-entity.js` (modo no `fetchCNPJ`, autofetch do save, UF no `DD_IE`)
- [x] Parte 15 — Atualizar `<description>` dos Objects de deployment (UE/CL/RL) e o `<help>` dos campos alterados

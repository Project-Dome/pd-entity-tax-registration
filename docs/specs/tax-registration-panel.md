# Especificação — Painel do Cadastro Fiscal

Feature incremental sobre o módulo já documentado em `docs/specs/entity-tax-registration.md` e
`docs/specs/directd-integration.md`. Cria uma tela para o funcionário (Suitelet) com duas abas:

- **Consumo de Créditos** — consulta dos registros de `customrecord_pd_petr_credit_usage`, com o saldo
  atual de cada provedor pago.
- **Clientes e Fornecedores** — lista de entidades com CPF/CNPJ, filtrada por tipo e nome, onde o
  funcionário marca as linhas e atualiza os dados cadastrais em massa pela consulta de CPF/CNPJ.

## 1. Objetivo

Hoje a atualização dos dados cadastrais é feita registro a registro (botões no Customer/Vendor) ou na
importação por CSV, e o consumo das APIs pagas só aparece na lista do custom record. O painel junta as
duas coisas numa tela só:

- visualizar o que foi consumido, por quem, e quanto resta de crédito;
- atualizar várias entidades de uma vez, escolhendo a consulta, sem abrir cada cadastro.

## 2. Arquitetura

Segue o padrão **Suitelet-casca** do projeto de referência
`C:\pd_p\pd-dbanking\db-ns\src\FileCabinet\SuiteScripts\dome\dbanking\remittance_file`
(`pd-dbk-batch-send.sl.js` + `static/html|js|css/pd-dbk-batch-send.*` + `pd-dbk-batch-send.rl.js`):

- O **Suitelet** não tem lógica: monta a página com o helper `util/pd-petr-suitelet.js` (cópia de
  `dbanking/util/pd-dbk-suitelet.js`), que carrega os estáticos do File Cabinet, jQuery 3.7.1 e
  Bootstrap 5.3.3 por CDN, e grava os parâmetros da página em `SUITELET_PARAMETERS` (URLs dos RESTlets,
  usuário logado, `homeUrl`).
- Um **RESTlet novo do painel** atende só as leituras (GET): configuração/saldo, lista de consumo e
  lista de entidades. Toda a lógica fica num service novo.
- A **atualização** reaproveita o RESTlet que já existe (`customscript_pd_petr_tax_reg_rl`, ação por id
  → `fetchCNPJForRecord`), chamado pelo navegador **uma entidade por vez**. Cada chamada tem a própria
  cota de governança, as consultas nunca rodam em paralelo contra o mesmo saldo, e o progresso aparece
  linha a linha. Um POST único com todas as entidades estouraria a governança em ~15–20 entidades.
- O JS estático chama os RESTlets sempre pelo helper `restlet(options)` com `$.ajax` (nunca `fetch`,
  que não envia o cookie de sessão para o domínio dos RESTlets) — mesmo helper da referência.

Diferenças em relação à referência: a referência não tem paginação nem rolagem na tabela; aqui as duas
tabelas têm **paginação server-side + rolagem com cabeçalho fixo** (`suitescript-scaffold`,
`references/ui-patterns.md`), e a página tem **abas**.

### 2.1 Peças

| Peça | Arquivo | Novo/existente |
|---|---|---|
| Suitelet-casca | `pd_petr_suitelet/pd-petr-tax-registration-panel.sl.js` | novo |
| Helper de montagem da página | `util/pd-petr-suitelet.js` | novo (cópia da referência) |
| HTML / CSS / JS estáticos | `static/html/pd-petr-tax-registration-panel.html`, `static/css/pd-petr-tax-registration-panel.css`, `static/js/pd-petr-tax-registration-panel-ui.js` | novos |
| RESTlet de leitura do painel | `restlet/pd-petr-tax-registration-panel.rl.js` | novo |
| Service do painel | `service/pd-petr-tax-registration-panel.js` | novo |
| RESTlet de atualização | `restlet/pd-petr-entity-tax-registration.rl.js` | existente, sem mudança |
| Enriquecimento por id | `service/pd-petr-entity-lookup.js` (`fetchCNPJForRecord`) | existente, ajuste em §4.4 |
| Saldo e lista de consumo | `service/pd-petr-credit-usage.js` (`getCurrentBalance`, `list`) | existente, ganha as duas funções (§10) |

Caminhos relativos a `src/FileCabinet/SuiteScripts/product_dome/pd_entity_tax_registration/`. O helper
localiza os estáticos **pelo nome do arquivo em todo o File Cabinet** — por isso os nomes levam o
prefixo `pd-petr-` e precisam ser únicos na conta.

## 3. Telas / Interfaces

Layout da referência: cabeçalho branco com botão "NetSuite" (volta para `/app/center/card.nl`), título
**"Cadastro Fiscal — Painel"** e avatar/nome/papel do usuário; logo abaixo, as três abas (Bootstrap
`nav-tabs`). As duas primeiras têm: card de filtros → cards de indicadores → card da tabela; a
terceira (§3.3) é só informativa. Overlay de carregamento e modal de aviso/confirmação
compartilhados. Aba inicial: **Consumo de Créditos**.

Não há link no menu do NetSuite (decisão do usuário): o acesso é pela URL da implantação, e cada
cliente cria o atalho na central ou nos favoritos.

### 3.1 Aba "Consumo de Créditos" (somente leitura)

**Filtros**

| Filtro | Tipo | Padrão |
|---|---|---|
| Data (De) | data | 1º dia do mês atual |
| Data (Até) | data | hoje |
| Provedor | seleção: Todos / Hub do Desenvolvedor / DirectD | Todos |
| CPF/CNPJ | texto (contém; comparado só pelos dígitos/letras) | vazio |

Botões "Aplicar Filtro" e "Limpar Filtro" (limpar volta ao padrão, não ao vazio). A aba carrega
automaticamente com o filtro padrão ao abrir a página.

**Indicadores** (4 cards)

| Card | Valor |
|---|---|
| Créditos Disponíveis (Hub) | saldo atual da Hub (`calculateBalance('HUB')`); "Desligada" se a Hub não estiver ativa (`hubEnabled` + Créditos Carregados > 0) |
| Créditos Disponíveis (R$) | saldo atual da DirectD; "Sem limite" se Créditos Carregados (R$) vazio; "Desligada" se a DirectD estiver desabilitada |
| Créditos Hub no período | soma de Créditos Consumidos (Hub) **do filtro aplicado** (todas as páginas) |
| Custo DirectD no período | soma de Custo (R$) **do filtro aplicado** (todas as páginas) |

Os dois primeiros são o saldo de agora (não dependem do filtro de data); os dois últimos seguem o filtro.

**Tabela** — ordenada por data decrescente, 100 linhas por página.

| Coluna | Origem (`customrecord_pd_petr_credit_usage`) |
|---|---|
| Data/Hora | `created` |
| Provedor | `custrecord_pd_petr_cu_provider_ls` (texto) |
| Tipo de Consulta | `custrecord_pd_petr_cu_query_type_ds` |
| CPF/CNPJ | `custrecord_pd_petr_cu_document_ds` |
| Créditos | `custrecord_pd_petr_cu_credits_nu` (Hub) |
| Custo (R$) | `custrecord_pd_petr_cu_cost_cr` (DirectD) |
| Saldo Após | `custrecord_pd_petr_cu_hub_balance_nu` ou `custrecord_pd_petr_cu_dd_balance_cr`, conforme o provedor (vazio nas linhas anteriores ao campo) |
| Usuário | `custrecord_pd_petr_cu_user_ls` (texto) |

"Resposta da API" (`custrecord_pd_petr_cu_api_response_lt`) **não** aparece — o campo é oculto por
decisão anterior (`directd-integration.md` §4.5).

Botão **"Exportar CSV"** no cabeçalho da tabela: exporta as linhas da **página carregada**, separador
`;`, com BOM UTF-8 (mesma função da referência).

### 3.2 Aba "Clientes e Fornecedores"

**Filtros**

| Filtro | Tipo | Padrão |
|---|---|---|
| Tipo | seleção obrigatória: Cliente / Fornecedor | Cliente |
| Nome | texto (contém) | vazio |

O filtro de Nome compara com `entityid`, `companyname` (Razão Social) e `legalname` (Nome Fantasia) —
basta bater com um dos três. A aba só busca quando o funcionário clica em "Aplicar Filtro" (antes
disso, a tabela mostra "Use os filtros acima para carregar as entidades.").

Critérios fixos da busca: entidade ativa (`isinactive = F`) **e** CPF/CNPJ preenchido
(`custentity_brl_entity_t_fed_tax_reg` não vazio) — só essas podem ser atualizadas.

**Indicadores** (3 cards): Entidades encontradas (total do filtro), Selecionadas, e um card com os dois
saldos atuais (Hub e R$, mesmos valores da §3.1), atualizado ao fim de cada atualização em massa.

**Tabela** — ordenada pela Razão Social (`companyname`) e depois pelo `entityid`, 50 linhas por página.
Mostra **todos os campos que as consultas (`pd-petr-mapper.js`) gravam**, para o funcionário ver o
que está vazio antes de atualizar e conferir o resultado depois. Com muitas colunas, a tabela rola
também na horizontal, com a coluna de seleção e a do Nome fixas à esquerda.

| Coluna | Origem |
|---|---|
| ☐ (checkbox + "selecionar todas" da página) | — |
| Nome | `legalname` (Nome Fantasia), senão `companyname`, senão `entityid` — link que abre o cadastro em nova aba. Sem coluna Resultado: o selo de resultado da atualização (§4.3) aparece abaixo do link, só depois de atualizar |
| País | `custentity_pd_petr_country_ls` — **campo de seleção editável** na linha (ver abaixo) |
| CPF/CNPJ | `custentity_brl_entity_t_fed_tax_reg` |
| Razão Social | `companyname` |
| Nome Fantasia | `legalname` |
| Nome (PF) | `firstname` — nome gravado pela consulta de CPF |
| Data de Nascimento | `custentity_pd_petr_birth_date_dt` |
| Inscrição Estadual | `custentity_brl_entity_t_state_tx_reg` |
| Regime Tributário | `custentity_fte_entity_l_taxregime` (texto) |
| Telefone | `phone` |
| E-mail | `email` |
| CEP | `billzipcode` |
| Logradouro | `billaddress1` |
| Número | `billaddress3` |
| Complemento | `custrecord_brl_addrform_t_complement` do endereço de faturamento (join `billingAddress`) |
| Bairro | `billaddress2` |
| Cidade | `billcity` |
| UF | `billstate` |
| Última Alteração | `lastmodifieddate` |

**País editável na tabela.** A consulta recusa cadastro sem País ("Por favor, preencha o campo País
primeiro.", `pd-petr-entity-lookup.fetchCNPJForRecord`), e o campo é obrigatório no cadastro. Por
isso a coluna País é um campo de seleção em cada linha:

- As opções são as do próprio campo `custentity_pd_petr_country_ls`, lidas no servidor
  (`getSelectOptions` num Customer em modo dynamic, sem salvar) e entregues no `settings`.
- Ao escolher um país, o painel grava **na hora só esse campo** (`record.submitFields`, ignorando
  outros obrigatórios) pela ação POST `setCountry` do RESTlet do painel; o campo fica travado
  durante a gravação, e em caso de falha volta ao valor anterior com a mensagem do erro.
- Linha sem País fica destacada; "Atualizar" com alguma selecionada sem País não consulta e pede
  para preencher o País dessas linhas primeiro.
- Durante a atualização em massa os campos País ficam travados, como os demais controles.

Colunas opcionais (`legalname`, País, Complemento via join, Data de Nascimento, Regime Tributário): se a
busca recusar alguma delas na conta, ela é repetida só com as colunas nativas e as opcionais ficam
"—", em vez de quebrar a tela.

Ao fim de uma atualização em massa, a página atual é recarregada **mantendo os resultados por linha**,
para os campos mostrarem os valores gravados.

A seleção vale **só para a página atual**: trocar de página ou aplicar filtro limpa a seleção (mesmo
comportamento da referência).

**Barra de ação flutuante** (aparece com ≥ 1 linha marcada): "N entidade(s) selecionada(s)", campo de
seleção **Consulta** e os botões "Limpar seleção" e **"Atualizar"**.

Opções do campo Consulta:

| Opção | Modo (`LOOKUP_MODES`) | Aparece quando |
|---|---|---|
| Hierarquia padrão (ReceitaWS → Hub → DirectD) | `DEFAULT` | sempre (padrão do campo) |
| DirectD — Consulta Completa | `DD_FULL` | "Habilitar Botão Consulta Completa" marcado nas Validações |
| DirectD — CNPJ Plus | `DD_PLUS` | `enableDirectdPlusButton` |
| DirectD — CNPJ Básico | `DD_BASIC` | `enableDirectdBasicButton` |
| DirectD — Inscrição Estadual | `DD_IE` | `enableDirectdStateRegButton` |

As opções DirectD também exigem a DirectD habilitada na Configuração das APIs (mesma regra dos botões
no cadastro).

### 3.3 Aba "Retorno das APIs" (informativa)

Guia estático de **o que cada consulta devolve e onde isso é gravado**, para o funcionário escolher a
consulta certa na barra de ação. Conteúdo fixo no HTML (sem chamada ao RESTlet), escrito a partir dos
adapters (`pd-petr-receitaws-adapter`, `pd-petr-hub-adapter`, `pd-petr-directd-adapter`) e do
`pd-petr-mapper` — mudou um deles, atualizar a aba junto. Nada de token ou credencial no texto.

**Cards por provedor** (um por coluna):

| Provedor | Conteúdo |
|---|---|
| ReceitaWS | 1º da hierarquia; só CNPJ; gratuita, com limite de consultas por minuto; sem Inscrição Estadual e sem código IBGE |
| Hub do Desenvolvedor | 2º da hierarquia; CNPJ (1 crédito, com ou sem Inscrição Estadual) e **CPF — único provedor de CPF** (1 crédito na base da Hub, 5 na Receita Federal com data de nascimento, 10 na busca de data de nascimento); não informa regime tributário |
| DirectD | 3º da hierarquia (modo configurado) e opções avulsas da barra de ação; só CNPJ; custo em R$ pelo preço configurado de cada consulta. Explica as quatro consultas: CNPJ Plus (cadastro + Simples/MEI), CNPJ Básico (cadastro sem Simples/MEI), Receita Federal PJ (reserva quando Plus/Básico não encontra) e Sintegra (Inscrição Estadual, código IBGE e regime de apuração) |

**Tabela "Campo do NetSuite × Provedor"** — colunas: Campo no NetSuite, ReceitaWS, Hub, DirectD,
Regra de gravação. Cada célula de provedor mostra o campo de origem na resposta ou "—" quando o
provedor não traz o dado.

| Campo no NetSuite | ReceitaWS | Hub | DirectD | Regra de gravação |
|---|---|---|---|---|
| Razão Social (`companyname`) | `nome` | `nome` | `razaoSocial` (Plus/Básico) / `nomeEmpresarial` (Receita PJ) | sempre sobrescreve ("Atualizar Razão Social") |
| Nome Fantasia (`legalname`) | `fantasia` | `fantasia` | `nomeFantasia` | só se vazio ("Atualizar Nome Fantasia") |
| Telefone | `telefone` (1º número) | `telefone` (1º número) | `telefones[0]` / `telefone` (Receita PJ) | só se vazio, formatado (DD) NNNN-NNNN |
| E-mail | `email` | `email` | `emails[0]` / `enderecoEletronico` (Receita PJ) | só se vazio |
| Inscrição Estadual | — | IE da UF de origem, senão a IE ativa da UF ("Consultar Inscrição Estadual (Hub)") | Sintegra: `ie`, senão a IE habilitada da UF (Consulta Completa e Inscrição Estadual) | só se vazio |
| Regime Tributário | Simples/MEI | — | Plus: Simples/MEI; Receita PJ: regime de apuração do Sintegra; Básico: — | só se vazio; Simples ou MEI → "Optante pelo Simples Nacional" |
| Endereço (CEP, Logradouro, Número, Complemento, Bairro, UF) | campos diretos | campos diretos | 1º item de `enderecos` / campos diretos (Receita PJ) | nova linha só se o CEP não existir no cadastro; Logradouro, Bairro e UF vêm da consulta de CEP quando ela responde |
| Cidade | por CEP ou município + UF | por CEP ou município + UF | código IBGE do Sintegra, senão CEP ou município + UF | dentro da linha nova de endereço |
| Nome (PF) (`firstname`) | — | `nome_da_pf` (CPF) | — | sempre sobrescreve |
| Data de Nascimento | — | data de nascimento (CPF) | — | só se vazio |

Rodapé da aba, como observações: a Situação Cadastral (CNPJ "ATIVA", CPF "REGULAR") não é gravada —
fora disso a consulta grava e devolve aviso; o quadro de sócios vem nas respostas de CNPJ, mas não é
gravado; cada "Atualizar …" é uma opção da Configuração das Validações.

Durante a atualização em massa, a aba fica travada como a de Consumo de Créditos.

## 4. Critérios e regras de negócio

### 4.1 Confirmação antes de atualizar

Clicar em "Atualizar" abre o modal de confirmação:

- Sempre: "Atualizar N entidade(s) com {Consulta}? Os campos atualizados seguem as opções de
  'Atualização de Campos' da Configuração das Validações."
- Modo DirectD: "Custo estimado: R$ X (N × R$ preço)". Preço por modo: Completa = CNPJ Plus + Sintegra;
  Plus = CNPJ Plus; Básico = CNPJ Básico; Inscrição Estadual = Sintegra (preços da Configuração das
  APIs). Linhas de CPF entram na contagem mas a DirectD as recusa (só CNPJ — §4.3).
- Hierarquia padrão com ReceitaWS na hierarquia: "A ReceitaWS (gratuita) atende até {Limite por Minuto}
  consultas por minuto; acima disso as consultas seguem para a Hub do Desenvolvedor/DirectD e consomem
  créditos." (decisão do usuário: **seguir a hierarquia**, sem esperar a cota gratuita).

### 4.2 Execução

- Chamadas em sequência, uma por entidade, ao RESTlet existente:
  `POST customscript_pd_petr_tax_reg_rl` com `{ recordType: 'customer' | 'vendor', id, mode }`.
- Durante a execução: a barra de ação mostra "Atualizando X de N…", e checkboxes, filtros, abas,
  paginação e botões ficam desabilitados. Fechar/recarregar a página pede confirmação do navegador
  (`beforeunload`); a entidade em andamento termina no servidor, as seguintes não são processadas.
- A página não recarrega a lista ao terminar (para manter a coluna Resultado visível). "Última
  Alteração" só se atualiza ao aplicar o filtro de novo.
- Ao terminar (ou interromper): modal com o resumo ("X atualizadas, Y com aviso, Z com erro, W não
  executadas") e recarga dos saldos (§3.1, cards de saldo).

### 4.3 Resultado por linha

| Retorno do RESTlet | Coluna Resultado |
|---|---|
| `success: true`, sem `warning` | badge verde **Atualizado** |
| `success: true`, com `warning` | badge amarelo **Atualizado com aviso** — clicar mostra a mensagem |
| `success: false` | badge vermelho **Erro** — clicar mostra `error` |
| falha da chamada HTTP (rede, sessão expirada, erro do RESTlet) | badge vermelho **Erro** com a mensagem do `$.ajax`; a execução segue para a próxima |
| não processada por interrupção | badge cinza **Não executado** |

CPF em modo DirectD: a DirectD só aceita CNPJ (`pd-petr-directd-lookup.js`), então a linha termina em
**Erro** com a mensagem da DirectD — não é tratado à parte.

### 4.4 Interrupção e espera

- **Interrompe** a execução (linhas seguintes viram "Não executado") quando o `reason` do retorno é um
  bloqueio que valeria para todas as próximas: `EXPIRED`, `NO_BALANCE`, `BALANCE_CHECK_ERROR`,
  `ALL_PROVIDERS_BLOCKED`, `NO_PROVIDER_IN_CHAIN`, ou quando falta o registro de Configuração das
  Validações (mensagem `MISSING_SETTINGS_MESSAGE`, hoje sem `reason` — passar a devolver
  `reason: 'MISSING_SETTINGS'`). O modal mostra a mensagem do bloqueio + a orientação de acionar a Dome
  já usada na tela do cadastro (`SUPPORT_CONTACT_MESSAGE`).
- **Espera e tenta de novo a mesma entidade** quando o `reason` é `RATE_LIMIT_NO_FALLBACK` (ReceitaWS é
  o único provedor da hierarquia e a cota do minuto acabou): a barra mostra "Aguardando a cota da
  ReceitaWS (Ns)…" e repete após `retryAfterSeconds`. Ajuste necessário em `fetchCNPJForRecord`: repassar
  `retryAfterSeconds` do resultado da consulta (hoje só devolve `error` e `reason`).
- Qualquer outro erro marca a linha e segue.

### 4.5 Saldo

- O painel não faz checagem de saldo própria: cada chamada passa pelo `checkBalance` de sempre (que
  bloqueia quando o saldo não cobre a consulta). A interrupção da §4.4 só evita insistir depois do
  primeiro bloqueio.
- O RESTlet do painel **nunca devolve tokens** — a ação `settings` devolve só flags, saldos, preços e o
  limite por minuto da ReceitaWS.

## 5. Registros e campos envolvidos

Nenhum Object declarativo novo (custom record/field/form). Só leitura dos já existentes:

- `customrecord_pd_petr_credit_usage` — campos da tabela em §3.1 (`accesstype` NONENEEDED: todo papel lê).
- `customrecord_pd_petr_api_settings` — `rwsEnabled`, `rwsRateLimit`, `hubEnabled`, `hubLoadedCredits`,
  `hubCountStart`, `ddEnabled`, `ddPricePlus`, `ddPriceBasic`, `ddPriceSintegra`, `ddLoadedCredits`,
  `ddCountStart` (via `pd-petr-api-settings.js`).
- `customrecord_pd_petr_validation_settings` — `rwsInChain` e as flags `enableDirectd*Button` (via
  `pd-petr-validation-settings.get()`).
- Customer / Vendor — `entityid`, `companyname`, `legalname`, `custentity_brl_entity_t_fed_tax_reg`,
  `billcity`, `billstate`, `lastmodifieddate`, `isinactive`.

`pd-petr-constants.js`, acréscimos:

- `SCRIPTS.PANEL_RESTLET: { SCRIPT_ID: 'customscript_pd_petr_tax_reg_panel_rl', DEPLOY_ID: 'customdeploy_pd_petr_tax_reg_panel_rl' }`
- `PANEL: { ACTIONS: { SETTINGS: 'settings', CREDIT_USAGE: 'creditUsage', ENTITIES: 'entities' }, CREDIT_USAGE_PAGE_SIZE: 100, ENTITIES_PAGE_SIZE: 50, STATICS: { HTML, CSS, JS } }`
- Campos de entidade que faltam em `ENTITY.FIELDS`: `entityId`, `billCity`, `billState`, `lastModified`, `isInactive`.

## 6. Contratos de scripts

Scriptids seguem o padrão do RESTlet atual (`customscript_pd_petr_tax_reg_rl`): `tax_reg` é a mesma
abreviação de "tax registration" já usada no módulo, necessária para caber no limite de 40 caracteres.

### 6.1 Suitelet `pd_petr_suitelet/pd-petr-tax-registration-panel.sl.js`

- `customscript_pd_petr_tax_reg_panel_sl` (37) / `customdeploy_pd_petr_tax_reg_panel_sl` (37).
- Nome: "PD | PETR | Tax Registration Panel SL". Implantação: todos os papéis, todos os funcionários,
  sem `runasrole`, sem `<links>`.
- `onRequest` (GET): `suiteletUtil.build({ title: 'Cadastro Fiscal — Painel', jquery: true, bootstrap: true, statics, parameters: { homeUrl, panelUrl, updateUrl } })`,
  com `panelUrl` = `url.resolveScript` do RESTlet do painel e `updateUrl` = do RESTlet existente.

### 6.2 RESTlet `restlet/pd-petr-tax-registration-panel.rl.js`

- `customscript_pd_petr_tax_reg_panel_rl` (37) / `customdeploy_pd_petr_tax_reg_panel_rl` (37), todos
  os papéis, só `getfunction`.
- `get(parameters)` despacha por `parameters.action` para o service; erro → `{ success: false, error }`;
  sucesso → `{ success: true, data }`.

| `action` | Parâmetros | `data` |
|---|---|---|
| `settings` | — | `{ balances: { hub: { status: 'ACTIVE'\|'DISABLED', available }, directd: { status: 'ACTIVE'\|'DISABLED'\|'UNLIMITED', available } }, modes: [{ id, label }], prices: { DD_FULL, DD_PLUS, DD_BASIC, DD_IE }, receitaWs: { inChain, rateLimit } }` |
| `creditUsage` | `startDate`, `endDate` (DD/MM/AAAA), `provider` (`''`\|`HUB`\|`DIRECTD`), `document`, `page` | `{ count, pageCount, page, totals: { hubCredits, directdCost }, rows: [...] }` |
| `entities` | `entityType` (`customer`\|`vendor`, obrigatório), `name`, `page` | `{ count, pageCount, page, rows: [{ id, entityId, country, corporateName, tradeName, document, ... }] }` (colunas da §3.2) |

`post(body)` — escrita pontual do painel, mesma resposta `{ success, data }` / `{ success: false, error }`:

| `body.action` | Campos | `data` |
|---|---|---|
| `setCountry` | `recordType` (`customer`\|`vendor`), `id`, `country` (internal id da opção) | `{ id, country }` |

O `settings` passa a devolver também `countries: [{ id, text }]` (opções do campo País; lista vazia se
a leitura falhar — a coluna fica só leitura).

### 6.3 Service `service/pd-petr-tax-registration-panel.js`

- `getSettings()`, `listCreditUsage(filters)`, `listEntities(filters)` — server-only.
- `listCreditUsage`: SuiteQL paginado (`query.runSuiteQLPaged`, como a referência) sobre
  `customrecord_pd_petr_credit_usage`; provedor filtrado pelo texto da lista (`BUILTIN.DF`) comparado
  com `CREDIT_USAGE.PROVIDERS[*].label`, mesmo padrão de `REPORT_FREQUENCY`. Os totais saem de um
  `SUM` sobre o mesmo filtro, sem paginação.
- `listEntities`: `search.create({ type: entityType }).runPaged({ pageSize: 50 })`, com os critérios da
  §3.2 (nome em `entityid` OR `companyname` OR `legalname`, `contains`).
- Tamanho de página com teto (`MAX_PAGE_SIZE`), nunca a tabela inteira.

### 6.4 `service/pd-petr-entity-lookup.js` (existente)

- `fetchCNPJForRecord`: repassar `retryAfterSeconds` do resultado da consulta; devolver
  `reason: 'MISSING_SETTINGS'` quando não há registro de Validações (§4.4). Sem outra mudança — o botão
  do cadastro continua igual.

### 6.5 `service/pd-petr-credit-usage.js` (existente)

- Exportar `calculateBalance` (hoje interno) para o service do painel.

## 7. Fluxo de status

Não há registro com ciclo de vida. O único estado é o da coluna Resultado na tela (§4.3), que existe só
até a próxima busca.

## 8. Permissões

- Suitelet e RESTlet do painel implantados para **todos os papéis** (decisão do usuário), executando
  com o papel do usuário logado.
- Aba Consumo: o custom record é `NONENEEDED`, então todo papel vê o consumo e os custos.
- Aba Clientes e Fornecedores: a busca respeita a permissão do papel — sem acesso a Cliente/Fornecedor,
  a lista vem vazia ou com erro de permissão (mostrado no modal). Atualizar exige permissão de edição,
  como o botão no cadastro.

## 9. Fora de escopo

- Link no menu do NetSuite (acesso pela URL da implantação).
- Opção "Todos" no tipo de entidade; filtros por CNPJ, cidade ou subsidiária na aba de entidades.
- Seleção que atravessa páginas; atualização assíncrona (Map/Reduce) ou agendada.
- Esperar a cota gratuita da ReceitaWS antes de cair nos provedores pagos (só quando não há provedor
  pago na hierarquia — §4.4).
- Editar ou excluir registros de consumo pelo painel; exibir a "Resposta da API".
- Exportação CSV na aba de entidades; exportação de todas as páginas do consumo.
- Reserva de crédito antes da consulta (discutida em `directd-integration.md`, sem decisão).

## 10. Notas de implementação

- **Lista de consumo em `pd-petr-credit-usage.list`, com N/search (não SuiteQL).** Fica no service do
  próprio record (regra "um service por record"), e o painel só delega. `search.runPaged` devolve a
  data/hora já no fuso e no formato do usuário; com SuiteQL seria preciso converter. Os totais do
  período saem de uma busca com `SUM` sobre o mesmo filtro. As datas do filtro chegam em ISO
  (AAAA-MM-DD, do `<input type="date">`) e são convertidas com `N/format` no servidor.
- **`getCurrentBalance` em vez de exportar `calculateBalance`.** Devolve o saldo já arredondado (ou
  `null` sem Créditos Carregados) e lança em caso de erro; o painel mostra "Erro ao calcular" no card.
- **Lista de entidades no service do painel**, não em `pd-petr-customer.js`/`pd-petr-vendor.js` (esses
  são exclusivos do Suitelet anônimo de busca). Se a conta recusar `legalname` na busca de
  Customer/Vendor, a busca é repetida sem ele e a coluna Razão Social fica "—".
- **Coluna Nome:** o link mostra o Nome Fantasia (`legalname`), ou a Razão Social (`companyname`),
  ou o `entityid` como último recurso, sem exibir o ID. A sandbox usa numeração automática, e o
  `entityid` puro como link ficava só "1", "2", "101". A coluna **Razão Social** mostra `companyname`,
  o campo que o mapper grava a partir de `razao_social`. As chaves de `ENTITY.FIELDS` estão trocadas
  em relação ao conteúdo (`tradeName` = `companyname`, `companyName` = `legalname`); por isso a linha
  devolvida pelo service usa `corporateName` (companyname) e `tradeName` (legalname). A lista é
  ordenada pela Razão Social e depois pelo ID.
- **Cache dos estáticos:** o helper acrescenta `v=<data de alteração>` à URL do CSS/JS, para o
  navegador baixar a versão nova a cada deploy (sem isso, o JS antigo em cache mostrava o ID como
  link depois da troca das propriedades do service).
- **Interrupção também com bloqueio único na hierarquia.** No modo Hierarquia padrão, quando só um
  provedor pago bloqueou (ex.: Hub sem saldo e DirectD fora da hierarquia), o `reason` vem com o
  motivo desse bloqueio (`NO_BALANCE` etc.) e a execução para — escolha conservadora, mesmo que a
  ReceitaWS pudesse atender alguma entidade seguinte no minuto seguinte.
- **`<getfunction>` removido** de `customscript_pd_petr_tax_reg_panel_rl.xml`: o SDF avisa que o campo
  não é aceito no deployment e o ignora (no 2.x a função vem do próprio script).
- **Pontos a confirmar com papéis restritos** (sandbox testada só como Administrador):
  `customrecord_pd_petr_api_settings` é `CUSTRECORDENTRYPERM` — papel sem permissão nele vê os saldos
  como "Desligada" e só a Hierarquia padrão no campo Consulta (a mesma leitura já acontece no botão do
  cadastro). O helper do Suitelet procura os estáticos com uma busca de `file`, que pode exigir a
  permissão "Documentos e Arquivos" no papel.
- Deploy na sandbox `11953512_SB1` em 06/11/2026 (Suitelet, RESTlet, estáticos e services).
- **JS estático renomeado para `pd-petr-tax-registration-panel-ui.js`.** O nome original era igual ao do
  service (`service/pd-petr-tax-registration-panel.js`), e a busca de `file` por nome do helper serviu o
  service ao navegador: o JS da tela não rodava (cabeçalho do usuário vazio, e o submit nativo do filtro
  perdia `script`/`deploy` da URL — "This request is missing a required parameter"). O helper agora lança
  `DUPLICATE_FILE_NAME` quando o nome aparece mais de uma vez. O arquivo antigo
  `static/js/pd-petr-tax-registration-panel.js` continua na conta e pode ser excluído do File Cabinet.

## Checklist de implementação

- [x] Parte 1 — `pd-petr-constants.js` (§5) e `util/pd-petr-suitelet.js` (cópia do helper da referência)
- [x] Parte 2 — `pd-petr-credit-usage.js` com `getCurrentBalance` e `list` (§10); `pd-petr-entity-lookup.js` com `retryAfterSeconds` e `reason: 'MISSING_SETTINGS'` (§6.4)
- [x] Parte 3 — Service `pd-petr-tax-registration-panel.js` (`getSettings`, `listCreditUsage`, `listEntities`)
- [x] Parte 4 — RESTlet `pd-petr-tax-registration-panel.rl.js` + `customscript_pd_petr_tax_reg_panel_rl.xml`
- [x] Parte 5 — Suitelet `pd-petr-tax-registration-panel.sl.js` + `customscript_pd_petr_tax_reg_panel_sl.xml`
- [x] Parte 6 — Estáticos: HTML (cabeçalho, abas, filtros, cards, tabelas, barra de ação, overlay, modal) e CSS (tema da referência + rolagem com cabeçalho fixo)
- [x] Parte 7 — JS da aba Consumo de Créditos (filtro padrão, cards, paginação, CSV)
- [x] Parte 8 — JS da aba Clientes e Fornecedores (busca, seleção, confirmação, execução sequencial, resultado por linha, interrupção/espera, resumo)
- [ ] Parte 9 — Deploy na sandbox `11953512_SB1` ✔ (06/11/2026); pendente: teste das duas abas na tela e com um papel não administrador

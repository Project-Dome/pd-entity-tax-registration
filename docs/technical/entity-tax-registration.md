# Entity Tax Registration (pd_entity_tax_registration) — Documentação Técnica

> Versão documentada: 2.0.0 — 2026-10-07

## 1. Visão geral

Módulo `pd_entity_tax_registration` (prefixo `petr`) consolida a validação de CNPJ/CPF e Registro Fiscal Internacional, a checagem de unicidade entre entidades (Customer/Job/Vendor) e o enriquecimento automático de dados cadastrais. Substitui os projetos legados `pd_c_entity_federal-registration` (cefr) e `pd-cnpj-integration`, que atuavam sobre o mesmo campo de forma independente.

Desde a 2.0.0 o enriquecimento usa dois provedores, sempre chamados no servidor:

- **ReceitaWS** (`receitaws.com.br/v1/cnpj`) — provedor primário de CNPJ, API pública gratuita com limite de consultas por minuto.
- **Hub do Desenvolvedor** (`ws.hubdodesenvolvedor.com.br/v2/`) — fallback de CNPJ, Inscrição Estadual e único provedor de CPF. Pago por créditos; cada consulta que cobra créditos é registrada para o relatório de consumo.

A BrasilAPI deixou de ser usada para CNPJ na 2.0.0 e continua só na consulta de CEP (complemento de endereço).

Especificações: [`entity-tax-registration.md`](../specs/entity-tax-registration.md) (módulo), [`multi-provider-cnpj-lookup.md`](../specs/multi-provider-cnpj-lookup.md) (ReceitaWS + fallback) e [`hub-credit-control.md`](../specs/hub-credit-control.md) (CPF, data de nascimento e controle de créditos).

Status: implementado e deployado no sandbox `11953512-sb1` (Project Dome Do Brasil Ltda).

## 2. Arquitetura

Os entry points são finos — a lógica de negócio vive em `service/`. A cadeia é dividida em duas partes que **não podem se misturar**:

- **Cadeia do Client Script** (carregada no navegador): `pd-petr-entity.js` e tudo que ele importa. Não pode depender, nem transitivamente, de módulo server-only (`N/cache`, `N/record`, `N/email`) — o carregamento AMD é eager e quebraria no navegador antes de qualquer função rodar.
- **Parte server-only**: `pd-petr-entity-lookup.js` → `pd-petr-cnpj-lookup.js` → provedores e registro de consumo. Importada só pelo RESTlet e pelos User Events.

Toda consulta externa de CNPJ/CPF sai do servidor: o Client Script chama o RESTlet, que chama o orquestrador.

| Arquivo | Pasta | Responsabilidade |
|---|---|---|
| `pd-petr-entity-tax-registration.cl.js` | `client/` | Repassa os eventos de UI (`pageInit`, `fieldChanged`, `validateField`, `saveRecord`, `fetchCNPJ`) para o service `entity`. |
| `pd-petr-entity-tax-registration.ue.js` | `userevent/` | `beforeLoad`: adiciona o botão de consulta ("Consultar CNPJ" ou "Consultar CPF/CNPJ") e aponta `clientScriptModulePath`. `beforeSubmit`: enriquecimento em CSV Import e revalidação de unicidade. |
| `pd-petr-entity-tax-registration.rl.js` | `restlet/` | `post` com duas ações: por `id` (modo view — carrega, preenche e salva o record) ou por `cnpj` + `birthDate` opcional (create/edit — só consulta; o cliente preenche). |
| `pd-petr-entity.js` | `service/` | Orquestrador do lado do cliente: gate por país, habilitação/obrigatoriedade dos campos, duplicidade, chamada ao RESTlet e aplicação do retorno via mapper. |
| `pd-petr-entity-lookup.js` | `service/` | Parte server-only do enriquecimento: `fetchCNPJForRecord` (view), `fetchCompanyDataForCnpj` (create/edit), `manageCsvImport`. |
| `pd-petr-cnpj-lookup.js` | `service/` | Orquestrador de provedores: CNPJ (ReceitaWS → Hub) e CPF (só Hub, com fluxo de data de nascimento). Nunca lança exceção. |
| `pd-petr-receitaws-api.js` / `pd-petr-receitaws-adapter.js` | `service/` | Chamada HTTPS ao ReceitaWS e conversão do retorno para o shape canônico. |
| `pd-petr-hub-api.js` / `pd-petr-hub-adapter.js` | `service/` | Chamadas à Hub (`v2/cnpj`, `v2/cpf`, `v2/cpf?last_update=2`, `v2/nome_cpf`) e conversão para o shape canônico (PJ e PF). |
| `pd-petr-hub-credit-usage.js` | `service/` | Grava uma linha de consumo por chamada que cobrou créditos (`track`) e soma o consumo de um período (`summarize`). |
| `pd-petr-credit-report.js` | `service/` | Monta e envia o relatório de créditos por e-mail. |
| `pd-petr-api-settings.js` | `service/` | Lê o registro de Configuração das APIs. |
| `pd-petr-validation-settings.js` | `service/` | Lê o registro de Configuração das Validações (`get()`) e implementa a UI e o `beforeSubmit` desse registro (master switch, dependência da busca automática, ciência). |
| `pd-petr-vendor.js` | `service/` | Busca de duplicidade específica para Vendor. |
| `pd-petr-script-parameters.js` | `service/` | Lê o script parameter `custscript_pd_petr_brasil_country`. |
| `pd-petr-cep-api.js` | `service/` | Chamada HTTPS à BrasilAPI (endpoint CEP), usada para complementar endereço e obter o código IBGE. |
| `pd-petr-validators.js` | `service/` | Checksum CNPJ/CPF (inclui CNPJ alfanumérico) e validação da situação cadastral do retorno (`ATIVA` para CNPJ, `REGULAR` para CPF). |
| `pd-petr-mapper.js` | `service/` | Preenche campos e `addressbook` a partir do shape canônico; para CPF preenche `firstname` e Data de Nascimento. |
| `pd-petr-validation-settings.cl.js` | `client/` | Client Script do registro de Configuração das Validações. |
| `pd-petr-validation-settings.ue.js` | `userevent/` | User Event do registro de Configuração das Validações (ciência da busca automática). |
| `pd-petr-credit-report.sc.js` | `scheduled/` | Scheduled Script diário do relatório de créditos. |
| `pd-petr-rate-limiter.js` | `util/` | Limite de consultas por minuto em `N/cache` (janela fixa). |
| `pd-petr-constants.js` | `modules/` | Todos os fieldIds/scriptIds/tipos usados pelos services. |
| `pd-petr-get-data.js` / `pd-petr-set-data.js` / `pd-petr-search-data.js` | `util/` | Utils genéricos de leitura/escrita/busca (portados de `cnab-citibank-remessa`). |

Todos os arquivos estão em `src/FileCabinet/SuiteScripts/product_dome/pd_entity_tax_registration/`.

### 2.1 Fluxos de validação

**`fieldChanged` do campo CNPJ/CPF** (só quando País = Brasil): 1) valida formato (`validateCNPJ`/`validateCPF`) → 2) valida unicidade (`findDuplicate`, via `N/search` para Customer/Job ou `pd-petr-vendor` para Vendor). Falha em qualquer das duas limpa o campo.

**`saveRecord`** (só quando País = Brasil): 1) revalida unicidade → 2) se a consulta automática estiver habilitada e o documento for um CNPJ de 14 caracteres — ou um CPF de 11 com "Consultar CPF (Hub)" marcado — ainda não consultado nesta sessão (`lastFetchedDigits`), dispara `fetchCNPJ`.

**Registro Fiscal Internacional** (País ≠ Brasil): só unicidade, sem checksum nem consulta externa.

**Gate por país**: o bloco de CNPJ/CPF só roda se `custentity_pd_petr_country_ls` for igual ao script parameter `custscript_pd_petr_brasil_country` (internal ID comparado como string).

### 2.2 Fluxo de consulta de CNPJ (`getCompanyData`)

1. **ReceitaWS** (se `custrecord_pd_petr_as_rws_enabled_cb`): antes da chamada, consome uma cota do rate limiter (`custrecord_pd_petr_as_rws_rate_limit_nu` consultas/minuto). Sem cota, ou com HTTP 429, segue para a Hub marcando "rate limited".
2. **Hub** (se `custrecord_pd_petr_as_hub_enabled_cb` e token preenchido): `v2/cnpj`, com `ie=1` quando "Consultar Inscrição Estadual (Hub)" está marcado. Erros vêm com HTTP 200 e `status: false` no corpo.
3. ReceitaWS falhou por rate limit e Hub desabilitada → `RATE_LIMIT_NO_FALLBACK`, com o tempo restante da janela. Qualquer outra falha → `NO_PROVIDER_AVAILABLE`.

### 2.3 Fluxo de consulta de CPF (`getPersonData`)

Documento de 11 caracteres é desviado para `getPersonData`, que usa só a Hub e exige "Consultar CPF (Hub)" marcado (senão `CPF_LOOKUP_DISABLED`):

1. `v2/cpf?last_update=2` (grátis) — `status: true` indica CPF na base da Hub.
2. Na base → `v2/cpf` só com o CPF (1 crédito).
3. Fora da base → a consulta na Receita exige data de nascimento:
   1. Data de Nascimento do cadastro (`options.birthDate`) → `v2/cpf&data=DD/MM/AAAA` (5 créditos).
   2. Sem data e com "Busca Automática de Data de Nascimento (Hub)" marcada → `v2/nome_cpf` (10 créditos) e depois `v2/cpf` com a data (5).
   3. Sem data e sem a flag → `BIRTH_DATE_REQUIRED`, sem gastar créditos.
4. O retorno (`tipo_pessoa: 'PF'`) leva `data_nascimento`, gravada pelo mapper em `custentity_pd_petr_birth_date_dt` se o campo estiver vazio.

A data do cadastro chega em todos os caminhos: create/edit (o Client Script envia `birthDate` ao RESTlet), view (`fetchCNPJForRecord` lê do record carregado) e CSV Import (`manageCsvImport` lê do `newRecord`).

### 2.4 Registro de consumo e relatório

`creditUsageService.track(body, queryType, document)` é chamado após toda chamada à Hub (em `tryHub` e em `callHub`) e grava uma linha em `customrecord_pd_petr_hub_credit_usage` quando `body.consumed > 0`. Tipos registrados: `CNPJ`, `CNPJ + Inscrição Estadual`, `CPF (base Hub)`, `CPF (Receita Federal)`, `Data de Nascimento (nome_cpf)` e `Verificação de base do CPF` (só grava se a Hub passar a cobrar o `last_update`).

O Scheduled Script `customscript_pd_petr_credit_report_ss` roda diariamente e chama `creditReportService.run()`, que envia o relatório quando a frequência vence (ver §5.4).

## 3. Objects (`src/Objects/`)

| scriptid | Tipo | Descrição |
|---|---|---|
| `custentity_pd_petr_country_ls` | `entitycustomfield` (SELECT, País) | Campo País em Customer/Vendor. Obrigatório, label "País". |
| `custentity_pd_petr_birth_date_dt` | `entitycustomfield` (DATE) | "Data de Nascimento" em Customer/Vendor. Arquivo em `pd_petr/custom_field/`. |
| `customrecord_pd_petr_api_settings` | `customrecordtype` | "PD \| PETR \| Configuração das APIs" — provedores, tokens e pacote de créditos. Ver §5.3. |
| `custform_pd_petr_as` | `entryForm` | Form do registro de APIs (grupos "ReceitaWS", "Hub do Desenvolvedor", "Informações do Sistema"). |
| `customrecord_pd_petr_validation_settings` | `customrecordtype` | "PD \| PETR \| Configuração das Validações". Ver §5.2. |
| `custform_pd_petr_vs` | `entryForm` | Form do registro de Validações (grupos "Validação de Duplicidade", "Consulta na Receita", "Atualização de Campos via Receita", "Relatório de Créditos da Hub", "Informações do Sistema"). |
| `customsearch_pd_petr_vs_list` | `savedsearch` | Listagem do registro de Validações. |
| `customrecord_pd_petr_hub_credit_usage` | `customrecordtype` | "PD \| PETR \| Consumo de Créditos da Hub" — campos `custrecord_pd_petr_hcu_query_type_ds`, `_document_ds`, `_credits_nu`, `_user_ls`; data = `created` nativo. `accesstype` `NONENEEDED`. Arquivo em `pd_petr/custom_record/`. |
| `customlist_pd_petr_report_frequency` | `customlist` | "PD \| PETR \| Freq. do Relatório": Diário, Semanal, Mensal. Arquivo em `pd_petr/custom_list/`. |
| `customscript_pd_petr_tax_reg_ue` | `usereventscript` | User Event das entidades; script parameter `custscript_pd_petr_brasil_country`. |
| `customscript_pd_petr_tax_reg_cl` | `clientscript` | Client Script principal. |
| `customscript_pd_petr_tax_reg_rl` | `restlet` | RESTlet de consulta. |
| `customscript_pd_petr_vs_cl` | `clientscript` | Client Script do registro de Validações. |
| `customscript_pd_petr_vs_ue` | `usereventscript` | User Event do registro de Validações. |
| `customscript_pd_petr_credit_report_ss` | `scheduledscript` | Relatório de créditos. Nome sem "hub": `customscript_pd_petr_hub_credit_report_ss` passaria de 40 caracteres. |

Os Objects criados na 2.0.0 (custom field, custom record e custom list) estão em subpastas `src/Objects/pd_petr/{categoria}/`; os anteriores e os `customscript_*.xml` continuam soltos em `src/Objects/`.

Campos usados mas **não recriados** neste projeto (pertencem a outros bundles): `custentity_brl_entity_t_fed_tax_reg`, `custentity_brl_entity_t_int_tax_reg`, `custentity_brl_entity_t_state_tx_reg` (Inscrição Estadual), `custentity_fte_entity_l_taxregime`, `customrecord_ftebr_city`, `customrecord_fte_taxregime`.

## 4. Scripts e deployments

| Script | Tipo | scriptid | Deployment(s) | Record type | Status |
|---|---|---|---|---|---|
| `pd-petr-entity-tax-registration.ue.js` | User Event | `customscript_pd_petr_tax_reg_ue` | `customdeploy_pd_petr_tax_reg_ue_customer` | `CUSTOMER` | RELEASED |
| | | | `customdeploy_pd_petr_tax_reg_ue_job` | `[scriptid=customrecord_str_job]` | **comentado no Object** |
| | | | `customdeploy_pd_petr_tax_reg_ue_vendor` | `VENDOR` | RELEASED |
| `pd-petr-entity-tax-registration.cl.js` | Client Script | `customscript_pd_petr_tax_reg_cl` | `customdeploy_pd_petr_tax_reg_cl_customer` | `CUSTOMER` | RELEASED |
| | | | `customdeploy_pd_petr_tax_reg_cl_job` | `JOB` | **isdeployed=F** |
| | | | `customdeploy_pd_petr_tax_reg_cl_vendor` | `VENDOR` | RELEASED |
| `pd-petr-entity-tax-registration.rl.js` | RESTlet | `customscript_pd_petr_tax_reg_rl` | `customdeploy_pd_petr_tax_reg_rl` | — | RELEASED |
| `pd-petr-validation-settings.cl.js` | Client Script | `customscript_pd_petr_vs_cl` | `customdeploy_pd_petr_vs_cl` | `[scriptid=customrecord_pd_petr_validation_settings]` | RELEASED |
| `pd-petr-validation-settings.ue.js` | User Event | `customscript_pd_petr_vs_ue` | `customdeploy_pd_petr_vs_ue` | `[scriptid=customrecord_pd_petr_validation_settings]` | RELEASED |
| `pd-petr-credit-report.sc.js` | Scheduled | `customscript_pd_petr_credit_report_ss` | `customdeploy_pd_petr_credit_report_ss` | — | SCHEDULED (diário, 08:00 UTC, desde 08/10/2026) |

**O deployment de Job do User Event está comentado**, junto com a dependência `<object>customrecord_str_job</object>` em `src/manifest.xml`: `customrecord_str_job` é custom record de um projeto de cliente e não existe nas contas em que o produto é instalado. Para reativar, confirme que a conta-alvo tem o record e restaure os dois pontos juntos. O Job nativo também está sem cobertura (`customdeploy_pd_petr_tax_reg_cl_job` com `isdeployed=F`). Se reativar, atenção ao `<recordtype>`: no User Event é `[scriptid=customrecord_str_job]`, no Client Script é a constante nativa `JOB` — não são intercambiáveis.

O Client Script principal também é anexado via `form.clientScriptModulePath` no `beforeLoad` do User Event.

Audiência de todos os deployments: `allemployees=T`, `allpartners=T`, `allroles=T`.

**Flags de bundle.** Todas as pastas e arquivos têm `bundleable=T`. `hideinbundle=T` só nos quatro entry points server-side (os dois User Events, o RESTlet e o Scheduled Script). A cadeia do Client Script **não pode** ser ocultada — qualquer arquivo dela com `hideinbundle=T` faz o deploy falhar com `INVALID_HIDE_IN_BUNDLE_PREFERENCE_SET_FOR_REFERENCED_LIBRARY_FILE`. Hoje ela tem 13 arquivos: os dois Client Scripts, os services `entity`, `script-parameters`, `vendor`, `validators`, `mapper`, `cep-api` e `validation-settings`, `modules/constants` e os três utils de dados. Os services server-only (`entity-lookup`, `cnpj-lookup`, `receitaws-*`, `hub-*`, `api-settings`, `credit-report`, `hub-credit-usage`) e o `rate-limiter` estão com `hideinbundle=F` sem obrigação — podem passar a `T`. A análise precisa ser refeita a cada import novo num arquivo da cadeia.

## 5. Configuração dependente de ambiente

### 5.1 Script parameter

- **`custscript_pd_petr_brasil_country`**: internal ID do registro de País "Brasil". Tem `<setting>COMPANY</setting>`, então é preenchido em **Configuração > Empresa > Preferências Gerais > Preferências Personalizadas**, não por deployment. Lido por `runtime.getCurrentScript().getParameter` em `pd-petr-script-parameters.js`.
- **Obrigatório em cada conta**: sem ele, `isBrazil(country)` nunca é `true` e todo o bloco de CNPJ/CPF fica desativado.

### 5.2 Registro de Configuração das Validações

`customrecord_pd_petr_validation_settings` é o registro **único** de configuração das validações e consultas. `validationSettingsService.get()` é o único ponto de leitura (busca via `pd-petr-search-data.first`, `isinactive = F`), memoizado por execução — ver §6.2. Sem registro ativo, `get()` devolve `null` e nenhuma validação nem enriquecimento roda:

| Ponto | Sem configuração |
|---|---|
| `manageCnpjChanged` / `manageInternationalChanged` | Só `log.debug`, sem alerta. |
| `manageSaveRecord` | `dialog.alert` "Configuração necessária"; o save **não** é bloqueado. |
| `fetchCNPJ` (create/edit) | `dialog.alert` e aborta. |
| `fetchCNPJViaRestlet` (view) | `{ success: false, error: MISSING_SETTINGS_MESSAGE }`. |
| `manageBeforeSubmitServer` / `manageCsvImport` | `log.error` e retorna. |
| `getPersonData` | `CPF_LOOKUP_DISABLED` (sem flag de CPF). |
| `creditReportService.run` | Log e não envia. |

Flags e onde são aplicadas:

| Flag (fieldId) | Ponto de aplicação |
|---|---|
| Validar Duplicidade (CNPJ/CPF Nacional) — `custrecord_pd_petr_vs_enable_dup_cnpj_cb` | `pd-petr-entity`: `manageCnpjChanged`, `manageSaveRecord`, `manageBeforeSubmitServer` |
| Validar Duplicidade (Registro Internacional) — `custrecord_pd_petr_vs_enable_dup_intl_cb` | `pd-petr-entity`: `manageInternationalChanged`, `manageSaveRecord`, `manageBeforeSubmitServer` |
| Consulta Automática de CPF/CNPJ — `custrecord_pd_petr_vs_enable_lookup_cb` | autofetch do `manageSaveRecord` e `manageCsvImport` |
| Botão "Consultar CPF/CNPJ" — `custrecord_pd_petr_vs_enable_cnpj_btn_cb` | `pd-petr-entity-tax-registration.ue`: `beforeLoad` |
| Consultar Inscrição Estadual (Hub) — `custrecord_pd_petr_vs_hub_state_reg_cb` | `pd-petr-cnpj-lookup.tryHub` (`ie=1`) e `pd-petr-mapper.setFields` |
| Consultar CPF (Hub) — `custrecord_pd_petr_vs_hub_cpf_lookup_cb` | `getPersonData`, autofetch/CSV para 11 caracteres, rótulo do botão (`BUTTON.LABEL_WITH_CPF`) |
| Busca Automática de Data de Nascimento (Hub) — `custrecord_pd_petr_vs_hub_auto_birth_cb` | `getPersonData` (chamada ao `v2/nome_cpf`) |
| 6 flags `custrecord_pd_petr_vs_upd_*_cb` | `pd-petr-mapper.setFields` |

**Busca automática de data de nascimento** (`pd-petr-validation-settings.js`): no cliente, fica desabilitada e desmarcada enquanto "Consultar CPF (Hub)" estiver desmarcado (`applyCpfDependency`); ao ser marcada, abre `dialog.create` com "Estou ciente"/"Cancelar" — Cancelar desmarca. No servidor, `manageBeforeSubmit` (User Event `customscript_pd_petr_vs_ue`) repete a dependência e, quando a flag passa de desmarcada para marcada, grava `custrecord_pd_petr_vs_hub_ack_at_dh` (data/hora) e `custrecord_pd_petr_vs_hub_ack_by_ls` (usuário). Desmarcar mantém a última ciência.

**Master switch.** "Atualizar Todos os Campos" (`custrecord_pd_petr_vs_upd_all_cb`) zera e desabilita os 6 checkboxes individuais na UI e, na leitura, `get()` devolve as 6 flags como `true`. Só chaves de `VALIDATION_SETTINGS.FIELDS` que começam com `update` são afetadas — por isso `enableStateRegLookup`, `enableCpfLookup` e `enableAutoBirthDate` têm outro prefixo: são opções da Hub que precisam ser escolhidas individualmente (as de CPF consomem créditos) e não podem ser ligadas pelo master.

### 5.3 Registro de Configuração das APIs

`customrecord_pd_petr_api_settings`, lido por `apiSettingsService.get()` (mesma regra de `null` não cacheado):

| Campo | fieldId | Uso |
|---|---|---|
| Habilitar ReceitaWS | `custrecord_pd_petr_as_rws_enabled_cb` | Liga o provedor primário de CNPJ. |
| Token ReceitaWS | `custrecord_pd_petr_as_rws_token_ds` | Opcional (só plano Comercial). |
| Limite de Consultas por Minuto (ReceitaWS) | `custrecord_pd_petr_as_rws_rate_limit_nu` | Cota do rate limiter (padrão 3, limite da API pública). |
| Habilitar Hub do Desenvolvedor | `custrecord_pd_petr_as_hub_enabled_cb` | Liga a Hub (fallback de CNPJ, IE e CPF). |
| Token Hub do Desenvolvedor | `custrecord_pd_petr_as_hub_token_ds` | Obrigatório para a Hub; vai na query string. |
| Créditos Contratados por Mês | `custrecord_pd_petr_as_hub_credits_nu` | Base de saldo/percentual/excedente do relatório. Vazio: relatório só mostra o consumo. |
| Dia de Renovação do Pacote | `custrecord_pd_petr_as_hub_renewal_day_nu` | Início do ciclo (1–28). Vazio: dia 1. |

### 5.4 Relatório de créditos

Campos no registro de Validações, grupo "Relatório de Créditos da Hub": `custrecord_pd_petr_vs_report_email_cb` (liga o envio), `custrecord_pd_petr_vs_report_freq_ls` (Diário/Semanal/Mensal), `custrecord_pd_petr_vs_report_last_dt` (gravado pelo script), `custrecord_pd_petr_vs_email_sender_ls` (funcionário autor) e `custrecord_pd_petr_vs_email_recipient_ms` (funcionários destinatários).

`creditReportService.run()` só envia com o envio ligado, remetente, ao menos um destinatário e frequência vencida — Diário: último envio antes de hoje; Semanal: 7 dias ou mais; Mensal: 1 mês ou mais; sem último envio, envia. O ciclo começa no dia de renovação do mês corrente (ou do anterior, se o dia ainda não chegou). O e-mail traz período, contratado, consumido, saldo, percentual, excedente (quando houver) e consumo por tipo de consulta.

## 6. Decisões de implementação

### 6.1 Autofetch no `saveRecord`, não no `fieldChanged`

A consulta automática é disparada em `manageSaveRecord`: no `fieldChanged` aconteceria a cada alteração do campo, e `lastFetchedDigits` só evita repetir o mesmo valor. Consequência: em edição, os campos só são preenchidos depois de salvar — para vê-los antes existe o botão de consulta.

### 6.2 Configuração memoizada, `null` deliberadamente não cacheado

`get()` guarda o resultado numa variável de módulo para não buscar o registro a cada interação. O `null` não é cacheado: registro criado durante a sessão passa a valer na chamada seguinte. Mesmo padrão em `pd-petr-api-settings.get()`.

### 6.3 Normalização de checkbox e multiselect no util

`pd-petr-search-data.mapResult` converte `isCheckbox` (`'T'`/`'F'` → boolean; `'F'` seria truthy) e `isMultiSelect` (texto separado por vírgula → array). A conversão fica no util para qualquer service herdar.

### 6.4 Flags aplicadas no service, nunca no util

Cada flag é testada no ponto de decisão do service (tabela em §5.2); os utils seguem genéricos e portáveis.

### 6.5 Save não bloqueado quando falta configuração

Intencional: bloquear cadastro por falta de setup deixaria a conta inoperante logo após a instalação. O preço é que cadastros podem ser gravados sem validação nesse intervalo, com um `log.error` como rastro.

### 6.6 Master switch resolvido na leitura

`get()` já devolve as 6 flags individuais como `true` quando o master está marcado — nenhum service precisa saber que ele existe.

### 6.7 CSV Import governado pela flag "Consulta Automática"

`manageCsvImport` respeita a mesma flag do `saveRecord`, inclusive para CPF (que também exige "Consultar CPF (Hub)").

### 6.8 Checksum de CNPJ/CPF sempre ativo

As flags de duplicidade governam a unicidade na base, não o dígito verificador — esse roda sempre, mesmo sem configuração.

### 6.9 Enriquecimento só sobrescreve Razão Social e nome do CPF

`setIfEmpty` rege telefone, e-mail, regime tributário, nome fantasia, endereço, Inscrição Estadual e Data de Nascimento. **Razão Social (`companyname`)** e, no CPF, **`firstname`** são gravados direto — sempre refletem a Receita, por serem o nome exibido em toda a conta.

### 6.10 Endereço só é acrescentado, comparando por CEP

`insertAddress` insere linha nova no `addressbook` só quando nenhuma linha existente tem o mesmo CEP. Falha no subrecord é logada e devolve um aviso ("Endereço não preenchido"/"Endereço incompleto") em vez de abortar o save.

### 6.11 Cidade sem código IBGE

Nenhum provedor de CNPJ atual devolve IBGE. `resolveCityInternalId` usa o IBGE da consulta de CEP (BrasilAPI, `ibge.city`) e, sem ele, `lookupCityInternalIdByNameAndUf`: filtro por UF + 1ª letra via fórmula sobre o `name` de `customrecord_ftebr_city` ("{Cidade} - {UF}", `ENTITY.CITY_LOOKUP.NAME_FORMULAS`) e comparação exata em JS sem acento e caixa.

### 6.12 Rate limiter do ReceitaWS em `N/cache`, janela fixa

Cada minuto é um bucket com chave própria. `N/cache` exige ttl ≥ 300 s (não afeta a contagem) e não é transacional — em concorrência alta pode passar 1 chamada além do limite; o HTTP 429 do provedor é a rede de segurança. `consume()` nunca lança: falha do cache libera a chamada.

### 6.13 Consulta sempre no servidor

O Client Script não chama nenhuma API externa: tokens ficam no servidor e o rate limiter/registro de consumo (server-only) cobrem todas as consultas. O preço é a separação `pd-petr-entity.js` (cliente) / `pd-petr-entity-lookup.js` (servidor) descrita em §2.

### 6.14 Data de nascimento em DD/MM/AAAA montada no navegador

O Client Script envia `birthDate` já formatado com o fuso do navegador (`formatBirthDate`): serializar o `Date` em JSON viraria ISO em UTC e poderia trocar o dia. No servidor, `toHubDate` aceita `Date`, ISO e DD/MM/AAAA.

### 6.15 Registro de consumo com `NONENEEDED` e falha silenciosa

A linha de consumo é gravada pelo RESTlet/User Event com o papel do usuário que consultou; com permissão por registro, um usuário sem acesso faria a gravação falhar. `track` nunca lança — falha ao gravar o consumo não interrompe a consulta. O valor gravado é o `consumed` devolvido pela Hub, não uma tabela de preços local.

### 6.16 Relatório com busca própria

`pd-petr-credit-report` lê o registro de Validações com busca própria porque `get()` descarta o `internalid`, necessário para gravar "Último Envio". A frequência é comparada pelo texto do valor da lista (`REPORT_FREQUENCY`).

## 7. Limitações e fora de escopo

- Sócios (`qsa`/`quadro_socios`) — não mapeados; só logados.
- Regime Tributário via ReceitaWS e Hub: só Simples/MEI quando o provedor devolve; Lucro Presumido/Real não vêm desses provedores.
- Formato do retorno do `v2/nome_cpf` não conferido contra resposta real: `hubAdapter.toBirthDate` aceita `data_nascimento`, `data_de_nascimento` ou `nascimento`.
- O consumo não é vinculado ao cadastro que originou a consulta (em create/edit a consulta acontece antes de o registro existir).
- Saldo da Hub não é consultado na Hub: o consumo é contabilizado localmente a partir do `consumed`.
- Destinatários do relatório só podem ser funcionários do NetSuite.
- Contact, Employee, Partner — fora do escopo; o módulo trata Customer/Job/Vendor.
- Objects dos bundles externos (§3) não são recriados aqui.

## 8. Notas de manutenção

- **Atualização de contas na 1.0.x para a 2.0.0:** reconfigurar "PD | PETR | Configuração das APIs" — habilitar a Hub e informar o token (sem isso não há fallback de CNPJ) e informar de novo o token do ReceitaWS, se houver, no campo de texto. O SDF não exclui campos removidos: `custrecord_pd_petr_as_bra_enabled_cb`, `custrecord_pd_petr_as_rws_token_pw` e, no sandbox `11953512-sb1`, `custrecord_pd_petr_as_hub_token_pw` e `custrecord_pd_petr_as_hub_state_reg_cb` continuam na conta até serem excluídos manualmente.
- Saved search de listagem do registro de consumo (`customsearch_pd_petr_hcu_list`) ainda não existe — criar na UI e importar via `object:import`.
- O campo País passou por renames antes de existir em produção (`custentity_pd_cefr_country_customer` → `custentity_pd_petr_country` → `custentity_pd_petr_country_ls`). Contas com versões antigas precisariam de migração.
- Manifest declara `SERVERSIDESCRIPTING`, `CRM`, `ACCOUNTING` e `CREATESUITEBUNDLES` como features obrigatórias.
- O deploy emite warnings inofensivos (`allroles`/`audslctrole`, `title` em `scriptdeployment` de Client Script, `aidescription`/`enabletextenhance` de custom field, campos de record ignorados pela versão de API).
- Novos services que leiam/escrevam/busquem records devem reaproveitar os utils `pd-petr-get-data`/`set-data`/`search-data` — exceção documentada: buscas com agregação (`summarize` do consumo) usam `N/search` direto, porque o util não suporta `summary`.
- Comentários de código ficam só no bloco do topo de cada arquivo (após o cabeçalho JSDoc), não dentro do corpo.

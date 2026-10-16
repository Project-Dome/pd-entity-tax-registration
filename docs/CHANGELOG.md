# Changelog — pd_entity_tax_registration

Todas as mudanças relevantes do módulo são registradas aqui, por versão e data. Formato inspirado em [Keep a Changelog](https://keepachangelog.com/), versionamento [semver](https://semver.org/) (`MAJOR.MINOR.PATCH`).

## [2.0.0] - 2026-10-07

### Adicionado
- ReceitaWS como provedor primário de consulta de CNPJ, com limite de consultas por minuto controlado em `N/cache` e fallback para outro provedor quando falha ou estoura o limite (`pd-petr-cnpj-lookup.js`, `pd-petr-receitaws-api.js`, `pd-petr-receitaws-adapter.js`, `util/pd-petr-rate-limiter.js`).
- Novo custom record `customrecord_pd_petr_api_settings` (`PD | PETR | Configuração das APIs`) + entry form `custform_pd_petr_as`: habilitação, token e limite de consultas de cada provedor (`pd-petr-api-settings.js`).
- Hub do Desenvolvedor como provedor de fallback de CNPJ (`v2/cnpj`), com token obrigatório — campos `custrecord_pd_petr_as_hub_enabled_cb` e `custrecord_pd_petr_as_hub_token_ds` (`pd-petr-hub-api.js`, `pd-petr-hub-adapter.js`).
- Inscrição Estadual via Hub (`ie=1`, na mesma consulta de CNPJ, sem créditos adicionais), gravada em `custentity_brl_entity_t_state_tx_reg` quando vazio; habilitada pela flag `custrecord_pd_petr_vs_hub_state_reg_cb` ("Consultar Inscrição Estadual (Hub)") (`pd-petr-hub-adapter.js`, `resolveStateRegistration`; `pd-petr-mapper.js`).
- Consulta de CPF pela Hub (`v2/cpf`), habilitada pela flag `custrecord_pd_petr_vs_hub_cpf_lookup_cb` ("Consultar CPF (Hub)"): preenche `firstname` e avisa quando a situação não é `REGULAR`; CPF passa pelo mesmo botão, consulta automática no save e CSV Import (`pd-petr-cnpj-lookup.js`, `getPersonData`; `pd-petr-mapper.js`, `setPersonFields`; `pd-petr-validators.js`).
- Botão passa a se chamar "Consultar CPF/CNPJ" quando a consulta de CPF está habilitada (`pd-petr-entity-tax-registration.ue.js`, `BUTTON.LABEL_WITH_CPF`).
- Novo entity field `custentity_pd_petr_birth_date_dt` ("Data de Nascimento", Customer/Vendor): usado na consulta do CPF fora da base da Hub e preenchido automaticamente quando a Hub devolve a data.
- Fluxo de CPF fora da base da Hub: `last_update=2` (grátis) decide entre `v2/cpf` só com o CPF ou com a data de nascimento do cadastro; sem data, busca no `v2/nome_cpf` apenas com a nova flag `custrecord_pd_petr_vs_hub_auto_birth_cb` ("Busca Automática de Data de Nascimento (Hub)") marcada, senão pede a data ao usuário (`pd-petr-cnpj-lookup.js`, reason `BIRTH_DATE_REQUIRED`).
- Aviso de cobrança adicional ("Estou ciente"/"Cancelar") ao marcar a busca automática, que só fica disponível com "Consultar CPF (Hub)" marcado; ciência registrada em `custrecord_pd_petr_vs_hub_ack_at_dh`/`custrecord_pd_petr_vs_hub_ack_by_ls` pelo novo User Event `customscript_pd_petr_vs_ue` (`pd-petr-validation-settings.js`, `manageFieldChanged`/`manageBeforeSubmit`; `userevent/pd-petr-validation-settings.ue.js`).
- Novo custom record `customrecord_pd_petr_hub_credit_usage` (`PD | PETR | Consumo de Créditos da Hub`): uma linha por chamada à Hub que cobrou créditos, com tipo de consulta, documento, créditos (`consumed`) e usuário (`pd-petr-hub-credit-usage.js`, `track`).
- Pacote de créditos no registro de APIs: `custrecord_pd_petr_as_hub_credits_nu` ("Créditos Contratados por Mês") e `custrecord_pd_petr_as_hub_renewal_day_nu` ("Dia de Renovação do Pacote").
- Relatório de créditos por e-mail: novo Scheduled Script `customscript_pd_petr_credit_report_ss` (diário) que envia conforme a frequência configurada; novos campos `custrecord_pd_petr_vs_report_email_cb`, `custrecord_pd_petr_vs_report_freq_ls`, `custrecord_pd_petr_vs_report_last_dt`, `custrecord_pd_petr_vs_email_sender_ls`, `custrecord_pd_petr_vs_email_recipient_ms` e custom list `customlist_pd_petr_report_frequency` (`pd-petr-credit-report.js`, `scheduled/pd-petr-credit-report.sc.js`).
- Popup de "consultando" durante a chamada ao RESTlet e aviso quando o endereço não pode ser preenchido automaticamente (`pd-petr-entity.js`, `showLoadingMessage`; `pd-petr-mapper.js`, `insertAddress`).
- Resolução de cidade sem código IBGE no retorno do provedor: usa o IBGE da consulta de CEP e, sem ele, busca por município + UF (`pd-petr-mapper.js`, `lookupCityInternalIdByNameAndUf`; `ENTITY.CITY_LOOKUP.NAME_FORMULAS`).

### Alterado
- Toda consulta externa de CNPJ/CPF passa a ser feita no servidor via RESTlet — o Client Script não chama mais APIs do navegador (`pd-petr-entity.js`, `fetchCompanyDataViaRestlet`; parte server-only isolada em `pd-petr-entity-lookup.js`).
- RESTlet de consulta por documento aceita `birthDate` (DD/MM/AAAA) no corpo; `getCompanyData` passa a receber `(document, options)` (`restlet/pd-petr-entity-tax-registration.rl.js`, `pd-petr-entity-lookup.js`, `fetchCompanyDataForCnpj`).
- Campo `custrecord_pd_petr_vs_enable_cnpj_btn_cb` renomeado na tela para `Botão "Consultar CPF/CNPJ"`; títulos de erro, mensagem de suporte e o popup "Aguarde!" passam a citar "CPF/CNPJ" (`pd-petr-entity.js`).
- Campo `custrecord_pd_petr_vs_enable_lookup_cb` renomeado na tela de "Consulta Automática de CNPJ na Receita" para "Consulta Automática de CPF/CNPJ", já que também controla a consulta de CPF no salvamento; texto de ajuda atualizado (`customrecord_pd_petr_validation_settings.xml`, `custform_pd_petr_vs.xml`).
- Help texts e descrições de scripts que citavam a BrasilAPI passam a citar ReceitaWS/Hub do Desenvolvedor (`customrecord_pd_petr_validation_settings.xml`, `customscript_pd_petr_tax_reg_*.xml`).

### Removido
- **BrasilAPI como provedor de CNPJ**: arquivo `pd-petr-cnpj-api.js`, constante `API.CNPJ_BASE_URL` e campo `custrecord_pd_petr_as_bra_enabled_cb`. Contas que usavam a BrasilAPI como fallback ficam sem fallback até configurar a Hub do Desenvolvedor. A BrasilAPI continua sendo usada só na consulta de CEP (`pd-petr-cep-api.js`).
- **Campo `custrecord_pd_petr_as_rws_token_pw` (PASSWORD)**, substituído por `custrecord_pd_petr_as_rws_token_ds` (texto), mesma troca feita no token da Hub (`custrecord_pd_petr_as_hub_token_ds`). O token do ReceitaWS precisa ser informado de novo no campo novo. O SDF não exclui os campos removidos da conta — excluí-los manualmente.
- **Campos `custrecord_pd_petr_vs_upd_fax_cb` ("Atualizar Fax") e `custrecord_pd_petr_vs_upd_alt_phone_cb` ("Atualizar Telefone Alternativo")**: não tinham efeito, porque nem ReceitaWS nem Hub do Desenvolvedor devolvem fax ou segundo telefone — só a BrasilAPI devolvia (`customrecord_pd_petr_validation_settings.xml`, `custform_pd_petr_vs.xml`, `pd-petr-constants.js`, `pd-petr-mapper.js`, adapters). Colunas removidas também da busca `customsearch_pd_petr_vs_list`. Excluir os campos manualmente na conta.

## [1.0.1] - 2026-07-31

### Adicionado
- Botão "Consultar CNPJ" agora também aparece em modo **View**, além de Create/Edit (`pd-petr-entity-tax-registration.ue.js`, `beforeLoad`).
- Novo RESTlet `pd-petr-entity-tax-registration.rl.js` (`restlet/`) + Object `customscript_pd_petr_tax_reg_rl.xml`: aplica o fetch/enriquecimento de CNPJ server-side (`record.load` → BrasilAPI → `mapperService.setFields` → `record.save`), necessário porque em modo View o record carregado no client script não é editável (`setValue` falha).
- Novo Object `customscript_pd_petr_tax_reg_cl.xml` para o Client Script, com deployments para Customer/Job/Vendor (antes o script só era anexado dinamicamente via `form.clientScriptModulePath` no UE, sem Object próprio).
- `pd-petr-constants.js`: nova entrada `SCRIPTS.RESTLET` (`SCRIPT_ID`/`DEPLOY_ID`) usada para resolver a URL do RESTlet a partir do client script.
- Novo custom record `customrecord_pd_petr_validation_settings` (`PD | PETR | Configuração das Validações`), registro único de configuração com 13 campos checkbox: habilitar validação de duplicidade (CNPJ/CPF nacional e Registro Internacional), habilitar consulta automática de CNPJ na Receita em modo edição, habilitar o botão "Consultar CNPJ", habilitar atualização individual de cada campo enriquecido via BrasilAPI (Nome Fantasia, Razão Social, Telefone, Telefone Alternativo, Fax, E-mail, Regime Tributário, Endereço) e um master switch "Atualizar Todos os Campos".
- Novo Client Script `pd-petr-validation-settings.cl.js` + service `pd-petr-validation-settings.js`: ao marcar "Atualizar Todos os Campos", desabilita e zera os 8 checkboxes de atualização individual (guardando os valores anteriores); ao desmarcar, restaura o que estava selecionado antes.
- Novo Object `customscript_pd_petr_vs_cl.xml` (deployment do client script acima no custom record).
- Novo Entry Form `custform_pd_petr_vs` para o `customrecord_pd_petr_validation_settings`, com os campos organizados em Field Groups ("Validação de Duplicidade", "Consulta na Receita", "Atualização de Campos via Receita").
- `pd-petr-constants.js`: nova entrada `VALIDATION_SETTINGS` (`TYPE`/`FIELDS`) para o custom record acima.
- `manifest.xml`: dependência de objeto externo `customrecord_str_job` declarada em `<dependencies><objects>` (necessária para o deployment do UE no record Job) e bloco `<dependencies><features>` reativado (`SERVERSIDESCRIPTING`, `CRM`, `ACCOUNTING`, `CREATESUITEBUNDLES` — estava comentado, causando falha de deploy).
- Novo Object `customsearch_pd_petr_vs_list.xml`: saved search de listagem do `customrecord_pd_petr_validation_settings` (título "PD | PETR | Configuração das Validações - Lista"), criada com ID customizado direto na UI e trazida para o projeto via `object:import`.
- `pd-petr-search-data.js` (util): nova flag de descritor `isCheckbox`, tratada no `mapResult` — campo checkbox volta da busca como string `'T'`/`'F'` (e `'F'` é *truthy*), então o util passa a normalizar para boolean em vez de deixar cada service resolver isso por conta própria. Os 13 campos de `VALIDATION_SETTINGS` em `pd-petr-constants.js` foram marcados com a flag.
- `pd-petr-validation-settings.js` (service): nova função `get()`, que lê o registro único de configuração (via `pd-petr-search-data`, filtrando `isinactive = F`) e devolve as 13 flags já resolvidas — inclusive aplicando o master switch "Atualizar Todos os Campos" sobre os 8 checkboxes individuais. O resultado é memoizado por execução (uma busca por page load / por execução server-side). Sem registro de configuração na conta, todas as flags voltam habilitadas, preservando o comportamento anterior do módulo.

### Alterado
- As validações e o enriquecimento do módulo passam a respeitar o `customrecord_pd_petr_validation_settings`:
  - `pd-petr-entity.js`: checagem de duplicidade de CNPJ/CPF condicionada a "Validar Duplicidade (CNPJ/CPF Nacional)" (`fieldChanged`, `saveRecord` e `beforeSubmit`); duplicidade de Registro Internacional condicionada a "Validar Duplicidade (Registro Internacional)" (mesmos três pontos); consulta automática à BrasilAPI no `fieldChanged` e no CSV Import condicionada a "Consulta Automática de CNPJ na Receita". A validação de **formato** de CNPJ/CPF continua sempre ativa, independente da configuração.
  - `pd-petr-mapper.js` (`setFields`): cada campo enriquecido só é gravado se a flag correspondente estiver marcada (Nome Fantasia, Razão Social, Telefone, Telefone Alternativo, Fax, E-mail, Regime Tributário e Endereço).
  - `pd-petr-entity-tax-registration.ue.js` (`beforeLoad`): o botão "Consultar CNPJ" só é adicionado ao formulário se a flag "Botão Consultar CNPJ" estiver marcada. O `clientScriptModulePath` continua sendo anexado sempre, porque é ele que leva as validações do client script para o `customrecord_str_job`.
- `pd-petr-entity.js` (service): `fetchCNPJ` agora recebe um segundo parâmetro `mode` — em `view`, desvia para `fetchCNPJViaRestlet` (chama o RESTlet via `N/https`/`N/url` e recarrega a página no sucesso) em vez de gravar os campos localmente.
- Consulta automática de CNPJ na Receita (`enableAutoLookup`) passa a disparar no `saveRecord` em vez do `fieldChanged` — a busca à BrasilAPI agora ocorre uma única vez, no momento do save, em vez de a cada alteração do campo CNPJ (`pd-petr-entity.js`: `manageCnpjChanged`, `manageSaveRecord`).
- `pd-petr-entity-tax-registration.cl.js` (client): `pageInit` agora guarda `context.mode` numa variável de módulo, repassada para `fetchCNPJ` no clique do botão.
- Campo País renomeado de `custentity_pd_petr_country` para `custentity_pd_petr_country_ls` (sigla de tipo List/Record, conforme convenção de nomenclatura do projeto).
- `TYPE_LIST.CUST_JOB` renomeado para `TYPE_LIST.CUSTOMER_AND_JOB` (o valor `'CustJob'` cobre Customer e Job, não só Customer).
- Identificadores de código traduzidos para inglês: `internacional` → `international` (`ENTITY.FIELDS`/`VENDOR.FIELDS`), `BRASIL_COUNTRY_PARAM` → `BRAZIL_COUNTRY_PARAM`, `isBrasil` → `isBrazil`, `getCountryBrasil` → `getCountryBrazil`.
- `pd-petr-entity.js`: `findDuplicate`/`searchEntityDuplicate` passam a receber o descritor de campo (`FIELDS.cnpj`) em vez de string solta (`'cnpj'`); filtro de busca usa `FIELDS.type.name` em vez do literal `'type'`.
- Mensagens de `validateApiResponse` (`pd-petr-validators.js`) traduzidas para português, por consistência com os demais diálogos do módulo.

### Corrigido
- Help Text preenchido em `custentity_pd_petr_country_ls` e no script parameter `custscript_pd_petr_brasil_country` (estavam vazios).

## [1.0.0] - 2026-07-30

### Adicionado
- Implementação inicial do módulo: Client Script + User Event Script consolidando validação de CNPJ/CPF/Registro Fiscal Internacional, checagem de unicidade entre Customer/Job/Vendor, e enriquecimento automático de dados cadastrais via BrasilAPI.
- Botão "Consultar CNPJ" (Create/Edit) para disparo manual do enriquecimento, além do disparo automático via `fieldChanged`.
- Custom field `custentity_pd_petr_country` (País) e script parameter `custscript_pd_petr_brasil_country`.
- Services de apoio: `pd-petr-vendor`, `pd-petr-script-parameters`, `pd-petr-cnpj-api`, `pd-petr-cep-api`, `pd-petr-validators`, `pd-petr-mapper`.
- Utils genéricos `pd-petr-get-data`/`pd-petr-set-data`/`pd-petr-search-data` (portados de `cnab-citibank-remessa`).
- Suporte a enriquecimento via CSV Import (`beforeSubmit`).

Detalhes completos da arquitetura desta versão: [`docs/technical/entity-tax-registration.md`](technical/entity-tax-registration.md).

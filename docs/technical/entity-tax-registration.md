# Entity Tax Registration (pd_entity_tax_registration) — Documentação Técnica

> Versão documentada: 1.0.1 — 2026-08-03

## 1. Visão geral

Módulo `pd_entity_tax_registration` (prefixo `petr`) consolida em um único par de scripts (Client Script + User Event Script) a validação de CNPJ/CPF e Registro Fiscal Internacional, a checagem de unicidade entre entidades (Customer/Job/Vendor) e o enriquecimento automático de dados cadastrais via BrasilAPI. Substitui os projetos legados `pd_c_entity_federal-registration` (cefr) e `pd-cnpj-integration`, que atuavam sobre o mesmo campo de forma independente.

Especificação completa: [`docs/specs/entity-tax-registration.md`](../specs/entity-tax-registration.md).

Status: implementado e deployado na conta `11953512` (Project Dome Do Brasil Ltda) em modo `TESTING` (ver §5.1).

## 2. Arquitetura

Client Script e User Event Script são pontos de entrada finos — toda a lógica de negócio vive em `service/`, orquestrada por `pd-petr-entity.js`:

| Arquivo | Pasta | Responsabilidade |
|---|---|---|
| `pd-petr-entity-tax-registration.cl.js` | `client/` | Repassa os eventos de UI (`pageInit`, `fieldChanged`, `validateField`, `saveRecord`, `fetchCNPJ`) para o service `entity`. |
| `pd-petr-entity-tax-registration.ue.js` | `userevent/` | `beforeLoad`: adiciona o botão "Consultar CNPJ" e aponta `clientScriptModulePath`. `beforeSubmit`: roda enrichment em CSV Import, revalida unicidade em qualquer contexto. |
| `pd-petr-entity.js` | `service/` | Orquestrador: gate por país, habilitação/obrigatoriedade dos campos, checagem de duplicidade, disparo do fetch da BrasilAPI. |
| `pd-petr-vendor.js` | `service/` | Busca de duplicidade específica para Vendor (não usa `N/search` de `entity`, já que Vendor é um record type separado). |
| `pd-petr-script-parameters.js` | `service/` | Lê o script parameter `custscript_pd_petr_brasil_country`. |
| `pd-petr-cnpj-api.js` | `service/` | Chamada HTTPS à BrasilAPI (endpoint CNPJ). |
| `pd-petr-cep-api.js` | `service/` | Chamada HTTPS à BrasilAPI (endpoint CEP), usada para complementar endereço. |
| `pd-petr-validators.js` | `service/` | Checksum CNPJ/CPF (suporta o novo formato alfanumérico da Receita Federal), validação de e-mail, validação do `descricao_situacao_cadastral` da resposta da API. |
| `pd-petr-mapper.js` | `service/` | Preenche campos nativos/custom e o `addressbook` a partir do JSON retornado pela BrasilAPI — só sobrescreve campo já preenchido no caso de Razão Social (ver §6.9); os demais só entram se estiverem vazios. |
| `pd-petr-entity-tax-registration.rl.js` | `restlet/` | Aplica o enriquecimento server-side quando o botão é acionado em modo View (nesse modo o record no client não é editável, `setValue` falha). |
| `pd-petr-validation-settings.js` | `service/` | Service do record de configuração: `get()` (flags que governam o módulo — ver seção 5.2) e a lógica do master switch na UI do próprio record. |
| `pd-petr-validation-settings.cl.js` | `client/` | Client Script do record de configuração: liga/desliga os checkboxes individuais conforme o master switch. |
| `pd-petr-constants.js` | `modules/` | Todos os fieldIds/scriptIds/tipos usados pelos services acima. |
| `pd-petr-get-data.js` / `pd-petr-set-data.js` / `pd-petr-search-data.js` | `util/` | Utils genéricos de leitura/escrita/busca reaproveitados pelos services (portados do projeto de referência `cnab-citibank-remessa`). |

Todos os arquivos estão em `src/FileCabinet/SuiteScripts/product_dome/pd_entity_tax_registration/` (o segmento `product_dome/` é a convenção de pasta-raiz para todos os módulos `pd_` da Produto Dome, análoga ao `project_dome/` usado em projetos de cliente `ds_`).

**Fluxo no `fieldChanged` do campo CNPJ/CPF** (só quando País = Brasil): 1) valida formato (`pd-petr-validators.validateCNPJ`/`validateCPF`) → 2) valida unicidade (`findDuplicate`, via `N/search` para Customer/Job ou `pd-petr-vendor` para Vendor). Falha em qualquer das duas limpa o campo e interrompe a edição.

**Fluxo no `saveRecord`** (só quando País = Brasil): 1) revalida unicidade → 2) se a consulta automática estiver habilitada, o CNPJ tiver 14 dígitos e não tiver sido consultado nesta sessão (`lastFetchedDigits`), dispara `fetchCNPJ` — o enriquecimento é gravado junto com o próprio save. O autofetch fica aqui, e não no `fieldChanged`, para que a chamada à BrasilAPI aconteça uma vez por cadastro em vez de a cada alteração do campo CNPJ.

**Fluxo no campo Registro Fiscal Internacional** (só quando País ≠ Brasil): só validação de unicidade, sem checksum nem chamada à BrasilAPI.

**Gate por país**: todo o bloco de CNPJ/CPF só roda se `custentity_pd_petr_country` (via `getValue`) for igual ao valor do script parameter `custscript_pd_petr_brasil_country` (comparação de internal ID como string).

## 3. Objects (`src/Objects/`)

| scriptid | Tipo | Descrição |
|---|---|---|
| `custentity_pd_petr_country_ls` | `entitycustomfield` (SELECT, `selectrecordtype=-159` / País) | Campo País em Customer/Vendor. Obrigatório (`ismandatory=T`), label "País". Renomeado do prefixo antigo `cefr` para `petr` e, na 1.0.1, para o sufixo de tipo `_ls` (List/Record) — o campo nunca havia sido deployado em produção. |
| `customrecord_pd_petr_validation_settings` | `customrecordtype` | Registro único de configuração (nome de exibição `PD \| PETR \| Configuração das Validações`), com os 13 campos checkbox inline. Ver seção 5.2. |
| `custform_pd_petr_vs` | `entryForm` | Formulário de entrada do record de configuração, campos agrupados em Field Groups. `standard="STANDARDCUSTOMRECORD_PD_PETR_VALIDATION_SETTINGSFORM"`. |
| `customsearch_pd_petr_vs_list` | `savedsearch` | Saved search de listagem do record de configuração. Criada na UI com ID customizado e trazida via `object:import`. |
| `customscript_pd_petr_tax_reg_ue` | `usereventscript` | User Event, 2 deployments ativos + 1 desativado (ver §4) e 1 script parameter (`custscript_pd_petr_brasil_country`). |
| `customscript_pd_petr_tax_reg_cl` | `clientscript` | Client Script principal, 3 deployments. Criado na 1.0.1 — antes o script só era anexado dinamicamente via `form.clientScriptModulePath`. |
| `customscript_pd_petr_tax_reg_rl` | `restlet` | RESTlet que aplica o enriquecimento server-side quando o botão é acionado em modo View. |
| `customscript_pd_petr_vs_cl` | `clientscript` | Client Script do master switch, deployado no próprio record de configuração. |

Campos usados pelo módulo mas **não recriados** neste projeto (pertencem a outros bundles — ver spec §9): `custentity_brl_entity_t_fed_tax_reg`, `custentity_brl_entity_t_int_tax_reg`, `custentity_fte_entity_l_taxregime` (bundle "brl"/FTE Brazil Localization), `customrecord_ftebr_city`, `customrecord_fte_taxregime`.

## 4. Scripts e deployments

| Script | Tipo | scriptid | Deployment(s) | Record type | Status |
|---|---|---|---|---|---|
| `pd-petr-entity-tax-registration.ue.js` | User Event Script | `customscript_pd_petr_tax_reg_ue` | `customdeploy_pd_petr_tax_reg_ue_customer` | `CUSTOMER` | RELEASED |
| | | | `customdeploy_pd_petr_tax_reg_ue_job` | `[scriptid=customrecord_str_job]` | **comentado no Object** |
| | | | `customdeploy_pd_petr_tax_reg_ue_vendor` | `VENDOR` | RELEASED |
| `pd-petr-entity-tax-registration.cl.js` | Client Script | `customscript_pd_petr_tax_reg_cl` | `customdeploy_pd_petr_tax_reg_cl_customer` | `CUSTOMER` | RELEASED |
| | | | `customdeploy_pd_petr_tax_reg_cl_job` | `JOB` | **isdeployed=F — não implementado** |
| | | | `customdeploy_pd_petr_tax_reg_cl_vendor` | `VENDOR` | RELEASED |
| `pd-petr-entity-tax-registration.rl.js` | RESTlet | `customscript_pd_petr_tax_reg_rl` | `customdeploy_pd_petr_tax_reg_rl` | — | RELEASED |
| `pd-petr-validation-settings.cl.js` | Client Script | `customscript_pd_petr_vs_cl` | `customdeploy_pd_petr_vs_cl` | `[scriptid=customrecord_pd_petr_validation_settings]` | RELEASED |

**O deployment de Job do User Event está comentado**, junto com a dependência `<object>customrecord_str_job</object>` em `src/manifest.xml`. `customrecord_str_job` é custom record de um projeto de cliente (prefixo `str`) e não existe nas contas em que o produto é instalado — exigi-lo tornaria o bundle não-instalável. Para reativar, confirme que a conta-alvo tem o record e restaure os dois pontos juntos.

O **Job nativo** também está sem cobertura agora: `customdeploy_pd_petr_tax_reg_cl_job` está com `isdeployed=F` — o deployment existe no Object mas não está ativo na conta. Módulo não roda em Job nativo nem em `customrecord_str_job` neste momento.

Atenção ao `<recordtype>` do contexto Job, se o deployment for reativado: no User Event ele é `[scriptid=customrecord_str_job]` (custom record de terceiro), enquanto no Client Script é a constante nativa `JOB`. Não são intercambiáveis — não uniformize um pelo outro.

O Client Script principal continua sendo anexado via `form.clientScriptModulePath` no `beforeLoad` do User Event, além de ter Object próprio desde a 1.0.1.

Audiência de todos os deployments: `allemployees=T`, `allpartners=T`, `allroles=T` (acesso liberado a todos os roles — sem Object de deployment restritivo).

Todos os arquivos `.js` têm seu `.attributes/{arquivo}.attr.xml` e todas as pastas do módulo têm seu `.attributes/.folder.attr.xml`. **O módulo já está com os flags de bundle aplicados:** todas as pastas e todos os arquivos em `bundleable=T`, e `hideinbundle=T` apenas nos dois arquivos que nenhum Client Script alcança — o User Event e o RESTlet.

Todo o restante fica em `hideinbundle=F` por obrigação, não por escolha: **o Client Script e toda a cadeia de módulos que ele importa, direta ou transitivamente, não podem ser ocultados**. O NetSuite carrega essa árvore inteira no navegador, e qualquer arquivo dela com `hideinbundle=T` faz o deploy falhar com `INVALID_HIDE_IN_BUNDLE_PREFERENCE_SET_FOR_REFERENCED_LIBRARY_FILE`. Hoje a cadeia inclui, além dos dois Client Scripts, os services `entity`, `vendor`, `validators`, `cnpj-api`, `cep-api`, `mapper`, `script-parameters` e `validation-settings`, mais `modules/constants` e os três utils — ou seja, 14 dos 16 arquivos.

`hideinbundle` não existe para pastas, só para arquivos. E essa análise precisa ser refeita a cada import novo: acrescentar um módulo ao `define([...])` de um arquivo que já está na cadeia puxa esse módulo — e tudo que ele importa — para dentro dela.

## 5. Configuração dependente de ambiente

### 5.1 Script parameter e deployment

- **`custscript_pd_petr_brasil_country`**: internal ID do registro de País "Brasil" nesta conta NetSuite. Tem `<setting>COMPANY</setting>` no Object (`customscript_pd_petr_tax_reg_ue.xml`), então o NetSuite o expõe como **preferência de empresa** — configurável em **Configuração > Empresa > Preferências Gerais > Preferências Personalizadas**, não por deployment. Por isso a tag `<custscript_pd_petr_brasil_country>` vem vazia dentro de cada `<scriptdeployment>` (Customer/Vendor): o valor não vive ali, vive uma vez só, no nível da conta. O código lê da mesma forma independente do `<setting>` — `runtime.getCurrentScript().getParameter({ name: ... })` em `pd-petr-script-parameters.js` — só o local onde o admin preenche o valor muda.
- **Precisa ser preenchido manualmente em cada conta/ambiente** onde o módulo for instalado — não tem valor default no código. Sem esse parâmetro preenchido, `getCountryBrazil()` retorna vazio e `isBrazil(country)` nunca é `true`, ou seja, todo o bloco de CNPJ/CPF (checksum + enrichment) fica desativado e o módulo se comporta como se toda entidade fosse estrangeira.
- **Deployment status = `RELEASED`** nos 6 deployments ativos (2 do User Event, 2 do Client Script principal — Customer e Vendor —, 1 do RESTlet, 1 do Client Script de configuração). O deployment de Job do Client Script (`customdeploy_pd_petr_tax_reg_cl_job`) existe no Object mas está com `isdeployed=F` — não implementado.

### 5.2 Record de configuração das validações

`customrecord_pd_petr_validation_settings` ("PD | PETR | Configuração das Validações") é o registro **único** de configuração do módulo: 13 checkboxes que decidem, por conta, quais validações e quais gravações automáticas o módulo executa. É o que permite o mesmo bundle atender clientes com regras diferentes sem alteração de código.

**Leitura — `validationSettingsService.get()`.** Nenhum outro arquivo lê esse record direto; todos consomem o objeto de booleans devolvido por essa função (busca via `pd-petr-search-data.first`, filtro `isinactive = F`). A configuração é lida **uma vez por carregamento de página**, ou uma vez por execução server-side: alteração feita no record só passa a valer na próxima carga de tela — ver §6.2.

**Criar o registro é pré-requisito de funcionamento**, não opt-out. `get()` devolve `null` quando não há registro ativo na conta, e nesse estado nenhuma validação e nenhum enriquecimento é executado.

Comportamento de cada ponto de entrada quando `get()` devolve `null`:

| Ponto | O que acontece |
|---|---|
| `manageCnpjChanged` / `manageInternationalChanged` (`fieldChanged`) | Só `log.debug`. **Sem alerta**, deliberadamente — alertar a cada mudança de campo seria intrusivo. |
| `manageSaveRecord` | `dialog.alert` com título "Configuração necessária" e `return true` — **o save não é bloqueado**, o cadastro grava sem validação. |
| `fetchCNPJ` (botão, modo Create/Edit) | `dialog.alert` e aborta a consulta. |
| `fetchCNPJViaRestlet` (botão, modo View) | Devolve `{ success: false, error: MISSING_SETTINGS_MESSAGE }`. |
| `manageBeforeSubmitServer` | `log.error` e retorna — revalidação server-side não roda. |
| `manageCsvImport` | `log.error` e retorna — enriquecimento via CSV Import não roda. |

O botão "Consultar CNPJ" continua visível quando não há configuração (`shouldShowCnpjButton = !settings || settings.enableCnpjButton`, em `beforeLoad`): é ao clicar nele que o usuário recebe o aviso para criar o registro.

**Master switch.** "Atualizar Todos os Campos" (`custrecord_pd_petr_vs_upd_all_cb`) atua em dois lugares independentes: na UI do próprio record, o Client Script `pd-petr-validation-settings.cl.js` zera e desabilita os 8 checkboxes individuais (guardando os valores anteriores para restaurar se o master for desmarcado); na leitura, o `get()` resolve o master devolvendo as 8 flags individuais como `true` — ver §6.6.

**Onde cada flag é aplicada** (o porquê de ser sempre no service está em §6.4):

| Flag | Ponto de aplicação |
|---|---|
| Validar Duplicidade (CNPJ/CPF Nacional) | `pd-petr-entity`: `manageCnpjChanged`, `manageSaveRecord`, `manageBeforeSubmitServer` |
| Validar Duplicidade (Registro Internacional) | `pd-petr-entity`: `manageInternationalChanged`, `manageSaveRecord`, `manageBeforeSubmitServer` |
| Consulta Automática de CNPJ na Receita | `pd-petr-entity`: autofetch do `manageSaveRecord` e `manageCsvImport` |
| Botão "Consultar CNPJ" | `pd-petr-entity-tax-registration.ue`: `beforeLoad` |
| 8 flags de atualização de campo | `pd-petr-mapper.setFields`: cada `setValue` e o `insertAddress` |

**Objects relacionados:** `customrecord_pd_petr_validation_settings` (record + os 13 campos inline), `custform_pd_petr_vs` (Entry Form, campos agrupados em Field Groups), `customsearch_pd_petr_vs_list` (saved search de listagem) e `customscript_pd_petr_vs_cl` (deployment do Client Script do master switch).

## 6. Decisões de implementação

### 6.1 Autofetch no `saveRecord`, não no `fieldChanged`

A consulta automática à BrasilAPI é disparada em `manageSaveRecord`. No `fieldChanged` ela aconteceria a cada alteração do campo CNPJ — e o `lastFetchedDigits` só evita a repetição do *mesmo* valor já consultado, não as chamadas de valores intermediários. No save é uma chamada por cadastro.

Consequência a conhecer: em modo edição os campos só são preenchidos **depois** de salvar. Para ver os dados antes disso existe o botão "Consultar CNPJ".

### 6.2 Configuração memoizada, `null` deliberadamente não cacheado

`get()` guarda o resultado numa variável de módulo (`cachedSettings`). Como as flags são consultadas dentro de `fieldChanged`/`saveRecord`, sem memoização haveria uma busca por interação do usuário.

O `null` (nenhum registro ativo na conta) **não** é cacheado, de propósito: registro criado durante a sessão passa a valer na chamada seguinte, sem exigir recarga da página. Cachear o `null` economizaria uma busca e criaria um estado morto até o próximo F5.

### 6.3 Normalização de checkbox no util, não no service

Os 13 campos estão marcados com `isCheckbox: true` em `pd-petr-constants.js`, e é o `mapResult` do `pd-petr-search-data` que converte o retorno da busca (string `'T'`/`'F'`) para boolean. Sem isso `'F'` seria *truthy* e toda flag desmarcada leria como habilitada. A conversão fica no util para que qualquer service futuro que leia checkbox herde o tratamento — resolver no service cobriria só este caso.

### 6.4 Flags aplicadas no service, nunca no util

Cada flag é testada no ponto de decisão do service (tabela em §5.2). Os utils de acesso a dados seguem genéricos, sem conhecimento da configuração deste módulo — é o que os mantém portáveis entre projetos, e o motivo de viverem em `util/` e não em `service/`.

### 6.5 Save não bloqueado quando falta configuração

Sem registro de configuração, `manageSaveRecord` alerta e deixa o save prosseguir, e `manageBeforeSubmitServer` só registra `log.error`. **Parece bug e é intencional:** bloquear cadastro por falta de um registro de setup deixaria a conta inoperante logo após a instalação do bundle.

O preço é que cadastros podem ser gravados com CNPJ duplicado nesse intervalo, tendo um `log.error` como único rastro. Se algum cliente não aceitar esse risco, a mudança é em `manageSaveRecord`/`manageBeforeSubmitServer` — não na configuração.

### 6.6 Master switch resolvido na leitura

`get()` já devolve as 8 flags individuais como `true` quando o master está marcado, em vez de expor o master a quem consome. Nenhum service precisa saber que "Atualizar Todos os Campos" existe, e acrescentar uma 9ª flag de campo não exige tocar em nenhum ponto de decisão.

### 6.7 CSV Import governado pela flag "Consulta Automática"

`manageCsvImport` respeita a mesma flag usada pelo `saveRecord`. Deixar o CSV enriquecendo enquanto a consulta automática está desligada seria incoerente. Se a distinção importar para algum cliente, o certo é criar um checkbox novo em vez de reinterpretar o existente.

### 6.8 Checksum de CNPJ/CPF sempre ativo, sem flag

As flags de duplicidade governam a checagem de *unicidade na base*, não a de dígito verificador. Gravar um CNPJ matematicamente inválido não é comportamento que faça sentido oferecer como opção, então a validação de formato roda independente de configuração — inclusive quando `get()` devolve `null`.

### 6.9 Enriquecimento só sobrescreve campo preenchido para Razão Social

`pd-petr-mapper.setIfEmpty` grava só quando o campo está vazio, e é isso que rege telefone, telefone alternativo, fax, e-mail, regime tributário, nome fantasia e endereço. **Trocar o CNPJ de um cadastro existente e salvar não substitui esses campos pelos da nova empresa**, porque eles já não estão vazios — o enriquecimento é complemento de cadastro, não sincronização contínua com a Receita.

**Razão Social (`companyname`) é a única exceção**, e é gravada direto com `setValue`, sem passar por `setIfEmpty` — sempre reflete o retorno da Receita, mesmo substituindo um valor já preenchido manualmente. A justificativa: `companyname` é o nome exibido em listas, buscas e documentos na conta inteira, então não faz sentido essa referência ficar desatualizada em relação ao que a Receita tem — diferente de telefone/e-mail/endereço, que são dados de contato onde o valor digitado por uma pessoa tem prioridade sobre o da API.

### 6.10 Endereço só é acrescentado, comparando por CEP

`insertAddress` insere linha nova no `addressbook` apenas quando nenhuma linha existente tem o mesmo CEP. A manipulação do subrecord é envolvida em `try/catch` que loga e segue: falha no endereço não pode abortar o save do cadastro, porque endereço é enriquecimento e não dado obrigatório.

## 7. Limitações e fora de escopo

- Mapeamento de sócios (`qsa`) do retorno da BrasilAPI — não implementado (exigiria um custom record relacionado); a resposta é só logada (`pd-petr-mapper.setFields`).
- Contact, Employee, Partner — módulo trata apenas Customer/Job/Vendor.
- Descomissionamento dos scripts legados (`pd_c_entity_federal-registration`, `pd-cnpj-integration`) na conta NetSuite — ação de deploy separada, fora deste módulo.
- Objects dos campos de bundles externos (seção 3) — não recriados aqui; dependem do bundle correspondente já estar instalado na conta de destino.

## 8. Notas de manutenção

- O campo País passou por dois renames antes de existir em produção: `custentity_pd_cefr_country_customer` → `custentity_pd_petr_country` (1.0.0) → `custentity_pd_petr_country_ls` (1.0.1, para adotar o sufixo de tipo). Como nunca foi deployado, os renames foram inofensivos. Se alguma conta já tiver qualquer uma das versões anteriores com dados, será necessário um plano de migração antes de instalar este módulo — rename de scriptid já deployado não é uma operação simples no NetSuite.
- Manifest (`src/manifest.xml`) declara `SERVERSIDESCRIPTING`, `CRM`, `ACCOUNTING` e `CREATESUITEBUNDLES` como features obrigatórias — as duas primeiras são exigidas pelo User Event e pelos campos `allpartners`/`appliestovendor`; `CREATESUITEBUNDLES` é exigida para os atributos `bundleable`/`hideinbundle` dos arquivos `.js` funcionarem.
- O deploy emite 2 warnings inofensivos que podem ser ignorados: campo `title` de `scriptdeployment` (não suportado neste schema de User Event, ignorado pela conta) e `aidescription`/`enabletextenhance` do custom field (campos não reconhecidos pela versão de API usada, sem efeito funcional).
- Buscas usam os utils genéricos `pd-petr-get-data.js`/`pd-petr-set-data.js`/`pd-petr-search-data.js` (portados de `cnab-citibank-remessa`) — qualquer novo service que precise ler/escrever/buscar um record deve reaproveitar esses utils em vez de usar `N/record`/`N/search` diretamente.

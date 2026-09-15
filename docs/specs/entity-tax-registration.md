# Especificação — Entity Tax Registration (pd_entity_tax_registration)

## 1. Objetivo

Consolidar os projetos `pd_c_entity_federal-registration` (cefr) e `pd-cnpj-integration` num único módulo, `pd_entity_tax_registration` (prefixo `petr`), responsável por:

- Validar o formato de CNPJ/CPF e de Registro Fiscal Internacional nas entidades (Customer, Job, Vendor).
- Garantir unicidade do CNPJ/CPF (nacional) e do Registro Fiscal Internacional entre entidades.
- Habilitar/desabilitar e tornar obrigatório o campo correto conforme o País da entidade.
- Enriquecer automaticamente dados cadastrais (nome, telefone, e-mail, endereço, regime tributário) via consulta à BrasilAPI, quando País = Brasil.

**Motivação da consolidação:** os dois projetos atuam sobre o mesmo campo (`custentity_brl_entity_t_fed_tax_reg`) através de Client Scripts e User Event Scripts **independentes**, deployados separadamente sobre o mesmo formulário. A ordem de execução entre dois `fieldChanged`/`beforeSubmit` de scripts diferentes não é garantida pelo NetSuite — unificar em um único par de scripts remove essa ambiguidade e centraliza a lógica de negócio em services.

## 2. Arquitetura

Client Script e User Event Script únicos, orquestração apenas — toda lógica de negócio em services (`pd_petr_service/`):

| Service | Origem | Responsabilidade |
|---|---|---|
| `pd-petr-entity.service.js` | cefr (adaptado) | Orquestra: gate por país, habilitação de campos, unicidade, e aciona os services de validação/enriquecimento na ordem correta |
| `pd-petr-vendor.service.js` | cefr | Busca de unicidade específica de Vendor |
| `pd-petr-script-parameters.service.js` | cefr | Leitura do script parameter do país Brasil |
| `pd-petr-cnpj-api.service.js` | cnpj-integration (`pd-cnpj-api.js`) | Chamada HTTPS à BrasilAPI (CNPJ) |
| `pd-petr-cep-api.service.js` | cnpj-integration (`pd-cep-api.js`) | Chamada HTTPS à BrasilAPI (CEP) |
| `pd-petr-validators.service.js` | cnpj-integration (`pd-cnpj-validators.js`) | Checksum CNPJ/CPF, validação de e-mail, validação do status da resposta da API |
| `pd-petr-mapper.service.js` | cnpj-integration (`pd-cnpj-mapper.js`) | Preenchimento de campos/endereço a partir da resposta da BrasilAPI |
| `pd-petr-constants.js` | ambos (unificado) | Todos os fieldIds/scriptIds usados pelos services acima |

**Ordem de execução no `fieldChanged` do campo CNPJ/CPF** (só quando País = Brasil — decisão confirmada nesta especificação):
1. Validar formato (checksum CNPJ/CPF) → alerta + limpa campo se inválido, interrompe.
2. Validar unicidade (busca por outra entidade com o mesmo CNPJ/CPF) → alerta + limpa campo se duplicado, interrompe.
3. Se 1 e 2 passarem e o valor mudou desde a última busca: buscar e enriquecer via BrasilAPI (autofetch).

**No campo Registro Fiscal Internacional** (só quando País ≠ Brasil): só validação de unicidade — sem checksum de formato nem chamada à BrasilAPI (que são específicos de CNPJ/CPF brasileiro).

## 3. Telas / Interfaces

- Formulário de Customer/Job/Vendor: campo País (`custentity_pd_petr_country`), campo CNPJ/CPF (`custentity_brl_entity_t_fed_tax_reg`), campo Registro Fiscal Internacional (`custentity_brl_entity_t_int_tax_reg`) — habilitação/obrigatoriedade mútua conforme o país, calculada no `pageInit` e recalculada no `fieldChanged` do campo País.
- Botão **"Consultar CNPJ"** no formulário (contexto UI, Create/Edit) — mantido conforme decisão desta especificação; dispara busca manual na BrasilAPI mesmo sem alterar o campo.
- Alertas (dialog):
  - CNPJ/CPF com formato inválido.
  - CNPJ/CPF ou Registro Internacional já cadastrado em outra entidade (mensagem diferenciada Vendor vs. Customer/Job, e nacional vs. internacional — ver §4).
  - Erro ao consultar a BrasilAPI (HTTP diferente de 200).
  - Aviso (não bloqueia) quando o status cadastral da empresa não é "ATIVA".

## 4. Critérios e regras de negócio

- **Gate por país:** todo o bloco de CNPJ/CPF (validação de formato + enriquecimento via BrasilAPI) só roda se `custentity_pd_petr_country` = Brasil (internal ID lido do script parameter `custscript_pd_petr_brasil_country`). Esta é uma extensão de comportamento em relação ao `pd-cnpj-integration` original, que rodava independente do país — confirmado nesta especificação.
- **Habilitação mútua:** se País = Brasil → campo CNPJ/CPF habilitado e obrigatório, campo Internacional desabilitado; caso contrário, o inverso. Se País vazio, ambos desabilitados (comportamento herdado do `pageInit` do cefr).
- **Unicidade nacional (CNPJ/CPF):** ao alterar o campo ou salvar, busca por outra entidade (Customer/Job via busca `entity` com filtro de tipo, ou Vendor via service próprio) com o mesmo valor. Se encontrado um `internalid` diferente do registro atual, bloqueia (client-side: limpa o campo + alerta; server-side no `beforeSubmit`: lança exceção).
- **Unicidade internacional:** mesma lógica, para o campo `custentity_brl_entity_t_int_tax_reg`.
- **Correção de mensagem (decisão confirmada nesta especificação):** o `pd_c_entity_federal-registration` original lança sempre `"Registro internacional inválido."` na validação server-side, mesmo quando o conflito é no campo **nacional**. No projeto consolidado, as mensagens passam a ser distintas:
  - Conflito nacional (CNPJ/CPF): `"Registro Fiscal (CNPJ/CPF) já cadastrado."`
  - Conflito internacional: mantém `"Registro internacional inválido."`
- **Validação de formato (CNPJ/CPF):** suporta tanto o CNPJ numérico legado quanto o novo formato alfanumérico (12 caracteres alfanuméricos + 2 dígitos verificadores), conforme nota técnica da Receita Federal — lógica herdada de `pd-cnpj-validators.js` sem alteração.
- **Enriquecimento via BrasilAPI:** só preenche campos **vazios** (nunca sobrescreve valor já preenchido) — nome fantasia/razão social, telefone, telefone alternativo, fax, e-mail, regime tributário, e a primeira linha de endereço (só se `addressbook` estiver vazio). Endereço é complementado por uma segunda chamada à BrasilAPI de CEP, quando disponível.
- **Status cadastral:** se `descricao_situacao_cadastral` da resposta não for `"ATIVA"`, exibe aviso mas **não bloqueia** o preenchimento dos demais campos.
- **CSV Import:** no `beforeSubmit` do tipo `CSVIMPORT`, roda a mesma validação de formato + enriquecimento via BrasilAPI automaticamente (sem botão, já que não há client script nesse contexto).

## 5. Registros e campos envolvidos

**Entity (customer/job/vendor — nativos, campos existentes, não recriados neste projeto):**
- `custentity_brl_entity_t_fed_tax_reg` — CNPJ/CPF nacional (campo do bundle de localização BR, "brl")
- `custentity_brl_entity_t_int_tax_reg` — Registro Fiscal Internacional (idem, bundle "brl")
- `custentity_pd_petr_country` — País (campo herdado do projeto `cefr` original, ainda não deployado em produção — renomeado para o prefixo `petr` deste módulo; Object XML recriado em `src/Objects/`)
- `custentity_fte_entity_l_taxregime` — Regime tributário (dependência do bundle FTE Brazil Localization)
- Campos nativos preenchidos pelo enrichment: `legalname`, `companyname`, `phone`, `altphone`, `fax`, `email`
- Sublist `addressbook` / subrecord `addressbookaddress`: `addr1`, `addr2`, `addr3`, `zip`, `state`, `country`, `addrphone`, `custrecord_brl_addr_form_city`, `custrecord_brl_addrform_t_complement`

**Custom records (dependências externas, bundle FTE — não recriados aqui):**
- `customrecord_ftebr_city` (campo `custrecord_ftebr_city_i_ibge_code`) — lookup de cidade por código IBGE
- `customrecord_fte_taxregime` — lookup de regime tributário por label (`Optante pelo Simples Nacional`, `Lucro Presumido`, `Lucro Real`)

**Novo script parameter (deployment do User Event consolidado):**
- `custscript_pd_petr_brasil_country` — internal ID do registro de País "Brasil". É um novo scriptid porque pertence a um deployment novo; **o valor precisa ser configurado manualmente após o deploy**, específico de cada ambiente NetSuite — fora do escopo do código.

## 6. Contratos de scripts

**Client Script** — `pd-petr-entity-tax-registration.client.js`
- `pageInit(context)` — define estado inicial de habilitação/obrigatoriedade dos campos CNPJ/Internacional conforme País.
- `fieldChanged(context)` — quando `fieldId` = País: recalcula habilitação/obrigatoriedade. Quando `fieldId` = CNPJ/CPF (e País = Brasil): valida formato → valida unicidade → autofetch BrasilAPI. Quando `fieldId` = Internacional (e País ≠ Brasil): valida unicidade.
- `validateField(context)` — valida formato de CNPJ/CPF ao sair do campo.
- `saveRecord(context)` — revalida unicidade do campo aplicável antes de salvar.
- `fetchCNPJ()` — exposta para o botão "Consultar CNPJ".

**User Event Script** — `pd-petr-entity-tax-registration.userevent.js`
- `beforeLoad(context)` — em contexto UI + Create/Edit: adiciona o botão "Consultar CNPJ" e aponta o `clientScriptModulePath`.
- `beforeSubmit(context)` — em contexto CSVIMPORT: valida formato + enriquece via BrasilAPI. Em qualquer contexto: revalida unicidade nacional e internacional (lança exceção com a mensagem corrigida se inválido).

## 7. Fluxo de status

Não aplicável — não há ciclo de vida de registro/lote; é validação e enriquecimento pontual por entidade.

## 8. Permissões

Mesmo padrão default já usado nos dois projetos originais (sem Objects de deployment restritivos visíveis no código-fonte): acesso liberado a todos os roles no deployment dos entry points.

## 9. Fora de escopo

- Mapeamento de sócios (`qsa`) do retorno da BrasilAPI — já sinalizado como fora de escopo no código original do `pd-cnpj-integration` (exigiria um custom record relacionado).
- Contact, Employee, Partner — módulo trata apenas Customer/Job/Vendor, como nos dois projetos originais.
- Objects XML dos campos `custentity_brl_entity_t_fed_tax_reg`, `custentity_brl_entity_t_int_tax_reg`, `custentity_fte_entity_l_taxregime`, `customrecord_ftebr_city`, `customrecord_fte_taxregime` — pertencem a outros bundles/projetos, não recriados aqui. (`custentity_pd_petr_country` é exceção: recriado em `src/Objects/` deste projeto, ver seção 5.)
- Configuração do valor de `custscript_pd_petr_brasil_country` no ambiente NetSuite de destino — tarefa de deploy, não de código.
- Descomissionamento/remoção dos scripts antigos (`pd_c_entity_federal-registration`, `pd-cnpj-integration`) na conta NetSuite — não faz parte deste merge de código; é uma ação de deploy a ser decidida à parte.

## Checklist de implementação

- [x] Parte 1 — Constants (`pd-petr-constants.js`)
- [x] Parte 2 — Services (`validators`, `cnpj-api`, `cep-api`, `mapper`, `script-parameters`, `vendor`, `entity`)
- [x] Parte 3 — Client Script unificado
- [x] Parte 4 — User Event Script unificado
- [x] Parte 5 — Objects XML de deployment (`customscript_pd_petr_tax_reg_ue`, com 3 deployments: Customer/Job/Vendor)
- [x] Parte 6 — Revisão final

## Notas de implementação (divergências da especificação original)

- As buscas usam os utils genéricos `pd_petr_util/` (`pd-petr-get-data.js`, `pd-petr-set-data.js`, `pd-petr-search-data.js`), portados do projeto de referência `Projecto-de-exemplo/cnab-citibank-remessa` (prefixo `ccb`, convenção `ds_`) — mantendo o prefixo `pd`/`pd_petr_*` já combinado, mas adotando o formato de constants `{name: fieldId}` e a busca via `searchData.first`/`run` em vez de `N/search` cru espalhado pelos services (`vendor.service`, `entity.service`, `mapper.service`).
- Não usa `pd/record`/`pd/search` (bundle `pd_p_netsuite_tools`) nem `@NAmdConfig` do projeto `pd_c_entity_federal-registration` original — tooling daquele projeto não foi trazida sem necessidade.
- O Client Script não tem `customscript_*.xml` próprio — é anexado ao formulário via `form.clientScriptModulePath`, setado pelo User Event no `beforeLoad` (mesmo mecanismo do projeto original, evita um segundo deployment).
- Pastas usam nomenclatura de tipo único (`pd_petr_client/`, `pd_petr_userevent/`, `pd_petr_util/`), simétrica a `pd_petr_service/` — não `pd_petr_client_script/`/`pd_petr_user_event/` (nomes herdados por engano do projeto `cefr` original na primeira versão deste merge).
- Scriptid do Object: `customscript_pd_petr_tax_reg_ue` (encurtado de "entity_tax_registration" para caber no limite de caracteres de scriptid/deployment).
- Razão Social é excepcionada da regra "só preenche campos vazios" (linha 56): o campo `companyname` é sempre sobrescrito com o retorno da Receita, mesmo já preenchido, porque é o nome exibido em listas/buscas/documentos na conta inteira — os demais campos (nome fantasia, telefone, e-mail, endereço, regime tributário) continuam só preenchendo quando vazios.

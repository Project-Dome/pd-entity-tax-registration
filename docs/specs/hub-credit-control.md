# Especificação — Controle de créditos da Hub do Desenvolvedor

## 1. Objetivo

Dar ao cliente visibilidade e controle sobre o consumo de créditos da Hub do Desenvolvedor:

- Registrar cada consulta que consome créditos da Hub, com o valor efetivamente cobrado.
- Comparar o consumo do ciclo atual com o pacote mensal contratado e enviar, se o cliente quiser,
  um relatório recorrente por e-mail.
- Tornar opcional, e com ciência registrada, a busca automática da data de nascimento — a etapa
  mais cara da consulta de CPF (até 15 créditos por CPF).

## 2. Arquitetura

Segue a arquitetura e a convenção de pastas já usadas pelo módulo
(`src/FileCabinet/SuiteScripts/product_dome/pd_entity_tax_registration/`: `client/`, `userevent/`,
`service/`, `modules/`…, arquivos `pd-petr-{nome}.{cl|ue|rl|ss}.js`) — não a convenção
`pd_petr_{tipo}/` da skill de scaffold, para não misturar dois padrões no mesmo módulo.

| Peça | Responsabilidade |
|---|---|
| `service/pd-petr-cnpj-lookup.js` (existente) | Após cada chamada à Hub, registra o consumo; aplica o novo fluxo de data de nascimento do CPF. |
| `service/pd-petr-hub-credit-usage.js` (novo) | Grava uma linha de consumo e soma o consumo de um período. |
| `service/pd-petr-credit-report.js` (novo) | Calcula o ciclo atual, monta e envia o relatório por e-mail. |
| `scheduled/pd-petr-credit-report.sc.js` (novo) | Roda diariamente e envia o relatório quando a frequência configurada vence. |
| `userevent/pd-petr-validation-settings.ue.js` (novo) | Grava "Ciente em"/"Ciente por" quando a busca automática de data de nascimento é marcada. |
| `client/pd-petr-validation-settings.cl.js` (existente) | Exibe o popup de aviso de cobrança ao marcar a busca automática. |

A gravação de consumo acontece só no servidor (`pd-petr-cnpj-lookup` já é server-only, chamado
pelo RESTlet e pelo User Event) — o Client Script nunca grava consumo.

## 3. Telas / Interfaces

### 3.1 Registro "PD | PETR | Configuração das APIs" — grupo "Hub do Desenvolvedor"

Novos campos: **Créditos Contratados por Mês** e **Dia de Renovação do Pacote**.

### 3.2 Registro "PD | PETR | Configuração das Validações"

- Grupo "Consulta na Receita": nova flag **Busca Automática de Data de Nascimento (Hub)**, mais
  **Ciente em** e **Ciente por** (somente leitura).
- Novo grupo "Relatório de Créditos da Hub": **Receber Relatório de Créditos**, **Frequência do
  Relatório**, **Último Envio do Relatório** (somente leitura), **Remetente** e **Destinatários**.

### 3.3 Popup de aviso de cobrança

Ao **marcar** "Busca Automática de Data de Nascimento (Hub)" (mudança de desmarcado para marcado),
o Client Script exibe um diálogo de confirmação:

- Texto: quando o CPF não estiver na base da Hub, a busca automática da data de nascimento consome
  até 15 créditos por CPF (10 para obter a data + 5 para consultar a Receita Federal); se o consumo
  ultrapassar os créditos contratados, a Hub pode cobrar adicionalmente.
- Botões: **Estou ciente** (mantém marcada) e **Cancelar** (desmarca a flag).

Desmarcar a flag não exibe popup. Marcar de novo exibe o popup novamente.

A flag fica **desabilitada (e desmarcada) enquanto "Consultar CPF (Hub)" estiver desmarcado** —
mesmo comportamento já usado por "Atualizar Todos os Campos" com os campos individuais. Ao
desmarcar "Consultar CPF (Hub)", a busca automática é desmarcada junto; ao marcar de novo, ela
volta habilitada, mas desmarcada (exige novo "Estou ciente").

### 3.4 Customer / Vendor

Novo campo **Data de Nascimento** (entity field, aplicado a Customer e Vendor).

### 3.5 E-mail do relatório de créditos

Conteúdo (HTML simples, em português):

- Período do ciclo atual (início = última data de renovação; fim = véspera da próxima).
- Créditos contratados por mês, créditos consumidos no ciclo, saldo e percentual utilizado.
- Quando o consumo passar do contratado: destaque com o excedente e o aviso de possível cobrança
  adicional pela Hub.
- Consumo do ciclo agrupado por tipo de consulta (quantidade de consultas e créditos de cada tipo).

## 4. Critérios e regras de negócio

### 4.1 Registro de consumo

- Uma linha no registro de consumo **por chamada à Hub que tenha cobrado créditos**: o valor é o
  campo `consumed` da resposta da Hub. Chamadas sem `consumed` ou com `consumed` = 0 (ex.:
  `last_update=2`, erros de token/saldo) não geram linha.
- Tipos de consulta registrados: `CNPJ`, `CNPJ + Inscrição Estadual`, `CPF (base Hub)`,
  `CPF (Receita Federal)`, `Data de Nascimento (nome_cpf)`.
- Consultas ao ReceitaWS não geram linha (não consomem créditos da Hub).
- Falha ao gravar a linha de consumo **não** interrompe a consulta: é registrada no log e a
  consulta segue normalmente.
- Ultrapassar os créditos contratados **não bloqueia** consultas — só aparece no relatório.

### 4.2 Ciclo do pacote

- O pacote é mensal. O ciclo atual começa no dia "Dia de Renovação do Pacote" do mês corrente, se
  esse dia já chegou; senão, no mesmo dia do mês anterior.
- "Dia de Renovação do Pacote" aceita valores de 1 a 28, para que todo mês tenha esse dia.

### 4.3 Fluxo do CPF com data de nascimento

Substitui o fluxo atual de `getPersonData` (que sempre buscava a data no `nome_cpf`):

1. `v2/cpf` com `last_update=2` (grátis): verifica se o CPF está na base da Hub.
2. **Na base:** `v2/cpf` só com o CPF (1 crédito).
3. **Fora da base:**
   1. Se o cadastro tem **Data de Nascimento** preenchida: `v2/cpf` com essa data (5 créditos).
   2. Senão, se **Busca Automática de Data de Nascimento (Hub)** está marcada: `v2/nome_cpf`
      (10 créditos) para obter a data, depois `v2/cpf` com ela (5 créditos).
   3. Senão: a consulta para sem gastar créditos e o usuário recebe a mensagem pedindo para
      preencher a Data de Nascimento do cadastro.
4. Quando a data de nascimento vier da Hub (`nome_cpf` ou `data_nascimento` do `v2/cpf`), ela é
   gravada no campo **Data de Nascimento** do cadastro **somente se estiver vazio**.

Para o passo 3.1, a data do cadastro precisa chegar ao orquestrador em todos os caminhos: botão em
create/edit (o Client Script lê o campo e envia ao RESTlet), botão em modo view (o RESTlet lê do
record carregado) e CSV Import (lida do `newRecord`).

### 4.4 Ciência da busca automática

- Gravada no servidor (User Event `beforeSubmit` do registro de Validações) quando a flag passa de
  desmarcada para marcada: **Ciente em** = data/hora atual, **Ciente por** = usuário corrente.
- Desmarcar a flag mantém os valores anteriores de "Ciente em"/"Ciente por" (histórico da última
  ciência). Marcar de novo sobrescreve com o novo usuário e a nova data/hora.
- Não há envio de e-mail na ciência.

### 4.5 Envio do relatório

O Scheduled Script roda uma vez por dia e envia o relatório quando **todas** as condições valem:

- "Receber Relatório de Créditos" marcado, com Remetente e ao menos um Destinatário preenchidos.
- A frequência venceu em relação a "Último Envio do Relatório":
  - **Diário**: último envio anterior a hoje (ou vazio).
  - **Semanal**: 7 dias ou mais desde o último envio (ou vazio).
  - **Mensal**: 1 mês ou mais desde o último envio (ou vazio).
- Após enviar, grava a data de hoje em "Último Envio do Relatório".

Sem registro de Validações ativo, ou com as condições acima não atendidas, o script termina sem
enviar e registra o motivo no log.

## 5. Registros e campos envolvidos

### 5.1 Novo custom record — consumo de créditos

`customrecord_pd_petr_hub_credit_usage` — "PD | PETR | Consumo de Créditos da Hub". A data da
consulta é a data de criação nativa do registro (`created`).

| Campo | scriptid | Tipo |
|---|---|---|
| Tipo de Consulta | `custrecord_pd_petr_hcu_query_type_ds` | Free-Form Text |
| CPF/CNPJ Consultado | `custrecord_pd_petr_hcu_document_ds` | Free-Form Text |
| Créditos Consumidos | `custrecord_pd_petr_hcu_credits_nu` | Integer |
| Usuário | `custrecord_pd_petr_hcu_user_ls` | List/Record (Employee) |

Não há campo de entidade: em create/edit a consulta acontece antes de o cadastro existir. Ganha
também a saved search de listagem `customsearch_pd_petr_hcu_list`, criada na UI e importada.

### 5.2 `customrecord_pd_petr_api_settings` — novos campos

| Campo | scriptid | Tipo |
|---|---|---|
| Créditos Contratados por Mês | `custrecord_pd_petr_as_hub_credits_nu` | Integer |
| Dia de Renovação do Pacote | `custrecord_pd_petr_as_hub_renewal_day_nu` | Integer (1–28) |

### 5.3 `customrecord_pd_petr_validation_settings` — novos campos

| Campo | scriptid | Tipo |
|---|---|---|
| Busca Automática de Data de Nascimento (Hub) | `custrecord_pd_petr_vs_hub_auto_birth_cb` | Check Box |
| Ciente em (Hub) | `custrecord_pd_petr_vs_hub_ack_at_dh` | Date/Time (somente leitura) |
| Ciente por (Hub) | `custrecord_pd_petr_vs_hub_ack_by_ls` | List/Record (Employee, somente leitura) |
| Receber Relatório de Créditos | `custrecord_pd_petr_vs_report_email_cb` | Check Box |
| Frequência do Relatório | `custrecord_pd_petr_vs_report_freq_ls` | List/Record (`customlist_pd_petr_report_frequency`) |
| Último Envio do Relatório | `custrecord_pd_petr_vs_report_last_dt` | Date (somente leitura) |
| Remetente | `custrecord_pd_petr_vs_email_sender_ls` | List/Record (Employee) |
| Destinatários | `custrecord_pd_petr_vs_email_recipient_ms` | Multiple Select (Employee) |

Abreviações por limite de 40 caracteres: `report_freq` (o nome completo
`custrecord_pd_petr_vs_report_frequency_ls` teria 41) e `email_recipient` no singular (o plural
teria 41).

As chaves das flags novas no `pd-petr-constants.js` não começam com `update`, para ficarem fora do
master switch "Atualizar Todos os Campos".

### 5.4 Nova custom list

`customlist_pd_petr_report_frequency` — valores: Diário, Semanal, Mensal.

### 5.5 Customer / Vendor — novo entity field

| Campo | scriptid | Tipo |
|---|---|---|
| Data de Nascimento | `custentity_pd_petr_birth_date_dt` | Date (aplicado a Customer e Vendor) |

## 6. Contratos de scripts

### 6.1 `customscript_pd_petr_credit_report_ss` — Scheduled Script

- Arquivo: `scheduled/pd-petr-credit-report.sc.js`.
- Deployment: `customdeploy_pd_petr_credit_report_ss`, agendamento diário.
- Sem parâmetros: tudo vem dos registros de configuração (seção 4.5).
- Nome sem "hub": `customscript_pd_petr_hub_credit_report_ss` teria 41 caracteres.

### 6.2 `customscript_pd_petr_vs_ue` — User Event no registro de Validações

- Arquivo: `userevent/pd-petr-validation-settings.ue.js` (par do `customscript_pd_petr_vs_cl`).
- `beforeSubmit` (create/edit): grava a ciência (seção 4.4).

### 6.3 `customscript_pd_petr_vs_cl` — Client Script existente

- `fieldChanged`: popup da seção 3.3 ao marcar a busca automática.

### 6.4 `pd-petr-cnpj-lookup.getCompanyData` — contrato estendido

- Passa a receber `getCompanyData(document, options)`, com `options.birthDate` (data de nascimento
  do cadastro, opcional). O RESTlet de consulta por CNPJ passa a aceitar `birthDate` no corpo.
- O retorno de CPF passa a incluir `data_nascimento` quando a Hub devolver, para o mapper
  preencher o campo do cadastro.
- Novo motivo de falha `BIRTH_DATE_REQUIRED`, com a mensagem pedindo a Data de Nascimento.

## 7. Fluxo de status

Não há ciclo de vida de registro. O único estado relevante é o da ciência (seção 4.4).

## 8. Permissões

- Registro de consumo: criado pelos scripts (RESTlet e User Event rodam com a permissão do
  contexto); leitura pela listagem para os papéis que já acessam os registros de configuração.
- Os scripts novos seguem a mesma configuração de deployment dos scripts existentes do módulo
  (todos os papéis).

## 9. Fora de escopo

- E-mail de ciência ao marcar a busca automática (decidido: só registra usuário e data/hora).
- Bloquear consultas ao ultrapassar os créditos contratados.
- Consultar o saldo real na Hub: o consumo é contabilizado localmente a partir do `consumed`.
- Destinatários que não sejam funcionários do NetSuite.
- Vincular o consumo ao cadastro (Customer/Vendor) que originou a consulta.

## 10. Notas de implementação

- **Objects novos em subpastas** (`src/Objects/pd_petr/custom_list|custom_record|custom_field/`), conforme a skill `netsuite-object-scaffold`; os Objects já existentes continuam soltos em `src/Objects/`, e os `customscript_*.xml` novos ficaram junto dos existentes do módulo.
- **Registro de consumo com `accesstype` `NONENEEDED`** (não estava na spec): a linha é gravada pelo RESTlet/User Event com o papel do usuário que consultou; com permissão por registro, um usuário sem acesso faria a gravação falhar.
- **Registro de consumo sem entry form próprio** (usa o form padrão) e **sem saved search de listagem por enquanto**: pela convenção, a `customsearch_pd_petr_hcu_list` é criada na UI e importada — fica como passo manual pós-deploy.
- **Nome de exibição da custom list encurtado** para "PD | PETR | Freq. do Relatório": o limite do campo `name` de custom list é 30 caracteres (o dry-run recusou "PD | PETR | Frequência do Relatório").
- **Tipo de consulta extra** `Verificação de base do CPF` (constante `QUERY_TYPES.CPF_DATABASE_CHECK`): o `last_update=2` passa pelo mesmo registro de consumo, mas só gera linha se a Hub um dia cobrar por ele (`consumed` > 0).
- **Datas para a Hub sempre em DD/MM/AAAA**: o Client Script monta a data com o fuso do navegador antes de enviar ao RESTlet (serializar o `Date` em JSON viraria UTC e poderia trocar o dia); no servidor, `toHubDate` aceita `Date`, ISO e DD/MM/AAAA.
- **`BIRTH_DATE_REQUIRED` tem aviso próprio** no Client Script ("Data de Nascimento necessária"), sem a mensagem de contato com o suporte, porque não é erro.
- **Popup com `dialog.create`** em vez de `dialog.confirm`, para ter os rótulos "Estou ciente"/"Cancelar".
- **Ciência em inline edit**: o `beforeSubmit` lê do `oldRecord` os campos que não vieram na edição inline (`xedit`), para não perder a regra de dependência nem gravar ciência indevida.
- **O relatório faz busca própria** no registro de Validações (o `get()` do service descarta o `internalid`, necessário para gravar "Último Envio"); `pd-petr-api-settings.get()` passou a devolver `hubMonthlyCredits` e `hubRenewalDay`.
- **Agendamento do Scheduled Script**: diário a partir de 08/10/2026, 08:00 (UTC no XML) — ajustável no deployment.
- **Inscrição Estadual sem créditos adicionais**: a documentação da Hub indicava +2 créditos para `ie=1`, mas o `consumed` da resposta e o saldo no painel da Hub mostraram 1 crédito por consulta de CNPJ com IE. Textos de ajuda, guia e comentários corrigidos; o registro de consumo já gravava o valor real.
- **Arquivo do Scheduled Script com sufixo `.sc.js`**, não `.ss.js`: `.ss` é extensão de SSP no NetSuite, e o carregador de módulos não acrescentava o `.js` (`MODULE_DOES_NOT_EXIST` ao executar). O scriptid `customscript_pd_petr_credit_report_ss` foi mantido.

## Checklist de implementação

- [x] Parte 1 — Objects: custom list de frequência, custom record de consumo (com form e saved search de listagem), novos campos nos registros de APIs e Validações (e respectivos forms), entity field Data de Nascimento. *(saved search de listagem pendente — criação manual na UI)*
- [x] Parte 2 — Constants + service `pd-petr-hub-credit-usage` (gravar linha, somar período) e registro de consumo em todas as chamadas à Hub do `pd-petr-cnpj-lookup`.
- [x] Parte 3 — Fluxo do CPF com Data de Nascimento do cadastro e busca automática condicionada à flag; preenchimento da data no cadastro; repasse do `birthDate` pelo Client Script, RESTlet e CSV Import.
- [x] Parte 4 — Popup no Client Script de Validações + User Event `customscript_pd_petr_vs_ue` gravando a ciência.
- [x] Parte 5 — Service `pd-petr-credit-report` + Scheduled Script `customscript_pd_petr_credit_report_ss` (ciclo, frequência, e-mail, último envio).
- [ ] Parte 6 — Dry-run, deploy no sandbox e teste ponta a ponta. *(deploy no sandbox 11953512-sb1 em 2026-10-07; falta o teste ponta a ponta)*

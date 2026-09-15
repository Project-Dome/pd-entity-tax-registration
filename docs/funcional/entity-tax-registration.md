# Cadastro Fiscal de Clientes e Fornecedores — Guia do Usuário

> Versão documentada: 1.0.1 — 2026-08-03

## 1. Objetivo

Esta funcionalidade garante que o cadastro fiscal de Clientes e Fornecedores esteja sempre correto e sem duplicidade, independente do país da entidade:

- Valida automaticamente o formato do Cadastro Federal (CNPJ/CPF) e do Registro Fiscal Internacional.
- Impede que dois cadastros diferentes usem o mesmo Cadastro Federal ou Registro Fiscal Internacional.
- Mostra o campo correto (Cadastro Federal ou Registro Fiscal Internacional) e o exige como obrigatório, de acordo com o País informado.
- Ao salvar um cadastro com CNPJ válido de uma empresa brasileira, busca automaticamente os dados cadastrais dessa empresa (razão social, telefone, e-mail, endereço, regime tributário) e preenche os campos que ainda estiverem vazios — sem sobrescrever nada que já foi preenchido manualmente, com exceção da Razão Social, que é sempre atualizada com o retorno da Receita.

Cada uma dessas verificações pode ser ligada ou desligada individualmente, por conta, na tela de configuração descrita na próxima seção.

O usuário consegue configurar e usar esta funcionalidade sem depender da equipe de desenvolvimento.

## 2. Configuração

Configuração feita uma vez por ambiente, geralmente pelo administrador do sistema, logo após a instalação. São duas etapas, e **as duas são obrigatórias** — sem elas a funcionalidade não opera.

### 2.1 Criar o registro "Configuração das Validações"

Este registro é o que liga as validações. **Enquanto ele não existir, nenhuma validação e nenhuma busca automática de dados é executada** — os cadastros continuam podendo ser salvos, mas sem nenhuma verificação.

1. Acesse **Personalização > Listas, Registros > PD | PETR | Configuração das Validações**.
2. Clique em **Novo** para criar o registro. Só deve existir **um** registro ativo por conta.
3. Marque as verificações que deseja ativar. Os campos vêm organizados em três grupos — "Validação de Duplicidade", "Consulta na Receita" e "Atualização de Campos via Receita" — e cada um tem um texto de ajuda explicando o efeito.

   ![Formulário do registro aberto, mostrando os três grupos de campos](images/entity-tax-registration/print3.png)
4. Se quiser que **todos** os campos sejam atualizados automaticamente pela Receita, marque **Atualizar Todos os Campos**. Ao marcar, os oito campos individuais abaixo são desmarcados e ficam bloqueados — desmarcando novamente, eles voltam como estavam.

   ![Efeito do "Atualizar Todos os Campos" marcado, com os campos individuais desabilitados](images/entity-tax-registration/print4.png)
5. Salve o registro.

A configuração é lida uma vez a cada carregamento de tela. Alterações feitas aqui passam a valer no próximo cadastro aberto.

### 2.2 Informar o país "Brasil" da conta

1. Acesse **Configuração > Empresa > Preferências Gerais**.
2. Clique na subaba **Preferências Personalizadas**.
3. Na seção **"PD | Entity Tax Registration"**, selecione **Brasil** no campo **Brasil Country Internal ID**.

   ![Seção "PD | Entity Tax Registration" na subaba Preferências Personalizadas, com "Brasil" selecionado no campo](images/entity-tax-registration/print5.png)
4. Salve a página.

Sem esse campo preenchido, o sistema não consegue identificar quando uma entidade é brasileira, e a validação de CNPJ/CPF e a busca automática de dados ficam desativadas.

### Papéis de acesso

Nesta versão, tanto a tela de configuração quanto a funcionalidade nos cadastros estão liberadas para **todos os papéis** — não há restrição por perfil.

## 3. Utilização

Aplica-se aos cadastros de **Cliente** e **Fornecedor**.

1. Abra um cadastro de Cliente ou Fornecedor (novo ou existente) e selecione o **País**.

   ![Formulário do Cliente com o campo País em destaque, antes de selecionar](images/entity-tax-registration/print11.png)
2. Ao selecionar o País, o sistema habilita automaticamente o campo correto:
   - País = **Brasil** → **Cadastro Federal** fica habilitado e obrigatório; **Registro Fiscal Internacional** fica desabilitado.
   - Qualquer outro país → o inverso.
3. **Se País = Brasil:** preencha o **Cadastro Federal** com o CNPJ ou CPF da entidade. O formato e a duplicidade são validados ao sair do campo.

   ![Cadastro Federal preenchido, sem alertas](images/entity-tax-registration/print13.png)
4. Para trazer os dados da empresa **antes** de salvar, use o botão **"Consultar CNPJ"**, ao lado do campo Cadastro Federal. Ele funciona nos modos de **criação, edição e visualização** — em visualização, a página é recarregada ao final para exibir os dados atualizados.

   ![Botão "Consultar CNPJ" em destaque, nos modos de edição e de visualização](images/entity-tax-registration/print14.png)
5. **Se o País não for Brasil:** preencha o **Registro Fiscal Internacional** com o identificador fiscal da entidade no país de origem. Não há busca automática de dados nesse caso.

   ![Campo Registro Fiscal Internacional preenchido, com País diferente de Brasil](images/entity-tax-registration/print15.png)
6. Salve o cadastro. O sistema revalida a unicidade do campo aplicável e, se o País for Brasil e o CNPJ tiver 14 dígitos, busca os dados da empresa na Receita e preenche razão social, nome fantasia, telefone, e-mail, endereço e regime tributário — **somente os campos vazios e somente os que estiverem marcados na configuração**, com uma exceção: a **Razão Social é sempre atualizada** com o retorno da Receita, mesmo que já exista um valor preenchido. Os demais campos, uma vez preenchidos manualmente, nunca são alterados.

## 4. Campos e parâmetros

### 4.1 Campos do cadastro

| Campo (rótulo na tela) | Onde aparece | O que significa | Obrigatório? | Valores aceitos / exemplo |
|---|---|---|---|---|
| País | Formulário de Cliente/Fornecedor | Define qual dos dois campos abaixo fica habilitado e obrigatório. | Sim | Qualquer país da lista padrão do NetSuite. |
| Cadastro Federal | Mesmo formulário, próximo a País | CNPJ (pessoa jurídica) ou CPF (pessoa física) da entidade brasileira. Usado para validar duplicidade e buscar dados cadastrais. | Sim, quando País = Brasil | CNPJ: 14 caracteres (aceita o novo formato alfanumérico da Receita Federal) — ex. `11.222.333/0001-81`. CPF: 11 dígitos. |
| Registro Fiscal Internacional | Mesmo formulário | Identificador fiscal da entidade em países que não usam CNPJ/CPF. Usado para validar duplicidade. | Sim, quando País ≠ Brasil | Texto livre, deve ser único entre os cadastros. |
| Botão "Consultar CNPJ" | Ao lado do campo Cadastro Federal | Dispara a busca de dados na Receita na hora, sem esperar o salvamento. Disponível em criação, edição e visualização. | — | — |

### 4.2 Configuração das Validações (ver seção 2.1)

| Campo (rótulo na tela) | Grupo | O que significa |
|---|---|---|
| Validar Duplicidade (CNPJ/CPF Nacional) | Validação de Duplicidade | Verifica se o CNPJ/CPF informado já está cadastrado em outra entidade antes de salvar. |
| Validar Duplicidade (Registro Internacional) | Validação de Duplicidade | Verifica se o Registro Fiscal Internacional já está cadastrado em outra entidade antes de salvar. |
| Consulta Automática de CNPJ na Receita | Consulta na Receita | Consulta a Receita automaticamente ao salvar um cadastro (criação ou edição) com CNPJ válido, sem precisar clicar no botão. Vale também para importação por planilha. |
| Botão "Consultar CNPJ" | Consulta na Receita | Exibe o botão de consulta manual no formulário de Cliente/Fornecedor. |
| Atualizar Nome Fantasia | Atualização de Campos via Receita | Preenche o Nome Fantasia com o retorno da Receita, se estiver vazio. |
| Atualizar Razão Social | Atualização de Campos via Receita | Preenche a Razão Social com o retorno da Receita — **sempre**, mesmo que já exista um valor preenchido. |
| Atualizar Telefone | Atualização de Campos via Receita | Preenche o Telefone, se estiver vazio. |
| Atualizar Telefone Alternativo | Atualização de Campos via Receita | Preenche o Telefone Alternativo, se estiver vazio. |
| Atualizar Fax | Atualização de Campos via Receita | Preenche o Fax, se estiver vazio. |
| Atualizar E-mail | Atualização de Campos via Receita | Preenche o E-mail, se estiver vazio. |
| Atualizar Regime Tributário | Atualização de Campos via Receita | Preenche o Regime Tributário a partir do retorno da Receita, se estiver vazio. |
| Atualizar Endereço | Atualização de Campos via Receita | Preenche o endereço a partir do retorno da Receita/CEP, somente se o cadastro de endereços estiver vazio. |
| Atualizar Todos os Campos | Atualização de Campos via Receita | Liga a atualização de todos os campos acima de uma vez e desabilita a seleção individual. |

> A validação de **formato** do CNPJ/CPF (dígito verificador) roda sempre e não tem opção de desligar — gravar um CNPJ matematicamente inválido não é um comportamento oferecido como escolha.

### 4.3 Parâmetro de ambiente (ver seção 2.2)

| Campo (rótulo na tela) | Onde aparece | O que significa | Obrigatório? |
|---|---|---|---|
| Brasil Country Internal ID | Configuração > Empresa > Preferências Gerais, subaba Preferências Personalizadas | Diz ao sistema qual registro de País representa "Brasil" nesta conta. | Sim, uma vez por ambiente |

## 5. Exemplos de uso

**Cenário 1 — Cadastro de Cliente brasileiro com preenchimento automático:**
1. Cria-se um novo Cliente e seleciona-se País = Brasil.
2. Preenche-se Cadastro Federal com `11.222.333/0001-81` (CNPJ fictício, usado só para ilustrar o fluxo). Ao sair do campo, o sistema valida o formato e confirma que não há outro cadastro com esse CNPJ.
3. Salva-se o cadastro. Nesse momento o sistema busca razão social, telefone, e-mail e endereço na Receita — preenchendo apenas os campos vazios cuja atualização está marcada na configuração.

**Cenário 2 — Erro: configuração ainda não criada:**
1. Ao salvar um cadastro, ou ao clicar em "Consultar CNPJ", aparece o alerta **"Configuração necessária"**, com a mensagem: *"Não há registro de Configuração das Validações ativo nesta conta. Crie-o para habilitar a validação e a atualização automática dos dados da entidade. Em caso de dúvida, acione a equipe Dome."*
2. **Atenção:** o cadastro ainda é salvo, mas **sem nenhuma validação** — pode gravar CNPJ duplicado ou inválido quanto à unicidade. Crie o registro descrito na seção 2.1 antes de usar a funcionalidade em produção.

**Cenário 3 — Erro: CNPJ já cadastrado em outra entidade:**
1. Ao preencher o Cadastro Federal com um CNPJ que já existe em outro Cliente ou Fornecedor, o sistema exibe um alerta informando que o CNPJ/CPF já está cadastrado e limpa o campo.
2. Confira se não está duplicando um cadastro existente antes de tentar novamente.

**Cenário 4 — Erro: formato inválido:**
1. Ao preencher o Cadastro Federal com um valor que não corresponde a um CNPJ/CPF válido, o sistema exibe um alerta específico ("CNPJ inválido"/"CPF inválido") e limpa o campo.

**Cenário 5 — Cliente de outro país:**
1. Cria-se um novo Cliente e seleciona-se um País diferente de Brasil.
2. O campo Cadastro Federal fica desabilitado; preenche-se o Registro Fiscal Internacional com o identificador fiscal local. Não há busca automática de dados nesse caso.


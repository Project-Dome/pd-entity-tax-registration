/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * CITY_LOOKUP.NAME_FORMULAS: customrecord_ftebr_city não tem campos separados de nome/UF —
 * ambos vêm no campo nativo "name", no formato "{Cidade} - {UF}". Fórmulas portadas de
 * pd-pcnpj-suitesuccess-city.service.js (projeto de referência pd-p-cnpj-integration), usadas
 * quando não há código IBGE.
 *
 * VALIDATION_SETTINGS.FIELDS.enableStateRegLookup / enableCpfLookup: chaves propositalmente sem
 * prefixo "update", para ficar fora do master switch "Atualizar Todos os Campos" — consultar
 * Inscrição Estadual ou CPF na Hub precisa ser uma escolha explícita (o CPF consome créditos).
 *
 * VALIDATION_SETTINGS.PRIVATE_FIELD_KEYS: campos que o Suitelet anônimo de busca
 * (DATA_LOOKUP) nunca devolve — remetente/destinatários do relatório e quem deu ciência da
 * cobrança. Nenhum consumidor de pd-petr-validation-settings.get() usa esses campos (o
 * relatório agendado faz a própria busca).
 *
 * DATA_LOOKUP.DUPLICATE_FIELD_KEYS: chaves de ENTITY.FIELDS aceitas na ação FIND_DUPLICATE —
 * lista fechada para o endpoint público não virar busca por campo arbitrário.
 *
 * VALIDATION_SETTINGS.FIELDS dos botões e da hierarquia (enableDirectd*, *InChain,
 * directdChainMode): chaves sem prefixo "update", para ficarem fora de "Atualizar Todos os
 * Campos". Não são sigilosas — o Suitelet anônimo de busca as devolve ao User Event.
 *
 * CREDIT_USAGE: registro único de consumo das APIs pagas (docs/specs/directd-integration.md
 * §4.5). HUB_EXPECTED_CREDITS é o custo previsto de cada chamada à Hub, usado só para checar o
 * saldo antes de chamar; o registro grava o "consumed" real. CNPJ = 1 crédito, com ou sem IE
 * (conferido no saldo da Hub — hub-credit-control.md, Notas de implementação).
 *
 * DIRECTD.CHAIN_MODE_BY_LABEL: o valor de "Consulta DirectD na Hierarquia" é comparado pelo texto
 * da lista customlist_pd_petr_dd_chain_mode (mesmo padrão de REPORT_FREQUENCY).
 *
 * PANEL: Painel do Cadastro Fiscal (docs/specs/tax-registration-panel.md). STATICS são os nomes
 * dos arquivos estáticos procurados pelo nome em todo o File Cabinet (pd-petr-suitelet.js) — por
 * isso precisam ser únicos na conta. DIRECTD_MODE_SETTINGS liga cada modo da DirectD à flag do
 * botão correspondente nas Validações: o painel só oferece o modo com o botão habilitado.
 * BILLING_ADDRESS_JOIN é o join da busca de Customer/Vendor para ler campos personalizados do
 * endereço de faturamento (Complemento), que não têm coluna bill* própria.
 */
define([], function () {

    return {

        API: {
            CEP_BASE_URL: 'https://brasilapi.com.br/api/cep/v2/',
            RECEITAWS_BASE_URL: 'https://receitaws.com.br/v1/cnpj/',
            HUB_CNPJ_BASE_URL: 'https://ws.hubdodesenvolvedor.com.br/v2/cnpj/',
            HUB_CPF_BASE_URL: 'https://ws.hubdodesenvolvedor.com.br/v2/cpf/',
            HUB_NAME_CPF_BASE_URL: 'https://ws.hubdodesenvolvedor.com.br/v2/nome_cpf/',
            DIRECTD_BASE_URL: 'https://apiv3.directd.com.br/api/'
        },

        LOOKUP_MODES: {
            DEFAULT: 'DEFAULT',
            DD_FULL: 'DD_FULL',
            DD_PLUS: 'DD_PLUS',
            DD_BASIC: 'DD_BASIC',
            DD_IE: 'DD_IE'
        },

        DIRECTD: {
            ENDPOINTS: {
                PLUS: 'CadastroPessoaJuridicaPlus',
                BASIC: 'CadastroPessoaJuridica',
                SINTEGRA: 'Sintegra',
                FEDERAL_REVENUE: 'ReceitaFederalPessoaJuridica'
            },
            CHAIN_MODE_BY_LABEL: {
                'Consulta Completa': 'DD_FULL',
                'CNPJ Plus': 'DD_PLUS',
                'CNPJ Básico': 'DD_BASIC'
            }
        },

        ENTITY: {
            TYPE: 'entity',

            TYPE_LIST: {
                CUSTOMER_AND_JOB: 'CustJob',
                VENDOR: 'Vendor'
            },

            FIELDS: {
                internalId: { name: 'internalid' },
                type: { name: 'type' },
                cnpj: { name: 'custentity_brl_entity_t_fed_tax_reg' },
                international: { name: 'custentity_brl_entity_t_int_tax_reg' },
                country: { name: 'custentity_pd_petr_country_ls' },
                companyName: { name: 'legalname' },
                firstName: { name: 'firstname' },
                tradeName: { name: 'companyname' },
                phone: { name: 'phone' },
                email: { name: 'email' },
                taxRegime: { name: 'custentity_fte_entity_l_taxregime' },
                stateRegistration: { name: 'custentity_brl_entity_t_state_tx_reg' },
                birthDate: { name: 'custentity_pd_petr_birth_date_dt' },
                entityId: { name: 'entityid' },
                billCity: { name: 'billcity' },
                billState: { name: 'billstate' },
                billZip: { name: 'billzipcode' },
                billAddress1: { name: 'billaddress1' },
                billAddress2: { name: 'billaddress2' },
                billAddress3: { name: 'billaddress3' },
                lastModified: { name: 'lastmodifieddate' },
                isInactive: { name: 'isinactive' }
            },

            RECORD_TYPES: {
                CUSTOMER: 'customer',
                VENDOR: 'vendor'
            },

            SUBLISTS: {
                ADDRESS: {
                    ID: 'addressbook',
                    SUBRECORD: {
                        ID: 'addressbookaddress',
                        FIELDS: {
                            ADDR1: 'addr1',
                            ADDR2: 'addr2',
                            ADDR3: 'addr3',
                            ZIP: 'zip',
                            CITY: 'custrecord_brl_addr_form_city',
                            STATE: 'state',
                            COUNTRY: 'country',
                            PHONE: 'addrphone',
                            COMPLEMENT: 'custrecord_brl_addrform_t_complement'
                        }
                    }
                }
            },

            CITY_LOOKUP: {
                RECORD_TYPE: 'customrecord_ftebr_city',
                FIELDS: {
                    internalId: { name: 'internalid' },
                    ibgeCode: { name: 'custrecord_ftebr_city_i_ibge_code' }
                },
                NAME_FORMULAS: {
                    NAME: "LTRIM(RTRIM(SUBSTR({name}, 1, INSTR({name},'-') - 1)))",
                    UF: "LTRIM(RTRIM(SUBSTR({name}, INSTR({name}, '-') + 1, 4)))"
                }
            },

            TAX_REGIME_LOOKUP: {
                RECORD_TYPE: 'customrecord_fte_taxregime',
                FIELDS: {
                    internalId: { name: 'internalid' },
                    name: { name: 'name' }
                },
                LABELS: {
                    SIMPLES: 'Optante pelo Simples Nacional',
                    LUCRO_PRESUMIDO: 'Lucro Presumido',
                    LUCRO_REAL: 'Lucro Real'
                }
            }
        },

        VENDOR: {
            TYPE: 'vendor',
            FIELDS: {
                internalId: { name: 'internalid' },
                cnpj: { name: 'custentity_brl_entity_t_fed_tax_reg' },
                international: { name: 'custentity_brl_entity_t_int_tax_reg' }
            }
        },

        VALIDATION_SETTINGS: {
            TYPE: 'customrecord_pd_petr_validation_settings',
            FIELDS: {
                internalId: { name: 'internalid' },
                enableDupCnpj: { name: 'custrecord_pd_petr_vs_enable_dup_cnpj_cb', isCheckbox: true },
                enableDupIntl: { name: 'custrecord_pd_petr_vs_enable_dup_intl_cb', isCheckbox: true },
                enableAutoLookup: { name: 'custrecord_pd_petr_vs_enable_lookup_cb', isCheckbox: true },
                enableCnpjButton: { name: 'custrecord_pd_petr_vs_enable_cnpj_btn_cb', isCheckbox: true },
                enableStateRegLookup: { name: 'custrecord_pd_petr_vs_hub_state_reg_cb', isCheckbox: true },
                enableCpfLookup: { name: 'custrecord_pd_petr_vs_hub_cpf_lookup_cb', isCheckbox: true },
                enableAutoBirthDate: { name: 'custrecord_pd_petr_vs_hub_auto_birth_cb', isCheckbox: true },
                autoBirthDateAckAt: { name: 'custrecord_pd_petr_vs_hub_ack_at_dh' },
                autoBirthDateAckBy: { name: 'custrecord_pd_petr_vs_hub_ack_by_ls', isSelect: true },
                reportEmail: { name: 'custrecord_pd_petr_vs_report_email_cb', isCheckbox: true },
                reportFrequency: { name: 'custrecord_pd_petr_vs_report_freq_ls', isSelect: true },
                reportLastSent: { name: 'custrecord_pd_petr_vs_report_last_dt' },
                emailSender: { name: 'custrecord_pd_petr_vs_email_sender_ls', isSelect: true },
                emailRecipients: { name: 'custrecord_pd_petr_vs_email_recipient_ms', isMultiSelect: true },
                updateTradeName: { name: 'custrecord_pd_petr_vs_upd_trade_name_cb', isCheckbox: true },
                updateCompanyName: { name: 'custrecord_pd_petr_vs_upd_legal_name_cb', isCheckbox: true },
                updatePhone: { name: 'custrecord_pd_petr_vs_upd_phone_cb', isCheckbox: true },
                updateEmail: { name: 'custrecord_pd_petr_vs_upd_email_cb', isCheckbox: true },
                updateTaxRegime: { name: 'custrecord_pd_petr_vs_upd_tax_regime_cb', isCheckbox: true },
                updateAddress: { name: 'custrecord_pd_petr_vs_upd_address_cb', isCheckbox: true },
                updateAll: { name: 'custrecord_pd_petr_vs_upd_all_cb', isCheckbox: true },
                enableDirectdFullButton: { name: 'custrecord_pd_petr_vs_dd_full_btn_cb', isCheckbox: true },
                enableDirectdPlusButton: { name: 'custrecord_pd_petr_vs_dd_plus_btn_cb', isCheckbox: true },
                enableDirectdBasicButton: { name: 'custrecord_pd_petr_vs_dd_basic_btn_cb', isCheckbox: true },
                enableDirectdStateRegButton: { name: 'custrecord_pd_petr_vs_dd_ie_btn_cb', isCheckbox: true },
                rwsInChain: { name: 'custrecord_pd_petr_vs_rws_in_chain_cb', isCheckbox: true },
                hubInChain: { name: 'custrecord_pd_petr_vs_hub_in_chain_cb', isCheckbox: true },
                directdInChain: { name: 'custrecord_pd_petr_vs_dd_in_chain_cb', isCheckbox: true },
                directdChainMode: { name: 'custrecord_pd_petr_vs_dd_chain_mode_ls', isSelect: true }
            },
            PRIVATE_FIELD_KEYS: [
                'internalId',
                'autoBirthDateAckAt',
                'autoBirthDateAckBy',
                'reportEmail',
                'reportFrequency',
                'reportLastSent',
                'emailSender',
                'emailRecipients'
            ]
        },

        DATA_LOOKUP: {
            ACTIONS: {
                GET_VALIDATION_SETTINGS: 'getValidationSettings',
                FIND_CITY: 'findCity',
                FIND_TAX_REGIME: 'findTaxRegime',
                FIND_DUPLICATE: 'findDuplicate'
            },
            DUPLICATE_FIELD_KEYS: ['cnpj', 'international']
        },

        API_SETTINGS: {
            TYPE: 'customrecord_pd_petr_api_settings',
            FIELDS: {
                internalId: { name: 'internalid' },
                rwsEnabled: { name: 'custrecord_pd_petr_as_rws_enabled_cb', isCheckbox: true },
                rwsToken: { name: 'custrecord_pd_petr_as_rws_token_ds' },
                rwsRateLimit: { name: 'custrecord_pd_petr_as_rws_rate_limit_nu' },
                hubEnabled: { name: 'custrecord_pd_petr_as_hub_enabled_cb', isCheckbox: true },
                hubToken: { name: 'custrecord_pd_petr_as_hub_token_ds' },
                hubMonthlyCredits: { name: 'custrecord_pd_petr_as_hub_credits_nu' },
                hubRenewalDay: { name: 'custrecord_pd_petr_as_hub_renewal_day_nu' },
                hubLoadedCredits: { name: 'custrecord_pd_petr_as_hub_avail_nu' },
                hubBalance: { name: 'custrecord_pd_petr_as_hub_balance_nu', excludeFromSearch: true },
                hubCountStart: { name: 'custrecord_pd_petr_as_hub_start_dt' },
                hubValidTo: { name: 'custrecord_pd_petr_as_hub_valid_to_dt' },
                ddEnabled: { name: 'custrecord_pd_petr_as_dd_enabled_cb', isCheckbox: true },
                ddToken: { name: 'custrecord_pd_petr_as_dd_token_ds' },
                ddPricePlus: { name: 'custrecord_pd_petr_as_dd_prc_plus_cr' },
                ddPriceBasic: { name: 'custrecord_pd_petr_as_dd_prc_basic_cr' },
                ddPriceSintegra: { name: 'custrecord_pd_petr_as_dd_prc_sint_cr' },
                ddPriceFederalRevenue: { name: 'custrecord_pd_petr_as_dd_prc_rfb_cr' },
                ddLoadedCredits: { name: 'custrecord_pd_petr_as_dd_avail_cr' },
                ddBalance: { name: 'custrecord_pd_petr_as_dd_balance_cr', excludeFromSearch: true },
                ddCountStart: { name: 'custrecord_pd_petr_as_dd_start_dt' }
            }
        },

        CREDIT_USAGE: {
            TYPE: 'customrecord_pd_petr_credit_usage',
            PROVIDER_LIST: 'customlist_pd_petr_api_provider',
            FIELDS: {
                internalId: { name: 'internalid' },
                created: { name: 'created' },
                provider: { name: 'custrecord_pd_petr_cu_provider_ls', isSelect: true },
                queryType: { name: 'custrecord_pd_petr_cu_query_type_ds' },
                document: { name: 'custrecord_pd_petr_cu_document_ds' },
                credits: { name: 'custrecord_pd_petr_cu_credits_nu' },
                cost: { name: 'custrecord_pd_petr_cu_cost_cr' },
                queryUid: { name: 'custrecord_pd_petr_cu_query_uid_ds' },
                user: { name: 'custrecord_pd_petr_cu_user_ls', isSelect: true },
                apiResponse: { name: 'custrecord_pd_petr_cu_api_response_lt' },
                hubBalance: { name: 'custrecord_pd_petr_cu_hub_balance_nu' },
                directdBalance: { name: 'custrecord_pd_petr_cu_dd_balance_cr' }
            },
            PROVIDERS: {
                HUB: { label: 'Hub do Desenvolvedor' },
                DIRECTD: { label: 'DirectD' }
            },
            QUERY_TYPES: {
                CNPJ: 'CNPJ',
                CNPJ_WITH_STATE_REGISTRATION: 'CNPJ + Inscrição Estadual',
                CPF_HUB_DATABASE: 'CPF (base Hub)',
                CPF_FEDERAL_REVENUE: 'CPF (Receita Federal)',
                BIRTH_DATE: 'Data de Nascimento (nome_cpf)',
                CPF_DATABASE_CHECK: 'Verificação de base do CPF',
                DIRECTD_PLUS: 'CNPJ Plus',
                DIRECTD_BASIC: 'CNPJ Básico',
                DIRECTD_SINTEGRA: 'Sintegra',
                DIRECTD_FEDERAL_REVENUE: 'Receita Federal PJ'
            },
            HUB_EXPECTED_CREDITS: {
                CNPJ: 1,
                CPF_HUB_DATABASE: 1,
                CPF_FEDERAL_REVENUE: 5,
                BIRTH_DATE: 10
            }
        },

        REPORT_FREQUENCY: {
            DAILY: 'Diário',
            WEEKLY: 'Semanal',
            MONTHLY: 'Mensal'
        },

        SCRIPTS: {
            CLIENT_SCRIPT_PATH: '../client/pd-petr-entity-tax-registration.cl.js',
            BRAZIL_COUNTRY_PARAM: 'custscript_pd_petr_brasil_country',
            RESTLET: {
                SCRIPT_ID: 'customscript_pd_petr_tax_reg_rl',
                DEPLOY_ID: 'customdeploy_pd_petr_tax_reg_rl'
            },
            DATA_LOOKUP_SUITELET: {
                SCRIPT_ID: 'customscript_pd_petr_data_lookup_sl',
                DEPLOY_ID: 'customdeploy_pd_petr_data_lookup_sl'
            },
            PANEL_RESTLET: {
                SCRIPT_ID: 'customscript_pd_petr_tax_reg_panel_rl',
                DEPLOY_ID: 'customdeploy_pd_petr_tax_reg_panel_rl'
            }
        },

        PANEL: {
            TITLE: 'Cadastro Fiscal — Painel',
            HOME_URL: '/app/center/card.nl',
            ACTIONS: {
                SETTINGS: 'settings',
                CREDIT_USAGE: 'creditUsage',
                ENTITIES: 'entities',
                SET_COUNTRY: 'setCountry'
            },
            CREDIT_USAGE_PAGE_SIZE: 100,
            ENTITIES_PAGE_SIZE: 50,
            BILLING_ADDRESS_JOIN: 'billingAddress',
            MAX_PAGE_SIZE: 1000,
            STATICS: {
                HTML: 'pd-petr-tax-registration-panel.html',
                CSS: 'pd-petr-tax-registration-panel.css',
                JS: 'pd-petr-tax-registration-panel-ui.js'
            },
            MODE_LABELS: {
                DEFAULT: 'Hierarquia padrão (ReceitaWS → Hub → DirectD)',
                DD_FULL: 'DirectD — Consulta Completa',
                DD_PLUS: 'DirectD — CNPJ Plus',
                DD_BASIC: 'DirectD — CNPJ Básico',
                DD_IE: 'DirectD — Inscrição Estadual'
            },
            DIRECTD_MODE_SETTINGS: {
                DD_FULL: 'enableDirectdFullButton',
                DD_PLUS: 'enableDirectdPlusButton',
                DD_BASIC: 'enableDirectdBasicButton',
                DD_IE: 'enableDirectdStateRegButton'
            }
        },

        BUTTON: {
            ID: 'custpage_pd_petr_fetch_cnpj_bt',
            LABEL: 'Consultar CNPJ',
            LABEL_WITH_CPF: 'Consultar CPF/CNPJ',
            FUNCTION: 'fetchCNPJ'
        },

        DIRECTD_BUTTONS: [
            { ID: 'custpage_pd_petr_dd_full_bt', LABEL: 'Consulta Completa', FUNCTION: 'fetchDirectdFull', SETTING: 'enableDirectdFullButton' },
            { ID: 'custpage_pd_petr_dd_plus_bt', LABEL: 'Consultar CNPJ Plus', FUNCTION: 'fetchDirectdPlus', SETTING: 'enableDirectdPlusButton' },
            { ID: 'custpage_pd_petr_dd_basic_bt', LABEL: 'Consultar CNPJ Básico', FUNCTION: 'fetchDirectdBasic', SETTING: 'enableDirectdBasicButton' },
            { ID: 'custpage_pd_petr_dd_ie_bt', LABEL: 'Consultar Inscrição Estadual', FUNCTION: 'fetchDirectdStateReg', SETTING: 'enableDirectdStateRegButton' }
        ]

    };
});

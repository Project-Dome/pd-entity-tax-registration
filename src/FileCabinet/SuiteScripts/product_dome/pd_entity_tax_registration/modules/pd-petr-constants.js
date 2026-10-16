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
 */
define([], function () {

    return {

        API: {
            CEP_BASE_URL: 'https://brasilapi.com.br/api/cep/v2/',
            RECEITAWS_BASE_URL: 'https://receitaws.com.br/v1/cnpj/',
            HUB_CNPJ_BASE_URL: 'https://ws.hubdodesenvolvedor.com.br/v2/cnpj/',
            HUB_CPF_BASE_URL: 'https://ws.hubdodesenvolvedor.com.br/v2/cpf/',
            HUB_NAME_CPF_BASE_URL: 'https://ws.hubdodesenvolvedor.com.br/v2/nome_cpf/'
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
                birthDate: { name: 'custentity_pd_petr_birth_date_dt' }
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
                updateAll: { name: 'custrecord_pd_petr_vs_upd_all_cb', isCheckbox: true }
            }
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
                hubRenewalDay: { name: 'custrecord_pd_petr_as_hub_renewal_day_nu' }
            }
        },

        HUB_CREDIT_USAGE: {
            TYPE: 'customrecord_pd_petr_hub_credit_usage',
            FIELDS: {
                internalId: { name: 'internalid' },
                created: { name: 'created' },
                queryType: { name: 'custrecord_pd_petr_hcu_query_type_ds' },
                document: { name: 'custrecord_pd_petr_hcu_document_ds' },
                credits: { name: 'custrecord_pd_petr_hcu_credits_nu' },
                user: { name: 'custrecord_pd_petr_hcu_user_ls', isSelect: true }
            },
            QUERY_TYPES: {
                CNPJ: 'CNPJ',
                CNPJ_WITH_STATE_REGISTRATION: 'CNPJ + Inscrição Estadual',
                CPF_HUB_DATABASE: 'CPF (base Hub)',
                CPF_FEDERAL_REVENUE: 'CPF (Receita Federal)',
                BIRTH_DATE: 'Data de Nascimento (nome_cpf)',
                CPF_DATABASE_CHECK: 'Verificação de base do CPF'
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
            }
        },

        BUTTON: {
            ID: 'custpage_pd_petr_fetch_cnpj_bt',
            LABEL: 'Consultar CNPJ',
            LABEL_WITH_CPF: 'Consultar CPF/CNPJ',
            FUNCTION: 'fetchCNPJ'
        }

    };
});

/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define([], function () {

    return {

        API: {
            CNPJ_BASE_URL: 'https://brasilapi.com.br/api/cnpj/v1/',
            CEP_BASE_URL: 'https://brasilapi.com.br/api/cep/v2/'
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
                tradeName: { name: 'companyname' },
                phone: { name: 'phone' },
                altPhone: { name: 'altphone' },
                fax: { name: 'fax' },
                email: { name: 'email' },
                taxRegime: { name: 'custentity_fte_entity_l_taxregime' }
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
                updateTradeName: { name: 'custrecord_pd_petr_vs_upd_trade_name_cb', isCheckbox: true },
                updateCompanyName: { name: 'custrecord_pd_petr_vs_upd_legal_name_cb', isCheckbox: true },
                updatePhone: { name: 'custrecord_pd_petr_vs_upd_phone_cb', isCheckbox: true },
                updateAltPhone: { name: 'custrecord_pd_petr_vs_upd_alt_phone_cb', isCheckbox: true },
                updateFax: { name: 'custrecord_pd_petr_vs_upd_fax_cb', isCheckbox: true },
                updateEmail: { name: 'custrecord_pd_petr_vs_upd_email_cb', isCheckbox: true },
                updateTaxRegime: { name: 'custrecord_pd_petr_vs_upd_tax_regime_cb', isCheckbox: true },
                updateAddress: { name: 'custrecord_pd_petr_vs_upd_address_cb', isCheckbox: true },
                updateAll: { name: 'custrecord_pd_petr_vs_upd_all_cb', isCheckbox: true }
            }
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
            FUNCTION: 'fetchCNPJ'
        }

    };
});

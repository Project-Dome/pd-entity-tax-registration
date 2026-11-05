/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Ações atendidas pelo Suitelet anônimo de busca (pd-petr-data-lookup.sl.js). Roda como
 * Administrador, para que usuários sem acesso a customrecord_ftebr_city,
 * customrecord_fte_taxregime, Configuração das Validações, Customer ou Vendor consigam usar o
 * "Consultar CNPJ" e as validações de duplicidade.
 *
 * O Suitelet é público (sem login), então cada ação devolve só o mínimo necessário:
 * - GET_VALIDATION_SETTINGS: flags da configuração, sem VALIDATION_SETTINGS.PRIVATE_FIELD_KEYS.
 * - FIND_CITY / FIND_TAX_REGIME: só o internal id.
 * - FIND_DUPLICATE: só { internalId } do registro encontrado, e apenas para os campos de
 *   DATA_LOOKUP.DUPLICATE_FIELD_KEYS.
 * Nunca exponha aqui a Configuração das APIs (tokens da ReceitaWS e da Hub).
 *
 * params chega da query string do GET, então todo valor é string (ibgeCode é convertido com
 * Number() em pd-petr-city.js).
 */
define(
    [
        'N/error',
        '../modules/pd-petr-constants',
        './pd-petr-validation-settings',
        './pd-petr-city',
        './pd-petr-tax-regime',
        './pd-petr-customer',
        './pd-petr-vendor'
    ],
    function (
        error,
        constantsModule,
        validationSettingsService,
        cityService,
        taxRegimeService,
        customerService,
        vendorService
    ) {
        var ACTIONS = constantsModule.DATA_LOOKUP.ACTIONS;
        var DUPLICATE_FIELD_KEYS = constantsModule.DATA_LOOKUP.DUPLICATE_FIELD_KEYS;
        var FIELDS = constantsModule.ENTITY.FIELDS;
        var VENDOR_TYPE = constantsModule.VENDOR.TYPE;

        function handle(action, params) {
            switch (action) {
                case ACTIONS.GET_VALIDATION_SETTINGS:
                    return validationSettingsService.findStoredPublicSettings();
                case ACTIONS.FIND_CITY:
                    return cityService.resolveId({ ibgeCode: params.ibgeCode, name: params.name, uf: params.uf });
                case ACTIONS.FIND_TAX_REGIME:
                    return taxRegimeService.findIdByLabel(params.label);
                case ACTIONS.FIND_DUPLICATE:
                    return findDuplicate(params);
                default:
                    throw error.create({
                        name: 'PETR_UNKNOWN_LOOKUP_ACTION',
                        message: 'Ação de busca desconhecida: ' + action
                    });
            }
        }

        function findDuplicate(params) {
            if (DUPLICATE_FIELD_KEYS.indexOf(params.fieldKey) === -1) {
                throw error.create({
                    name: 'PETR_INVALID_LOOKUP_FIELD',
                    message: 'Campo não permitido na busca de duplicidade: ' + params.fieldKey
                });
            }

            if (!params.value) return null;

            var isVendor = params.recordType === VENDOR_TYPE;
            var isCnpj = params.fieldKey === 'cnpj';

            var match = isVendor
                ? (isCnpj ? vendorService.getByCnpjOrCpf(params.value) : vendorService.getByInternational(params.value))
                : customerService.getByField(FIELDS[params.fieldKey].name, params.value);

            return match ? { internalId: match.internalId } : null;
        }

        return {
            handle: handle
        };
    }
);

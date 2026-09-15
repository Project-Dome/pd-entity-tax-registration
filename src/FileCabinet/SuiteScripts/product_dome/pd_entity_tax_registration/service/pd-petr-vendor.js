/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        '../modules/pd-petr-constants',
        '../util/pd-petr-search-data'
    ],
    function (
        constantsModule,
        searchDataUtil
    ) {
        var TYPE = constantsModule.VENDOR.TYPE;
        var FIELDS = constantsModule.VENDOR.FIELDS;

        function getByCnpjOrCpf(federalRegistration) {
            return searchByField(FIELDS.cnpj.name, federalRegistration);
        }

        function getByInternational(international) {
            return searchByField(FIELDS.international.name, international);
        }

        function searchByField(fieldName, value) {
            if (!value) return null;

            var result = searchDataUtil.first({
                type: TYPE,
                fields: FIELDS,
                filters: [[fieldName, 'is', value]]
            });

            log.audit('pd-petr-vendor.searchByField', { fieldName: fieldName, value: value, found: !!result });

            return result;
        }

        return {
            getByCnpjOrCpf: getByCnpjOrCpf,
            getByInternational: getByInternational
        };
    }
);

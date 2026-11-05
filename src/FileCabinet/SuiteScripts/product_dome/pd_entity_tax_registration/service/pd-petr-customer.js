/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Busca direta de Customer/Job (record "entity" filtrado por CustJob) — só deve rodar dentro
 * do Suitelet de busca (pd-petr-data-lookup.sl.js). Os demais scripts usam
 * pd-petr-data-lookup-gateway.
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
        var ENTITY = constantsModule.ENTITY;

        function getByField(fieldName, value) {
            if (!value) return null;

            return searchDataUtil.first({
                type: ENTITY.TYPE,
                fields: { internalId: ENTITY.FIELDS.internalId },
                filters: [
                    [ENTITY.FIELDS.type.name, 'anyof', [ENTITY.TYPE_LIST.CUSTOMER_AND_JOB]],
                    'AND',
                    [fieldName, 'is', value]
                ]
            });
        }

        return {
            getByField: getByField
        };
    }
);

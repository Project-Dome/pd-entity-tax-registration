/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Busca direta em customrecord_fte_taxregime — só deve rodar dentro do Suitelet de busca
 * (pd-petr-data-lookup.sl.js). Os demais scripts usam pd-petr-data-lookup-gateway.
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
        var TAX_REGIME_LOOKUP = constantsModule.ENTITY.TAX_REGIME_LOOKUP;

        function findIdByLabel(label) {
            if (!label) return null;

            var result = searchDataUtil.first({
                type: TAX_REGIME_LOOKUP.RECORD_TYPE,
                fields: TAX_REGIME_LOOKUP.FIELDS,
                filters: [[TAX_REGIME_LOOKUP.FIELDS.name.name, 'is', label]]
            });

            if (!result) {
                log.debug('pd-petr-tax-regime.findIdByLabel', 'No ' + TAX_REGIME_LOOKUP.RECORD_TYPE + ' match for label "' + label + '"');
                return null;
            }

            return result.internalId;
        }

        return {
            findIdByLabel: findIdByLabel
        };
    }
);

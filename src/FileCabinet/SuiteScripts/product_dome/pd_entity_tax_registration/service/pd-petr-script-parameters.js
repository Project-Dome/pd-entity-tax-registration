/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Lucas Monaco
 */
define(
    [
        'N/runtime',
        '../modules/pd-petr-constants'
    ],
    function (
        runtime,
        constantsModule
    ) {

        function getCountryBrazil() {
            return runtime.getCurrentScript().getParameter({
                name: constantsModule.SCRIPTS.BRAZIL_COUNTRY_PARAM
            });
        }

        return {
            getCountryBrazil: getCountryBrazil
        };
    }
);

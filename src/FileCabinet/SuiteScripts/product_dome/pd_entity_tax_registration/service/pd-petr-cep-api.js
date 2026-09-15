/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Vinicius Betim
 */
define(
    [
        'N/https',
        '../modules/pd-petr-constants'
    ],
    function (
        https,
        constantsModule
    ) {

        function get(cep) {
            try {
                var digits = cep.replace(/\D/g, '');
                var response = https.get({
                    url: constantsModule.API.CEP_BASE_URL + digits,
                    headers: { 'Accept': 'application/json' }
                });

                log.debug('pd-petr-cep-api.get | status', response.code);
                log.debug('pd-petr-cep-api.get | body',   response.body);

                if (response.code !== 200) {
                    log.error('pd-petr-cep-api.get', 'HTTP ' + response.code + ' for CEP ' + digits);
                    return null;
                }

                return JSON.parse(response.body);
            } catch (e) {
                log.error('pd-petr-cep-api.get', e);
                return null;
            }
        }

        return { get: get };
    }
);

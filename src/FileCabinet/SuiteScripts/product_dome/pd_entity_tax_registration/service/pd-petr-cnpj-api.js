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

        function get(cnpj) {
            try {
                var digits = String(cnpj).toUpperCase().replace(/[^0-9A-Z]/g, '');
                var url = constantsModule.API.CNPJ_BASE_URL + digits;

                log.debug('pd-petr-cnpj-api.get | request', url);

                var response = https.get({
                    url: url,
                    headers: { 'Accept': 'application/json' }
                });

                log.debug('pd-petr-cnpj-api.get | status', response.code);
                log.debug('pd-petr-cnpj-api.get | body',   response.body);

                return response;
            } catch (e) {
                log.error('pd-petr-cnpj-api.get', e);
                throw e;
            }
        }

        return { get: get };
    }
);

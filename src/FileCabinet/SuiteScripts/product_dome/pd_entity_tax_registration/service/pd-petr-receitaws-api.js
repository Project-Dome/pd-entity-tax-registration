/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
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

        // O token é OPCIONAL: este endpoint é a API Pública (gratuita) do ReceitaWS, sem
        // autenticação, limitada a poucas consultas/minuto (configurável em
        // custrecord_pd_petr_as_rws_rate_limit_nu). Confirmado empiricamente (resposta traz
        // "billing": { "free": true }) que a chamada funciona sem qualquer header de
        // Authorization. O token só existe para quando/se o plano Comercial do ReceitaWS for
        // contratado (mesma URL, throughput maior) — nesse caso lembrar de também aumentar o
        // limite de consultas/minuto do registro de configuração, senão o rate limiter local
        // continua limitando a 3/min mesmo com um plano pago de até 2000/min.
        function get(cnpj, options) {
            try {
                var digits = String(cnpj).replace(/\D/g, '');
                var url = constantsModule.API.RECEITAWS_BASE_URL + digits;

                log.debug('pd-petr-receitaws-api.get | request', url);

                var headers = { 'Accept': 'application/json' };

                if (options.token) {
                    headers['Authorization'] = 'Bearer ' + options.token;
                }

                var response = https.get({
                    url: url,
                    headers: headers
                });

                log.debug('pd-petr-receitaws-api.get | status', response.code);
                log.debug('pd-petr-receitaws-api.get | body',   response.body);

                return response;
            } catch (e) {
                log.error('pd-petr-receitaws-api.get', e);
                throw e;
            }
        }

        return { get: get };
    }
);

/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Token OPCIONAL: o endpoint é a API Pública (gratuita) do ReceitaWS, sem autenticação,
 * limitada a poucas consultas/minuto (custrecord_pd_petr_as_rws_rate_limit_nu). O token só
 * serve para o plano Comercial (mesma URL, throughput maior) — nesse caso, aumentar também o
 * limite de consultas/minuto do registro de configuração, senão o rate limiter local
 * continua limitando a 3/min.
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

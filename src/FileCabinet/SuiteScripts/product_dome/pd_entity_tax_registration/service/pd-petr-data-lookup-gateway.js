/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Ponto único de chamada ao Suitelet anônimo de busca (pd-petr-data-lookup.sl.js), pela URL
 * externa. Carregável no cliente e no servidor (só N/https e N/url): Client Script, RESTlet e
 * User Event rodam com o papel de quem está logado, e esse papel pode não ter acesso aos
 * registros consultados — o Suitelet roda como Administrador.
 *
 * request() nunca lança: devolve { success, data } ou { success: false, error }. Cada chamador
 * decide o fallback (em geral, tratar como "não encontrado").
 *
 * Só leitura, por isso GET: action e params vão na query string (url.resolveScript faz o
 * encode). Parâmetros vazios/undefined são omitidos para não chegarem como a string
 * "undefined" no Suitelet.
 */
define(
    [
        'N/https',
        'N/url',
        '../modules/pd-petr-constants'
    ],
    function (
        https,
        url,
        constantsModule
    ) {
        var SUITELET = constantsModule.SCRIPTS.DATA_LOOKUP_SUITELET;

        function buildSuiteletUrl(action, params) {
            var queryParams = { action: action };

            Object.keys(params || {}).forEach(function (key) {
                var value = params[key];
                if (value !== undefined && value !== null && value !== '') queryParams[key] = value;
            });

            return url.resolveScript({
                scriptId: SUITELET.SCRIPT_ID,
                deploymentId: SUITELET.DEPLOY_ID,
                returnExternalUrl: true,
                params: queryParams
            });
        }

        function request(action, params) {
            try {
                var response = https.get({
                    url: buildSuiteletUrl(action, params),
                    headers: { 'Accept': 'application/json' }
                });

                if (response.code !== 200) {
                    log.error({
                        title: 'pd-petr-data-lookup-gateway.request',
                        details: { action: action, code: response.code, body: response.body }
                    });
                    return { success: false, error: 'O serviço de busca respondeu com o código ' + response.code + '.' };
                }

                var result = JSON.parse(response.body);

                if (!result.success) {
                    log.error({
                        title: 'pd-petr-data-lookup-gateway.request',
                        details: { action: action, error: result.error }
                    });
                }

                return result;
            } catch (e) {
                log.error({
                    title: 'pd-petr-data-lookup-gateway.request',
                    details: { action: action, stack: e.stack, message: e.message }
                });
                return { success: false, error: e.message };
            }
        }

        function requestData(action, params) {
            var result = request(action, params);
            return result.success ? result.data : null;
        }

        return {
            request: request,
            requestData: requestData
        };
    }
);

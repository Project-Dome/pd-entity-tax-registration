/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Chamadas HTTP cruas às APIs da DirectD (docs/specs/directd-integration.md, §4.1 e §6.1). Só
 * monta a requisição e devolve a resposta do N/https — o parse e a regra de negócio ficam em
 * pd-petr-directd-lookup.js. Exceção do N/https (timeout, rede) é registrada e relançada.
 *
 * - Todas as chamadas são GET em apiv3.directd.com.br/api/{Endpoint}, autenticadas pelo header
 *   Authorization: Bearer {token}. O token nunca vai na URL nem no log.
 * - Resposta: { metaDados: { consultaUid, resultado, resultadoId, mensagem, ... }, retorno }.
 *   HTTP 401 = token inválido ou IP do NetSuite não liberado no painel da DirectD.
 * - getFederalRevenue chama a Receita Federal PJ sem Qsa e sem GERARCOMPROVANTE.
 * - getSintegra exige a UF; o CNPJ vai no parâmetro "Cnpj" (Cpf e ie ficam vazios).
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
        var BASE_URL = constantsModule.API.DIRECTD_BASE_URL;
        var ENDPOINTS = constantsModule.DIRECTD.ENDPOINTS;

        function request(logTitle, endpoint, params, token) {
            var query = Object.keys(params)
                .filter(function (key) { return params[key] !== undefined && params[key] !== null && params[key] !== ''; })
                .map(function (key) { return key + '=' + encodeURIComponent(params[key]); })
                .join('&');

            var requestUrl = BASE_URL + endpoint + '?' + query;

            try {
                log.debug(logTitle + ' | request', requestUrl);

                var response = https.get({
                    url: requestUrl,
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': 'Bearer ' + (token || '')
                    }
                });

                log.debug(logTitle + ' | status', response.code);
                log.debug(logTitle + ' | body', response.body);

                return response;
            } catch (e) {
                log.error(logTitle, e);
                throw e;
            }
        }

        function digitsOnly(value) {
            return String(value).toUpperCase().replace(/[^0-9A-Z]/g, '');
        }

        function getCompanyPlus(cnpj, options) {
            return request('pd-petr-directd-api.getCompanyPlus', ENDPOINTS.PLUS, { CNPJ: digitsOnly(cnpj) }, options.token);
        }

        function getCompanyBasic(cnpj, options) {
            return request('pd-petr-directd-api.getCompanyBasic', ENDPOINTS.BASIC, { CNPJ: digitsOnly(cnpj) }, options.token);
        }

        function getFederalRevenue(cnpj, options) {
            return request('pd-petr-directd-api.getFederalRevenue', ENDPOINTS.FEDERAL_REVENUE, { Cnpj: digitsOnly(cnpj) }, options.token);
        }

        function getSintegra(cnpj, uf, options) {
            return request('pd-petr-directd-api.getSintegra', ENDPOINTS.SINTEGRA, {
                Cnpj: digitsOnly(cnpj),
                Uf: String(uf || '').toUpperCase()
            }, options.token);
        }

        return {
            getCompanyPlus: getCompanyPlus,
            getCompanyBasic: getCompanyBasic,
            getFederalRevenue: getFederalRevenue,
            getSintegra: getSintegra
        };
    }
);

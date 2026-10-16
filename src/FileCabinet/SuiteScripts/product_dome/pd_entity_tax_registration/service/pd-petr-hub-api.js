/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Token OBRIGATÓRIO: cada consulta consome saldo da conta contratada na Hub. Sem token ou sem
 * saldo, a Hub responde HTTP 200 com { "status": false, "return": "NOK", "message": ... } —
 * quem chama precisa olhar o "status" do corpo, não só o HTTP code.
 *
 * - get (v2/cnpj): ie=1 inclui as Inscrições Estaduais na mesma consulta, sem créditos
 *   adicionais (conferido no saldo da Hub) — só é enviado quando options.includeStateRegistration
 *   é true.
 * - getCpfLastUpdate (v2/cpf, last_update=2): não consome créditos; status true indica que o
 *   CPF está na base própria da Hub. Fora da base, volta status false / NOK sem "consumed".
 * - getCpf (v2/cpf): só com o CPF, consulta a base da Hub (1 crédito). Com options.birthDate
 *   (DD/MM/AAAA, parâmetro "data"), consulta na Receita Federal (5 créditos). Do lado da Hub a
 *   consulta on-line pode levar até 10 minutos, bem acima do limite do N/https — uma Receita
 *   lenta aparece aqui como exceção de timeout.
 * - getNameAndBirthDate (v2/nome_cpf): nome e data de nascimento em base de terceiros, só com o
 *   CPF (10 créditos).
 *
 * O token vai na query string: request() grava no log a URL sem ele.
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
        var API = constantsModule.API;

        function request(logTitle, baseUrl, params, token) {
            var query = Object.keys(params)
                .filter(function (key) { return params[key] !== undefined && params[key] !== null && params[key] !== ''; })
                .map(function (key) { return key + '=' + encodeURIComponent(params[key]); })
                .join('&');

            var publicUrl = baseUrl + '?' + query;

            try {
                log.debug(logTitle + ' | request', publicUrl);

                var response = https.get({
                    url: publicUrl + '&token=' + encodeURIComponent(token || ''),
                    headers: { 'Accept': 'application/json' }
                });

                log.debug(logTitle + ' | status', response.code);
                log.debug(logTitle + ' | body',   response.body);

                return response;
            } catch (e) {
                log.error(logTitle, e);
                throw e;
            }
        }

        function digitsOnly(value) {
            return String(value).replace(/\D/g, '');
        }

        function get(cnpj, options) {
            return request('pd-petr-hub-api.get', API.HUB_CNPJ_BASE_URL, {
                cnpj: digitsOnly(cnpj),
                ie: options.includeStateRegistration ? '1' : undefined
            }, options.token);
        }

        function getCpfLastUpdate(cpf, options) {
            return request('pd-petr-hub-api.getCpfLastUpdate', API.HUB_CPF_BASE_URL, {
                cpf: digitsOnly(cpf),
                last_update: '2'
            }, options.token);
        }

        function getCpf(cpf, options) {
            return request('pd-petr-hub-api.getCpf', API.HUB_CPF_BASE_URL, {
                cpf: digitsOnly(cpf),
                data: options.birthDate
            }, options.token);
        }

        function getNameAndBirthDate(cpf, options) {
            return request('pd-petr-hub-api.getNameAndBirthDate', API.HUB_NAME_CPF_BASE_URL, {
                cpf: digitsOnly(cpf)
            }, options.token);
        }

        return {
            get: get,
            getCpfLastUpdate: getCpfLastUpdate,
            getCpf: getCpf,
            getNameAndBirthDate: getNameAndBirthDate
        };
    }
);

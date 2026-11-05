/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Suitelet anônimo (Available Without Login, executa como Administrador) que faz as buscas de
 * dados em nome de usuários cujo papel não tem acesso aos registros consultados. Só leitura,
 * por isso só GET: chamado via pd-petr-data-lookup-gateway com ?action=...&{params} na query
 * string; responde sempre JSON { success, data } ou { success: false, error }. As ações
 * aceitas e o que cada uma devolve estão em pd-petr-data-lookup.js.
 *
 * request.parameters também traz os parâmetros que o NetSuite injeta na URL externa (script,
 * deploy, compid, ns-at, h) — o dispatcher só lê as chaves de cada ação, então eles são
 * ignorados.
 */
define(
    [
        '../service/pd-petr-data-lookup'
    ],
    function (
        dataLookupService
    ) {

        function onRequest(context) {
            var response = context.response;
            response.setHeader({ name: 'Content-Type', value: 'application/json' });

            if (context.request.method !== 'GET') {
                response.write(JSON.stringify({ success: false, error: 'Método não suportado.' }));
                return;
            }

            try {
                var parameters = context.request.parameters || {};
                var data = dataLookupService.handle(parameters.action, parameters);

                response.write(JSON.stringify({ success: true, data: data === undefined ? null : data }));
            } catch (e) {
                log.error('pd-petr-data-lookup.sl.onRequest', e);
                response.write(JSON.stringify({ success: false, error: e.message }));
            }
        }

        return {
            onRequest: onRequest
        };
    }
);

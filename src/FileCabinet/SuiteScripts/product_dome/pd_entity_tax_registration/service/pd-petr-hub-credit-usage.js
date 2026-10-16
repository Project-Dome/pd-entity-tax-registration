/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Registro de consumo de créditos da Hub do Desenvolvedor (customrecord_pd_petr_hub_credit_usage)
 * — uma linha por chamada que efetivamente cobrou créditos. SERVER-ONLY (N/record, N/runtime):
 * importado só por pd-petr-cnpj-lookup.js e pd-petr-credit-report.js, nunca pela cadeia do
 * Client Script.
 *
 * - track() recebe o corpo já parseado da resposta da Hub e usa o campo "consumed" como valor
 *   cobrado; sem "consumed" ou com zero (last_update=2, erro de token/saldo) não grava nada.
 *   Nunca lança: falhar ao gravar o consumo não pode interromper a consulta.
 * - O usuário vem de runtime.getCurrentUser(); fica vazio quando não há usuário real (id <= 0,
 *   ex.: execuções agendadas).
 * - summarize() soma o consumo de um período (data de criação nativa do registro), agrupado por
 *   tipo de consulta — base do relatório de créditos.
 */
define(
    [
        'N/record',
        'N/runtime',
        'N/search',
        'N/format',
        '../modules/pd-petr-constants'
    ],
    function (
        record,
        runtime,
        search,
        format,
        constantsModule
    ) {
        var TYPE = constantsModule.HUB_CREDIT_USAGE.TYPE;
        var FIELDS = constantsModule.HUB_CREDIT_USAGE.FIELDS;

        function track(body, queryType, document) {
            try {
                var credits = Number(body && body.consumed) || 0;

                if (credits <= 0) return;

                var usage = record.create({ type: TYPE });

                usage.setValue({ fieldId: FIELDS.queryType.name, value: queryType });
                usage.setValue({ fieldId: FIELDS.document.name, value: String(document || '') });
                usage.setValue({ fieldId: FIELDS.credits.name, value: credits });

                var userId = runtime.getCurrentUser().id;
                if (userId > 0) {
                    usage.setValue({ fieldId: FIELDS.user.name, value: userId });
                }

                usage.save();

                log.debug('pd-petr-hub-credit-usage.track', queryType + ' | ' + document + ' | ' + credits + ' crédito(s)');
            } catch (e) {
                log.error({
                    title: 'pd-petr-hub-credit-usage.track',
                    details: { queryType: queryType, document: document, message: e.message, stack: e.stack }
                });
            }
        }

        function summarize(startDate, endDate) {
            var summary = { totalCredits: 0, totalQueries: 0, byQueryType: [] };

            search.create({
                type: TYPE,
                filters: [
                    [FIELDS.created.name, 'onorafter', format.format({ value: startDate, type: format.Type.DATE })],
                    'AND',
                    [FIELDS.created.name, 'before', format.format({ value: endDate, type: format.Type.DATE })]
                ],
                columns: [
                    search.createColumn({ name: FIELDS.queryType.name, summary: search.Summary.GROUP }),
                    search.createColumn({ name: FIELDS.internalId.name, summary: search.Summary.COUNT }),
                    search.createColumn({ name: FIELDS.credits.name, summary: search.Summary.SUM })
                ]
            }).run().each(function (result) {
                var queries = Number(result.getValue({ name: FIELDS.internalId.name, summary: search.Summary.COUNT })) || 0;
                var credits = Number(result.getValue({ name: FIELDS.credits.name, summary: search.Summary.SUM })) || 0;

                summary.byQueryType.push({
                    queryType: result.getValue({ name: FIELDS.queryType.name, summary: search.Summary.GROUP }),
                    queries: queries,
                    credits: credits
                });

                summary.totalQueries += queries;
                summary.totalCredits += credits;

                return true;
            });

            return summary;
        }

        return {
            track: track,
            summarize: summarize
        };
    }
);

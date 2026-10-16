/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Roda diariamente e envia o relatório de créditos da Hub quando a frequência configurada no
 * registro de Configuração das Validações vence. Toda a decisão fica em
 * pd-petr-credit-report.run — rodar todo dia é o que permite atender Diário, Semanal e Mensal
 * com um único agendamento.
 */
define(
    [
        '../service/pd-petr-credit-report'
    ],
    function (
        creditReportService
    ) {

        function execute() {
            try {
                creditReportService.run();
            } catch (e) {
                log.error({
                    title: 'pd-petr-credit-report.sc.execute',
                    details: { message: e.message, stack: e.stack }
                });
            }
        }

        return {
            execute: execute
        };
    }
);

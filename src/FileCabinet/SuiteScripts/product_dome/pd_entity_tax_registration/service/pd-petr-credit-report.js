/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Relatório de créditos da Hub do Desenvolvedor (docs/specs/hub-credit-control.md, §3.5 e §4.5).
 * SERVER-ONLY: chamado só pelo Scheduled Script pd-petr-credit-report.sc.js.
 *
 * - run() lê o registro de Configuração das Validações com busca própria (o get() de
 *   pd-petr-validation-settings descarta o internalid, necessário para gravar o último envio) e
 *   só envia com "Receber Relatório de Créditos" marcado, Remetente, ao menos um Destinatário e
 *   a frequência vencida em relação ao último envio. Após enviar, grava a data de hoje.
 * - A frequência é comparada pelo texto do valor da lista (REPORT_FREQUENCY em
 *   pd-petr-constants.js). "Último Envio" chega da busca como texto no formato de data da conta
 *   — convertido com N/format.parse.
 * - Ciclo do pacote: começa no "Dia de Renovação do Pacote" do mês corrente (ou do anterior, se o
 *   dia ainda não chegou) e termina na véspera da próxima renovação. Sem dia configurado, usa 1.
 * - Os destinatários são funcionários: email.send recebe os internal IDs e usa o e-mail do
 *   cadastro de cada um.
 * - O consumo vem do registro único customrecord_pd_petr_credit_usage, filtrado pelo provedor Hub
 *   (docs/specs/directd-integration.md §4.5).
 */
define(
    [
        'N/email',
        'N/record',
        'N/format',
        '../modules/pd-petr-constants',
        '../util/pd-petr-search-data',
        './pd-petr-api-settings',
        './pd-petr-credit-usage'
    ],
    function (
        email,
        record,
        format,
        constantsModule,
        searchDataUtil,
        apiSettingsService,
        creditUsageService
    ) {
        var SETTINGS = constantsModule.VALIDATION_SETTINGS;
        var FREQUENCY = constantsModule.REPORT_FREQUENCY;

        function run() {
            var settings = findValidationSettings();

            if (!settings) {
                log.audit('pd-petr-credit-report.run', 'Sem registro de Configuração das Validações ativo — relatório não enviado.');
                return;
            }

            if (!settings.reportEmail) {
                log.audit('pd-petr-credit-report.run', '"Receber Relatório de Créditos" desmarcado — relatório não enviado.');
                return;
            }

            var sender = settings.emailSender && settings.emailSender.value;
            var recipients = settings.emailRecipients || [];

            if (!sender || !recipients.length) {
                log.audit('pd-petr-credit-report.run', 'Remetente ou Destinatários não configurados — relatório não enviado.');
                return;
            }

            var frequency = settings.reportFrequency && settings.reportFrequency.text;
            var lastSent = parseDate(settings.reportLastSent);
            var today = startOfDay(new Date());

            if (!isDue(frequency, lastSent, today)) {
                log.audit('pd-petr-credit-report.run', 'Frequência "' + frequency + '" ainda não venceu (último envio: ' + settings.reportLastSent + ').');
                return;
            }

            var apiSettings = apiSettingsService.get() || {};
            var cycle = getCurrentCycle(today, Number(apiSettings.hubRenewalDay) || 1);
            var summary = creditUsageService.summarize(cycle.start, cycle.end, 'HUB');
            var monthlyCredits = Number(apiSettings.hubMonthlyCredits) || 0;

            email.send({
                author: Number(sender),
                recipients: recipients.map(Number),
                subject: 'Relatório de créditos da Hub do Desenvolvedor — ' + formatDate(today),
                body: buildBody(cycle, summary, monthlyCredits)
            });

            record.submitFields({
                type: SETTINGS.TYPE,
                id: settings.internalId,
                values: (function () {
                    var values = {};
                    values[SETTINGS.FIELDS.reportLastSent.name] = today;
                    return values;
                })()
            });

            log.audit('pd-petr-credit-report.run', 'Relatório enviado para ' + recipients.length + ' destinatário(s): '
                + summary.totalCredits + ' crédito(s) no ciclo ' + formatDate(cycle.start) + ' a ' + formatDate(lastDayOf(cycle)) + '.');
        }

        function findValidationSettings() {
            return searchDataUtil.first({
                type: SETTINGS.TYPE,
                fields: SETTINGS.FIELDS,
                filters: [['isinactive', 'is', 'F']]
            });
        }

        function isDue(frequency, lastSent, today) {
            if (!frequency) return false;
            if (!lastSent) return true;

            if (frequency === FREQUENCY.DAILY) return lastSent < today;
            if (frequency === FREQUENCY.WEEKLY) return daysBetween(lastSent, today) >= 7;
            if (frequency === FREQUENCY.MONTHLY) return addMonths(lastSent, 1) <= today;

            log.error('pd-petr-credit-report.isDue', 'Frequência não reconhecida: ' + frequency);
            return false;
        }

        function getCurrentCycle(today, renewalDay) {
            var day = Math.min(Math.max(renewalDay, 1), 28);
            var start = new Date(today.getFullYear(), today.getMonth(), day);

            if (today.getDate() < day) {
                start = new Date(today.getFullYear(), today.getMonth() - 1, day);
            }

            return { start: start, end: addMonths(start, 1) };
        }

        function buildBody(cycle, summary, monthlyCredits) {
            var used = summary.totalCredits;
            var rows = summary.byQueryType.map(function (item) {
                return '<tr><td>' + escapeHtml(item.queryType) + '</td>'
                    + '<td style="text-align:right">' + item.queries + '</td>'
                    + '<td style="text-align:right">' + item.credits + '</td></tr>';
            }).join('');

            var packageLines = monthlyCredits > 0
                ? '<p>Créditos contratados por mês: <b>' + monthlyCredits + '</b><br>'
                    + 'Créditos consumidos no ciclo: <b>' + used + '</b> (' + Math.round(used / monthlyCredits * 100) + '%)<br>'
                    + 'Saldo: <b>' + Math.max(monthlyCredits - used, 0) + '</b></p>'
                : '<p>Créditos consumidos no ciclo: <b>' + used + '</b><br>'
                    + '<i>Créditos contratados por mês não configurados no registro de Configuração das APIs.</i></p>';

            var overLimit = monthlyCredits > 0 && used > monthlyCredits
                ? '<p style="color:#b00020"><b>Atenção:</b> o consumo ultrapassou os créditos contratados em <b>'
                    + (used - monthlyCredits) + '</b> crédito(s). A Hub do Desenvolvedor poderá cobrar valores adicionais.</p>'
                : '';

            return '<p>Relatório de consumo de créditos da Hub do Desenvolvedor.</p>'
                + '<p>Ciclo atual: <b>' + formatDate(cycle.start) + '</b> a <b>' + formatDate(lastDayOf(cycle)) + '</b></p>'
                + packageLines
                + overLimit
                + (rows
                    ? '<table border="1" cellpadding="4" cellspacing="0">'
                        + '<tr><th>Tipo de consulta</th><th>Consultas</th><th>Créditos</th></tr>' + rows + '</table>'
                    : '<p>Nenhuma consulta com consumo de créditos neste ciclo.</p>');
        }

        function parseDate(value) {
            if (!value) return null;
            try {
                return startOfDay(format.parse({ value: value, type: format.Type.DATE }));
            } catch (e) {
                log.error('pd-petr-credit-report.parseDate', 'Data inválida: ' + value);
                return null;
            }
        }

        function startOfDay(date) {
            return new Date(date.getFullYear(), date.getMonth(), date.getDate());
        }

        function addMonths(date, months) {
            return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
        }

        function daysBetween(from, to) {
            return Math.round((to.getTime() - from.getTime()) / 86400000);
        }

        function lastDayOf(cycle) {
            return new Date(cycle.end.getFullYear(), cycle.end.getMonth(), cycle.end.getDate() - 1);
        }

        function formatDate(date) {
            var day = date.getDate();
            var month = date.getMonth() + 1;
            return (day < 10 ? '0' : '') + day + '/' + (month < 10 ? '0' : '') + month + '/' + date.getFullYear();
        }

        function escapeHtml(text) {
            return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        return {
            run: run,
            isDue: isDue,
            getCurrentCycle: getCurrentCycle
        };
    }
);

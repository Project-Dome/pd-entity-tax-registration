/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Registro único de consumo das APIs pagas (customrecord_pd_petr_credit_usage) e controle de
 * saldo por provedor (docs/specs/directd-integration.md, §4.5 e §4.6). Substitui
 * pd-petr-hub-credit-usage.js. SERVER-ONLY (N/record, N/runtime, N/search): importado só pela
 * cadeia do RESTlet, do User Event e do relatório agendado, nunca pela do Client Script.
 *
 * - track() grava uma linha por chamada paga bem-sucedida; trackHub() mantém a regra da Hub (usa
 *   o "consumed" da resposta; sem ele ou com zero não grava). Nenhum dos dois lança: falhar ao
 *   gravar o consumo não pode interromper a consulta. A resposta da API (entry.response; na Hub,
 *   o corpo serializado de novo) vai para "Resposta da API", cortada no limite do Long Text.
 * - Saldo Após a Consulta: calculado antes do save (consumo já gravado + esta linha), em créditos
 *   na Hub e em R$ na DirectD; vazio sem Créditos Carregados ou se o cálculo falhar.
 * - fillCurrentBalances(): beforeLoad da Configuração das APIs (pd-petr-api-settings.ue.js) — mostra
 *   o saldo atual nos campos não gravados "Créditos Disponíveis (Hub)" e "(R$)", calculado com os
 *   valores do próprio registro aberto (não do registro ativo), via form.getField().defaultValue.
 * - O provedor é um valor de customlist_pd_petr_api_provider; o internal id é resolvido pelo nome
 *   uma vez por execução (providerIdCache).
 * - checkBalance(): validade vencida (hoje > "Válido até (Hub)", só na Hub — a DirectD é
 *   controlada apenas por crédito) ou saldo menor que o custo previsto bloqueiam. Saldo = Créditos Carregados − consumo do
 *   provedor desde "Início da Contagem" (sem início, todo o consumo). O bloqueio devolve error
 *   (mensagem completa) e detail (só o motivo), usado pela hierarquia para juntar os motivos da
 *   Hub e da DirectD numa mensagem só. Créditos Carregados em branco = sem limite (na prática só na
 *   DirectD: a Hub sem crédito carregado nem chega aqui, pd-petr-cnpj-lookup). Nada é gravado no
 *   registro de configuração: o saldo é recalculado a cada checagem. A checagem não é
 *   transacional — duas consultas simultâneas podem passar com o mesmo saldo (limitação aceita).
 *   Erro no próprio cálculo (busca falhou, limite de uso) bloqueia com reason BALANCE_CHECK_ERROR:
 *   nunca libera sem saber o saldo; a tela acrescenta o pedido de acionar a Dome se persistir.
 * - Hub em créditos (soma de credits); DirectD em R$ (soma de cost).
 * - As datas da Configuração das APIs chegam da busca como texto no formato da conta —
 *   convertidas com N/format.parse.
 */
define(
    [
        'N/record',
        'N/runtime',
        'N/search',
        'N/format',
        '../modules/pd-petr-constants',
        './pd-petr-api-settings'
    ],
    function (
        record,
        runtime,
        search,
        format,
        constantsModule,
        apiSettingsService
    ) {
        var CREDIT_USAGE = constantsModule.CREDIT_USAGE;
        var TYPE = CREDIT_USAGE.TYPE;
        var FIELDS = CREDIT_USAGE.FIELDS;
        var PROVIDERS = CREDIT_USAGE.PROVIDERS;

        var MAX_RESPONSE_LENGTH = 1000000;

        var providerIdCache = {};

        function findProviderId(providerKey) {
            if (providerIdCache[providerKey]) return providerIdCache[providerKey];

            var providerId = null;

            search.create({
                type: CREDIT_USAGE.PROVIDER_LIST,
                filters: [['name', 'is', PROVIDERS[providerKey].label]],
                columns: ['internalid']
            }).run().each(function (result) {
                providerId = result.id;
                return false;
            });

            if (providerId) providerIdCache[providerKey] = providerId;

            return providerId;
        }

        function track(entry) {
            try {
                var usage = record.create({ type: TYPE });

                var providerId = findProviderId(entry.provider);
                if (providerId) usage.setValue({ fieldId: FIELDS.provider.name, value: providerId });

                usage.setValue({ fieldId: FIELDS.queryType.name, value: entry.queryType });
                usage.setValue({ fieldId: FIELDS.document.name, value: String(entry.document || '') });

                if (entry.credits) usage.setValue({ fieldId: FIELDS.credits.name, value: entry.credits });
                if (entry.cost) usage.setValue({ fieldId: FIELDS.cost.name, value: entry.cost });
                if (entry.queryUid) usage.setValue({ fieldId: FIELDS.queryUid.name, value: String(entry.queryUid) });
                if (entry.response) {
                    usage.setValue({ fieldId: FIELDS.apiResponse.name, value: String(entry.response).substring(0, MAX_RESPONSE_LENGTH) });
                }

                var userId = runtime.getCurrentUser().id;
                if (userId > 0) {
                    usage.setValue({ fieldId: FIELDS.user.name, value: userId });
                }

                var amount = entry.provider === 'HUB' ? Number(entry.credits) || 0 : Number(entry.cost) || 0;
                var balanceAfter = computeBalanceAfter(entry.provider, amount);
                if (balanceAfter !== null) {
                    usage.setValue({
                        fieldId: entry.provider === 'HUB' ? FIELDS.hubBalance.name : FIELDS.directdBalance.name,
                        value: balanceAfter
                    });
                }

                usage.save();

                log.debug('pd-petr-credit-usage.track', entry.provider + ' | ' + entry.queryType + ' | ' + entry.document
                    + ' | créditos: ' + (entry.credits || 0) + ' | custo: ' + (entry.cost || 0));
            } catch (e) {
                log.error({
                    title: 'pd-petr-credit-usage.track',
                    details: { entry: entry, message: e.message, stack: e.stack }
                });
            }
        }

        function trackHub(body, queryType, document) {
            var credits = Number(body && body.consumed) || 0;

            if (credits <= 0) return;

            track({ provider: 'HUB', queryType: queryType, document: document, credits: credits, response: JSON.stringify(body) });
        }

        function summarize(startDate, endDate, providerKey) {
            var summary = { totalCredits: 0, totalCost: 0, totalQueries: 0, byQueryType: [] };

            var filters = [
                [FIELDS.created.name, 'onorafter', formatDate(startDate)],
                'AND',
                [FIELDS.created.name, 'before', formatDate(endDate)]
            ];

            var providerId = providerKey ? findProviderId(providerKey) : null;
            if (providerKey && !providerId) return summary;
            if (providerId) filters.push('AND', [FIELDS.provider.name, 'anyof', providerId]);

            search.create({
                type: TYPE,
                filters: filters,
                columns: [
                    search.createColumn({ name: FIELDS.queryType.name, summary: search.Summary.GROUP }),
                    search.createColumn({ name: FIELDS.internalId.name, summary: search.Summary.COUNT }),
                    search.createColumn({ name: FIELDS.credits.name, summary: search.Summary.SUM }),
                    search.createColumn({ name: FIELDS.cost.name, summary: search.Summary.SUM })
                ]
            }).run().each(function (result) {
                var queries = Number(result.getValue({ name: FIELDS.internalId.name, summary: search.Summary.COUNT })) || 0;
                var credits = Number(result.getValue({ name: FIELDS.credits.name, summary: search.Summary.SUM })) || 0;
                var cost = Number(result.getValue({ name: FIELDS.cost.name, summary: search.Summary.SUM })) || 0;

                summary.byQueryType.push({
                    queryType: result.getValue({ name: FIELDS.queryType.name, summary: search.Summary.GROUP }),
                    queries: queries,
                    credits: credits,
                    cost: cost
                });

                summary.totalQueries += queries;
                summary.totalCredits += credits;
                summary.totalCost += cost;

                return true;
            });

            return summary;
        }

        function sumConsumed(providerKey, startDate) {
            var providerId = findProviderId(providerKey);
            if (!providerId) return 0;

            var amountField = providerKey === 'HUB' ? FIELDS.credits.name : FIELDS.cost.name;
            var filters = [[FIELDS.provider.name, 'anyof', providerId]];

            if (startDate) filters.push('AND', [FIELDS.created.name, 'onorafter', formatDate(startDate)]);

            var total = 0;

            search.create({
                type: TYPE,
                filters: filters,
                columns: [search.createColumn({ name: amountField, summary: search.Summary.SUM })]
            }).run().each(function (result) {
                total = Number(result.getValue({ name: amountField, summary: search.Summary.SUM })) || 0;
                return false;
            });

            return total;
        }

        function calculateBalance(providerKey, balanceSettings) {
            if (isEmpty(balanceSettings.available)) return null;

            return Number(balanceSettings.available) - sumConsumed(providerKey, parseDate(balanceSettings.countStart));
        }

        function roundAmount(providerKey, amount) {
            return providerKey === 'HUB' ? Math.round(amount) : Math.round(amount * 100) / 100;
        }

        function computeBalanceAfter(providerKey, amount) {
            try {
                var balance = calculateBalance(providerKey, getBalanceSettings(providerKey, apiSettingsService.get() || {}));

                return balance === null ? null : roundAmount(providerKey, balance - amount);
            } catch (e) {
                log.error({
                    title: 'pd-petr-credit-usage.computeBalanceAfter',
                    details: { provider: providerKey, message: e.message, stack: e.stack }
                });
                return null;
            }
        }

        function fillCurrentBalances(context) {
            if (!context.form) return;

            var currentRecord = context.newRecord;
            var settingsFields = constantsModule.API_SETTINGS.FIELDS;
            var targets = [
                { provider: 'HUB', loaded: settingsFields.hubLoadedCredits, start: settingsFields.hubCountStart, balance: settingsFields.hubBalance },
                { provider: 'DIRECTD', loaded: settingsFields.ddLoadedCredits, start: settingsFields.ddCountStart, balance: settingsFields.ddBalance }
            ];

            targets.forEach(function (target) {
                try {
                    var balance = calculateBalance(target.provider, {
                        available: currentRecord.getValue({ fieldId: target.loaded.name }),
                        countStart: currentRecord.getValue({ fieldId: target.start.name })
                    });

                    var field = context.form.getField({ id: target.balance.name });
                    if (field && balance !== null) field.defaultValue = roundAmount(target.provider, balance);
                } catch (e) {
                    log.error({
                        title: 'pd-petr-credit-usage.fillCurrentBalances',
                        details: { provider: target.provider, message: e.message, stack: e.stack }
                    });
                }
            });
        }

        function getBalanceSettings(providerKey, apiSettings) {
            if (providerKey === 'HUB') {
                return {
                    available: apiSettings.hubLoadedCredits,
                    countStart: apiSettings.hubCountStart,
                    validTo: apiSettings.hubValidTo
                };
            }

            return {
                available: apiSettings.ddLoadedCredits,
                countStart: apiSettings.ddCountStart,
                validTo: null
            };
        }

        function checkBalance(providerKey, expectedAmount, apiSettings) {
            try {
                var label = PROVIDERS[providerKey].label;
                var balanceSettings = getBalanceSettings(providerKey, apiSettings || {});

                var validTo = parseDate(balanceSettings.validTo);
                if (validTo && startOfDay(new Date()) > startOfDay(validTo)) {
                    return {
                        allowed: false,
                        reason: 'EXPIRED',
                        detail: 'período de uso terminou em ' + toDisplayDate(validTo),
                        error: 'O período de uso da ' + label + ' terminou em ' + toDisplayDate(validTo)
                            + '. Entre em contato com a equipe Dome.'
                    };
                }

                var balance = calculateBalance(providerKey, balanceSettings);

                if (balance === null) return { allowed: true };

                if (balance + 0.000001 < Number(expectedAmount || 0)) {
                    var detail = 'saldo: ' + formatAmount(providerKey, balance) + '; necessário: ' + formatAmount(providerKey, expectedAmount);

                    return {
                        allowed: false,
                        reason: 'NO_BALANCE',
                        detail: detail,
                        error: 'Créditos disponíveis da ' + label + ' insuficientes para esta consulta (' + detail
                            + '). Entre em contato com a equipe Dome.'
                    };
                }

                return { allowed: true };
            } catch (e) {
                log.error({
                    title: 'pd-petr-credit-usage.checkBalance',
                    details: { provider: providerKey, message: e.message, stack: e.stack }
                });
                return {
                    allowed: false,
                    reason: 'BALANCE_CHECK_ERROR',
                    detail: 'não foi possível verificar o saldo',
                    error: 'Não foi possível verificar o saldo de créditos da ' + PROVIDERS[providerKey].label
                        + ', por isso a consulta foi bloqueada. Tente novamente.'
                };
            }
        }

        function formatAmount(providerKey, amount) {
            var value = Math.max(Number(amount) || 0, 0);

            if (providerKey === 'HUB') return String(Math.floor(value)) + ' crédito(s)';

            return 'R$ ' + value.toFixed(2).replace('.', ',');
        }

        function isEmpty(value) {
            return value === null || value === undefined || value === '';
        }

        function parseDate(value) {
            if (isEmpty(value)) return null;
            if (value instanceof Date) return value;

            try {
                return format.parse({ value: value, type: format.Type.DATE });
            } catch (e) {
                log.error('pd-petr-credit-usage.parseDate', 'Data não reconhecida: ' + value);
                return null;
            }
        }

        function formatDate(date) {
            return format.format({ value: date, type: format.Type.DATE });
        }

        function startOfDay(date) {
            return new Date(date.getFullYear(), date.getMonth(), date.getDate());
        }

        function toDisplayDate(date) {
            var day = date.getDate();
            var month = date.getMonth() + 1;
            return (day < 10 ? '0' : '') + day + '/' + (month < 10 ? '0' : '') + month + '/' + date.getFullYear();
        }

        return {
            track: track,
            trackHub: trackHub,
            summarize: summarize,
            checkBalance: checkBalance,
            fillCurrentBalances: fillCurrentBalances
        };
    }
);

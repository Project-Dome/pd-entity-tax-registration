/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Orquestra cada modo de consulta da DirectD (docs/specs/directd-integration.md, §4.1 a §4.7).
 * SERVER-ONLY (depende de pd-petr-credit-usage). Nunca lança exceção: devolve
 * { success: true, provider: 'DIRECTD', data, warning } ou { success: false, reason, error }.
 *
 * - Modos: DD_FULL (CNPJ Plus → Sintegra), DD_PLUS, DD_BASIC e DD_IE (só Sintegra). Só CNPJ.
 * - Sucesso = HTTP 200 com "retorno"; não encontrado = HTTP 404 ou "retorno" nulo; o resto
 *   (400, 401, 408, 500, 503, exceção/timeout) = falha. 401 tem mensagem própria (token ou IP).
 * - Sem saldo na DirectD (recarga feita pelo cliente no painel dela): HTTP 402 ou falha cuja
 *   metaDados.mensagem fala em saldo/crédito → reason NO_BALANCE, que a hierarquia trata como
 *   bloqueio. O código real ainda precisa ser confirmado na Parte 0. Todo bloqueio (saldo
 *   interno ou da própria DirectD) leva também detail, o motivo curto que a hierarquia junta ao
 *   da Hub quando as duas estão bloqueadas.
 * - Saldo checado antes de começar, para o custo previsto da consulta inteira; na reserva da
 *   Receita Federal PJ (só em "não encontrado" do Plus/Básico), checado de novo para o custo
 *   restante. Cada chamada bem-sucedida grava uma linha de consumo com o preço configurado e o
 *   consultaUid.
 * - DD_FULL: UF do Sintegra = UF do cadastro obtido (Plus ou Receita PJ). Sem UF ou com o Sintegra
 *   falhando, o cadastro é devolvido com aviso — a IE fica de fora. O regimeApuracao do Sintegra
 *   só é usado quando o cadastro veio da Receita PJ (sem Simples/MEI).
 * - DD_IE: UF vem de options.uf (endereço do cadastro); devolve só { cnpj, inscricao_estadual }.
 */
define(
    [
        './pd-petr-api-settings',
        './pd-petr-directd-api',
        './pd-petr-directd-adapter',
        './pd-petr-credit-usage',
        '../modules/pd-petr-constants'
    ],
    function (
        apiSettingsService,
        directdApiService,
        directdAdapter,
        creditUsageService,
        constantsModule
    ) {
        var MODES = constantsModule.LOOKUP_MODES;
        var QUERY_TYPES = constantsModule.CREDIT_USAGE.QUERY_TYPES;

        var DISABLED_MESSAGE = 'A DirectD não está habilitada. Configure o registro de Configuração das APIs.';
        var UNAUTHORIZED_MESSAGE = 'A DirectD recusou a consulta (token inválido ou IP não liberado). Entre em contato com a equipe Dome.';
        var NO_BALANCE_MESSAGE = 'O saldo da DirectD acabou. Faça uma recarga no painel da DirectD e tente novamente.';
        var NO_BALANCE_DETAIL = 'saldo da conta na DirectD acabou; é preciso recarregar no painel da DirectD';
        var NO_BALANCE_PATTERN = /saldo|cr[eé]dito/i;
        var CNPJ_ONLY_MESSAGE = 'As consultas da DirectD atendem apenas CNPJ.';
        var MISSING_UF_MESSAGE = 'Preencha o endereço (Estado) do cadastro antes de consultar a Inscrição Estadual.';
        var NOT_FOUND_MESSAGE = 'CNPJ não encontrado na DirectD.';
        var FAILURE_MESSAGE = 'Não foi possível consultar os dados do CNPJ na DirectD.';
        var STATE_REG_FAILURE_MESSAGE = 'Não foi possível consultar a Inscrição Estadual no Sintegra.';
        var STATE_REG_SKIPPED_WARNING = {
            title: 'Inscrição Estadual não obtida',
            message: 'A Inscrição Estadual não foi obtida no Sintegra. Os demais dados foram preenchidos.'
        };

        function isAvailable(apiSettings) {
            return !!(apiSettings && apiSettings.ddEnabled && apiSettings.ddToken);
        }

        function getPrices(apiSettings) {
            return {
                plus: Number(apiSettings.ddPricePlus) || 0,
                basic: Number(apiSettings.ddPriceBasic) || 0,
                sintegra: Number(apiSettings.ddPriceSintegra) || 0,
                federalRevenue: Number(apiSettings.ddPriceFederalRevenue) || 0
            };
        }

        function lookup(mode, cnpj, options) {
            try {
                var apiSettings = apiSettingsService.get();

                if (!isAvailable(apiSettings)) {
                    return { success: false, reason: 'DIRECTD_DISABLED', error: DISABLED_MESSAGE };
                }

                if (String(cnpj).toUpperCase().replace(/[^0-9A-Z]/g, '').length !== 14) {
                    return { success: false, reason: 'CNPJ_ONLY', error: CNPJ_ONLY_MESSAGE };
                }

                var context = {
                    cnpj: cnpj,
                    apiSettings: apiSettings,
                    prices: getPrices(apiSettings),
                    token: apiSettings.ddToken
                };

                if (mode === MODES.DD_IE) return lookupStateRegistration(context, (options || {}).uf);

                return lookupCompany(mode, context);
            } catch (e) {
                log.error({
                    title: 'pd-petr-directd-lookup.lookup',
                    details: { mode: mode, cnpj: cnpj, message: e.message, stack: e.stack }
                });
                return { success: false, reason: 'PROVIDER_ERROR', error: FAILURE_MESSAGE };
            }
        }

        function lookupCompany(mode, context) {
            var prices = context.prices;
            var isBasic = mode === MODES.DD_BASIC;
            var isFull = mode === MODES.DD_FULL;
            var companyPrice = isBasic ? prices.basic : prices.plus;
            var sintegraPrice = isFull ? prices.sintegra : 0;

            var balance = creditUsageService.checkBalance('DIRECTD', companyPrice + sintegraPrice, context.apiSettings);
            if (!balance.allowed) return buildBlocked(balance);

            var company = callDirectd(
                isBasic ? directdApiService.getCompanyBasic : directdApiService.getCompanyPlus,
                [context.cnpj, { token: context.token }],
                isBasic ? QUERY_TYPES.DIRECTD_BASIC : QUERY_TYPES.DIRECTD_PLUS,
                context.cnpj,
                companyPrice
            );

            var data;
            var cameFromFederalRevenue = false;

            if (company.status === 'SUCCESS') {
                data = directdAdapter.toCanonical(company.retorno);
            } else if (company.status === 'NOT_FOUND') {
                var fallback = lookupFederalRevenue(context, sintegraPrice);
                if (!fallback.success) return fallback;

                data = fallback.data;
                cameFromFederalRevenue = true;
            } else {
                return buildFailure(company.status);
            }

            if (!data.cnpj) data.cnpj = context.cnpj;

            if (!isFull) return { success: true, provider: 'DIRECTD', data: data, warning: null };

            return appendStateRegistration(context, data, isBasic || cameFromFederalRevenue);
        }

        function lookupFederalRevenue(context, sintegraPrice) {
            var balance = creditUsageService.checkBalance('DIRECTD', context.prices.federalRevenue + sintegraPrice, context.apiSettings);
            if (!balance.allowed) return buildBlocked(balance);

            var federalRevenue = callDirectd(
                directdApiService.getFederalRevenue,
                [context.cnpj, { token: context.token }],
                QUERY_TYPES.DIRECTD_FEDERAL_REVENUE,
                context.cnpj,
                context.prices.federalRevenue
            );

            if (federalRevenue.status === 'SUCCESS') {
                return { success: true, data: directdAdapter.toCanonicalFromFederalRevenue(federalRevenue.retorno) };
            }

            if (federalRevenue.status === 'NOT_FOUND') {
                return { success: false, reason: 'NOT_FOUND', error: NOT_FOUND_MESSAGE };
            }

            return buildFailure(federalRevenue.status);
        }

        function appendStateRegistration(context, data, useRegimeApuracao) {
            var uf = String(data.uf || '').trim().toUpperCase();

            if (!uf) {
                log.debug('pd-petr-directd-lookup.appendStateRegistration', 'Cadastro sem UF — Sintegra não consultado.');
                return { success: true, provider: 'DIRECTD', data: data, warning: STATE_REG_SKIPPED_WARNING };
            }

            var sintegra = callDirectd(
                directdApiService.getSintegra,
                [context.cnpj, uf, { token: context.token }],
                QUERY_TYPES.DIRECTD_SINTEGRA,
                context.cnpj,
                context.prices.sintegra
            );

            if (sintegra.status !== 'SUCCESS') {
                return { success: true, provider: 'DIRECTD', data: data, warning: STATE_REG_SKIPPED_WARNING };
            }

            var stateRegistration = directdAdapter.toStateRegistration(sintegra.retorno, uf);
            var merged = directdAdapter.applyStateRegistration(data, stateRegistration, useRegimeApuracao);

            return {
                success: true,
                provider: 'DIRECTD',
                data: merged,
                warning: stateRegistration.inscricao_estadual ? null : STATE_REG_SKIPPED_WARNING
            };
        }

        function lookupStateRegistration(context, uf) {
            var targetUf = String(uf || '').trim().toUpperCase();

            if (!targetUf) {
                return { success: false, reason: 'MISSING_UF', error: MISSING_UF_MESSAGE };
            }

            var balance = creditUsageService.checkBalance('DIRECTD', context.prices.sintegra, context.apiSettings);
            if (!balance.allowed) return buildBlocked(balance);

            var sintegra = callDirectd(
                directdApiService.getSintegra,
                [context.cnpj, targetUf, { token: context.token }],
                QUERY_TYPES.DIRECTD_SINTEGRA,
                context.cnpj,
                context.prices.sintegra
            );

            var notFoundMessage = 'Inscrição Estadual não encontrada no Sintegra de ' + targetUf + '.';

            if (sintegra.status === 'UNAUTHORIZED' || sintegra.status === 'NO_BALANCE') return buildFailure(sintegra.status);
            if (sintegra.status === 'ERROR') return { success: false, reason: 'PROVIDER_ERROR', error: STATE_REG_FAILURE_MESSAGE };
            if (sintegra.status === 'NOT_FOUND') return { success: false, reason: 'NOT_FOUND', error: notFoundMessage };

            var stateRegistration = directdAdapter.toStateRegistration(sintegra.retorno, targetUf);

            if (!stateRegistration.inscricao_estadual) {
                return { success: false, reason: 'NOT_FOUND', error: notFoundMessage };
            }

            return {
                success: true,
                provider: 'DIRECTD',
                data: { cnpj: context.cnpj, inscricao_estadual: stateRegistration.inscricao_estadual },
                warning: null
            };
        }

        function callDirectd(apiFunction, args, queryType, cnpj, cost) {
            var response;

            try {
                response = apiFunction.apply(null, args);
            } catch (e) {
                log.error({
                    title: 'pd-petr-directd-lookup.callDirectd',
                    details: { queryType: queryType, message: e.message, stack: e.stack }
                });
                return { status: 'ERROR' };
            }

            var body = parseBody(response.body);
            var metaDados = (body && body.metaDados) || {};

            log.audit('pd-petr-directd-lookup.callDirectd', queryType + ' | HTTP ' + response.code
                + ' | consultaUid: ' + metaDados.consultaUid + ' | mensagem: ' + metaDados.mensagem);

            var failed = response.code !== 200 || !body || !body.retorno;
            if (response.code === 402 || (failed && NO_BALANCE_PATTERN.test(String(metaDados.mensagem || '')))) {
                return { status: 'NO_BALANCE' };
            }

            if (response.code === 401) return { status: 'UNAUTHORIZED' };
            if (response.code === 404) return { status: 'NOT_FOUND' };
            if (response.code !== 200 || !body) return { status: 'ERROR' };
            if (!body.retorno) return { status: 'NOT_FOUND' };

            creditUsageService.track({
                provider: 'DIRECTD',
                queryType: queryType,
                document: cnpj,
                cost: cost,
                queryUid: metaDados.consultaUid,
                response: response.body
            });

            return { status: 'SUCCESS', retorno: body.retorno };
        }

        function parseBody(rawBody) {
            try {
                return rawBody ? JSON.parse(rawBody) : null;
            } catch (e) {
                log.error({
                    title: 'pd-petr-directd-lookup.parseBody',
                    details: { message: 'Resposta não é JSON', body: rawBody }
                });
                return null;
            }
        }

        function buildFailure(status) {
            if (status === 'UNAUTHORIZED') {
                return { success: false, reason: 'UNAUTHORIZED', error: UNAUTHORIZED_MESSAGE };
            }
            if (status === 'NO_BALANCE') {
                return { success: false, reason: 'NO_BALANCE', error: NO_BALANCE_MESSAGE, detail: NO_BALANCE_DETAIL };
            }
            return { success: false, reason: 'PROVIDER_ERROR', error: FAILURE_MESSAGE };
        }

        function buildBlocked(balance) {
            return { success: false, reason: balance.reason, error: balance.error, detail: balance.detail };
        }

        return {
            isAvailable: isAvailable,
            lookup: lookup
        };
    }
);

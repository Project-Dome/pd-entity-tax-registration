/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        './pd-petr-api-settings',
        '../util/pd-petr-rate-limiter',
        './pd-petr-receitaws-api',
        './pd-petr-receitaws-adapter',
        './pd-petr-cnpj-api'
    ],
    function (
        apiSettingsService,
        rateLimiter,
        receitawsApiService,
        receitawsAdapter,
        cnpjApiService
    ) {
        var RATE_LIMIT_KEY = 'pd_petr_rws';
        var RATE_LIMIT_WINDOW_SECONDS = 60;

        var NO_SETTINGS_MESSAGE = 'Nenhum provedor de consulta habilitado. Configure o registro de Configuração das APIs.';
        var NO_PROVIDER_AVAILABLE_MESSAGE = 'Não foi possível consultar os dados do CNPJ em nenhum provedor disponível.';

        // Orquestra ReceitaWS -> BrasilAPI (ordem fixa, não configurável — ver
        // docs/specs/multi-provider-cnpj-lookup.md, seção 4). Nunca lança exceção: toda falha
        // de rede/timeout/parse é capturada internamente, mesmo padrão dos demais services HTTP
        // do módulo.
        function getCompanyData(cnpj) {
            var settings = apiSettingsService.get();

            if (!settings) {
                return { success: false, reason: 'NO_PROVIDER_AVAILABLE', error: NO_SETTINGS_MESSAGE };
            }

            var rateLimited = false;

            if (settings.rwsEnabled) {
                var receitaWsResult = tryReceitaWs(cnpj, settings);

                if (receitaWsResult.success) {
                    return { success: true, provider: 'RECEITAWS', data: receitaWsResult.data };
                }

                rateLimited = receitaWsResult.rateLimited;
            }

            if (settings.brasilApiEnabled) {
                var brasilApiResult = tryBrasilApi(cnpj, settings);

                if (brasilApiResult.success) {
                    return { success: true, provider: 'BRASILAPI', data: brasilApiResult.data };
                }
            } else if (rateLimited) {
                // Caso especial confirmado na spec (§4): ReceitaWS falhou especificamente por
                // rate limit e não há BrasilAPI habilitada para cair — mensagem explica a causa
                // e quanto tempo falta, em vez do erro genérico de "nenhum provedor disponível".
                return buildRateLimitNoFallbackResult(settings);
            }

            return { success: false, reason: 'NO_PROVIDER_AVAILABLE', error: NO_PROVIDER_AVAILABLE_MESSAGE };
        }

        function buildRateLimitNoFallbackResult(settings) {
            var retryAfterSeconds = rateLimiter.getRetryAfterSeconds(RATE_LIMIT_WINDOW_SECONDS);

            return {
                success: false,
                reason: 'RATE_LIMIT_NO_FALLBACK',
                retryAfterSeconds: retryAfterSeconds,
                error: 'Limite de ' + settings.rwsRateLimit + ' consultas por minuto do ReceitaWS atingido e o '
                    + 'provedor BrasilAPI está desabilitado. Aguarde aproximadamente ' + retryAfterSeconds
                    + ' segundos e tente novamente.'
            };
        }

        // Devolve { success, data } em caso de sucesso, ou { success:false, rateLimited } —
        // rateLimited diferencia "falhou por cota estourada" (preventivo ou HTTP 429) de
        // "falhou por outro motivo", decisão que só importa lá em cima em getCompanyData.
        function tryReceitaWs(cnpj, settings) {
            var hasQuota = rateLimiter.consume(RATE_LIMIT_KEY, settings.rwsRateLimit, RATE_LIMIT_WINDOW_SECONDS);

            if (!hasQuota) {
                log.debug('pd-petr-cnpj-lookup.tryReceitaWs', 'Sem cota disponível no rate limiter local — pulando para BrasilAPI.');
                return { success: false, rateLimited: true };
            }

            var response;

            try {
                response = receitawsApiService.get(cnpj, { token: settings.rwsToken });
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryReceitaWs',
                    details: { stack: e.stack, message: e.message }
                });
                return { success: false, rateLimited: false };
            }

            // O próprio ReceitaWS sinalizando estouro de cota, mesmo com o contador local
            // achando que havia cota — consome a chamada mesmo sem sucesso (rede de segurança
            // contra o cache não-transacional, ver pd-petr-rate-limiter.js).
            if (response.code === 429) {
                log.debug('pd-petr-cnpj-lookup.tryReceitaWs', 'ReceitaWS retornou HTTP 429 — pulando para BrasilAPI.');
                return { success: false, rateLimited: true };
            }

            if (response.code !== 200) {
                log.error('pd-petr-cnpj-lookup.tryReceitaWs', 'HTTP ' + response.code + ' — pulando para BrasilAPI.');
                return { success: false, rateLimited: false };
            }

            var body;

            try {
                body = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryReceitaWs',
                    details: { message: 'Resposta não é JSON', body: response.body }
                });
                return { success: false, rateLimited: false };
            }

            if (body.status === 'ERROR') {
                log.debug('pd-petr-cnpj-lookup.tryReceitaWs', 'ReceitaWS retornou status ERROR: ' + body.message);
                return { success: false, rateLimited: false };
            }

            return { success: true, data: receitawsAdapter.toCanonical(body) };
        }

        function tryBrasilApi(cnpj, settings) {
            var response;

            try {
                response = cnpjApiService.get(cnpj);
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryBrasilApi',
                    details: { stack: e.stack, message: e.message }
                });
                return { success: false };
            }

            if (response.code !== 200) {
                log.error('pd-petr-cnpj-lookup.tryBrasilApi', 'HTTP ' + response.code);
                return { success: false };
            }

            var body;

            try {
                body = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryBrasilApi',
                    details: { message: 'Resposta não é JSON', body: response.body }
                });
                return { success: false };
            }

            return { success: true, data: body };
        }

        return { getCompanyData: getCompanyData };
    }
);

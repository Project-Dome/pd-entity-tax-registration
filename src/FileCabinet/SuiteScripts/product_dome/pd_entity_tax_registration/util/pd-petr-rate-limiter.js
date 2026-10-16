/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Rate limiter de janela fixa em N/cache: cada chamada cai num "bucket" de windowInSeconds
 * segundos (não é janela deslizante), e a chave do cache inclui o número do bucket.
 *
 * - O N/cache recusa ttl menor que 300s. Não afeta a contagem: cada janela usa uma chave nova;
 *   um ttl maior só deixa a chave antiga ociosa até ser descartada.
 * - O N/cache não é transacional: em concorrência alta pode passar 1 chamada além do limite.
 *   Aceito por design (ver spec) — o HTTP 429 do provedor é a rede de segurança final.
 * - consume() nunca lança: se o cache falhar, devolve true (assume que há cota) para não
 *   derrubar o provedor primário nem impedir o fallback.
 * - getRetryAfterSeconds() é cálculo puro sobre o relógio — não lê o cache nem depende da
 *   key, então serve tanto para o bloqueio preventivo quanto para o HTTP 429 do provedor.
 */
define(['N/cache'], function (cache) {

    var CACHE_NAME = 'pd_petr_rate_limiter';

    var MIN_TTL_SECONDS = 300;

    function resolveTtl(windowInSeconds) {
        return Math.max(MIN_TTL_SECONDS, windowInSeconds * 2);
    }

    function consume(key, limit, windowInSeconds) {
        try {
            var ttl = resolveTtl(windowInSeconds);
            var bucket = Math.floor(Date.now() / 1000 / windowInSeconds);
            var cacheKey = key + '_' + bucket;

            var rateLimitCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });

            var currentCount = Number(rateLimitCache.get({
                key: cacheKey,
                loader: function () { return '0'; },
                ttl: ttl
            })) || 0;

            if (currentCount >= limit) return false;

            rateLimitCache.put({
                key: cacheKey,
                value: String(currentCount + 1),
                ttl: ttl
            });

            return true;
        } catch (e) {
            log.error({
                title: 'pd-petr-rate-limiter.consume',
                details: {
                    message: 'Falha ao ler/gravar o contador no cache — seguindo como se houvesse cota (o HTTP 429 do provedor é a rede de segurança).',
                    errorName: e.name,
                    errorMessage: e.message
                }
            });
            return true;
        }
    }

    function getRetryAfterSeconds(windowInSeconds) {
        var nowInSeconds = Math.floor(Date.now() / 1000);
        return windowInSeconds - (nowInSeconds % windowInSeconds);
    }

    return {
        consume: consume,
        getRetryAfterSeconds: getRetryAfterSeconds
    };
});

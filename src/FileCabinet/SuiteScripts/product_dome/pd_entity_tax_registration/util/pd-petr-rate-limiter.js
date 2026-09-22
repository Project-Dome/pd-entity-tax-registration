/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(['N/cache'], function (cache) {

    var CACHE_NAME = 'pd_petr_rate_limiter';

    // O N/cache do NetSuite recusa ttl menor que 300 segundos ("Input value ttl must be greater
    // than or equal to 300"). Isso não afeta a contagem: a chave do cache já inclui o número do
    // bucket (minuto corrente), então cada janela usa uma chave nova e começa do zero — um ttl
    // maior que a janela só deixa a chave antiga ociosa na memória até ser descartada.
    var MIN_TTL_SECONDS = 300;

    function resolveTtl(windowInSeconds) {
        return Math.max(MIN_TTL_SECONDS, windowInSeconds * 2);
    }

    // Janela fixa: a chamada corrente cai num "bucket" (janela de windowInSeconds segundos) —
    // não é uma janela deslizante. O contador do bucket é lido e regravado no N/cache, que não
    // é transacional: em concorrência alta, duas chamadas simultâneas podem ler o mesmo valor
    // antes de qualquer uma gravar, deixando passar 1 chamada a mais do que o limite. Isso é
    // aceito por design (documentado na spec) — o HTTP 429 real do provedor é a rede de
    // segurança final contra esse cenário.
    // Nunca lança: o contador é só uma otimização para evitar chamadas obviamente perdidas, e
    // a autoridade real sobre o limite é o HTTP 429 do provedor. Se o cache falhar por qualquer
    // motivo, devolve `true` (assume que há cota) para não derrubar o provedor primário nem
    // impedir o fallback — o 429 cobre o caso de realmente estar acima do limite.
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

    // Cálculo puro baseado no relógio — não lê o cache nem depende da `key`, então serve tanto
    // para o bloqueio preventivo do consume() quanto para o caso de HTTP 429 vindo do próprio
    // provedor (ver pd-petr-cnpj-lookup.js).
    function getRetryAfterSeconds(windowInSeconds) {
        var nowInSeconds = Math.floor(Date.now() / 1000);
        return windowInSeconds - (nowInSeconds % windowInSeconds);
    }

    return {
        consume: consume,
        getRetryAfterSeconds: getRetryAfterSeconds
    };
});

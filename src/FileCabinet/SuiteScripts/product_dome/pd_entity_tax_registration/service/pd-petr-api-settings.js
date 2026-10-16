/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * get() devolve null quando não existe registro de Configuração das APIs ativo — quem chama
 * decide o que fazer. O null não é cacheado, para que um registro criado durante a sessão
 * passe a valer na chamada seguinte (mesmo padrão de pd-petr-validation-settings.get()).
 */
define(
    [
        '../modules/pd-petr-constants',
        '../util/pd-petr-search-data'
    ],
    function (
        constantsModule,
        searchDataUtil
    ) {
        var TYPE = constantsModule.API_SETTINGS.TYPE;
        var FIELDS = constantsModule.API_SETTINGS.FIELDS;

        var cachedSettings = null;

        function findStoredSettings() {
            try {
                return searchDataUtil.first({
                    type: TYPE,
                    fields: FIELDS,
                    filters: [['isinactive', 'is', 'F']]
                });
            } catch (e) {
                log.error('pd-petr-api-settings.findStoredSettings', e);
                return null;
            }
        }

        function get() {
            if (cachedSettings) return cachedSettings;

            var stored = findStoredSettings();
            if (!stored) return null;

            cachedSettings = {
                rwsEnabled: stored.rwsEnabled,
                rwsToken: stored.rwsToken,
                rwsRateLimit: stored.rwsRateLimit,
                hubEnabled: stored.hubEnabled,
                hubToken: stored.hubToken,
                hubMonthlyCredits: stored.hubMonthlyCredits,
                hubRenewalDay: stored.hubRenewalDay
            };

            return cachedSettings;
        }

        return {
            get: get
        };
    }
);

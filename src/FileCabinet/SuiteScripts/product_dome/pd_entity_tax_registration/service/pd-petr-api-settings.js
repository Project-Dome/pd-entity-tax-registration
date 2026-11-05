/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * get() devolve null quando não existe registro de Configuração das APIs ativo — quem chama
 * decide o que fazer. O null não é cacheado, para que um registro criado durante a sessão
 * passe a valer na chamada seguinte (mesmo padrão de pd-petr-validation-settings.get()).
 *
 * Os campos de data (hubCountStart, hubValidTo, ddCountStart) voltam da busca como
 * texto no formato de data da conta; quem usa converte com N/format (pd-petr-credit-usage.js).
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
                hubRenewalDay: stored.hubRenewalDay,
                hubLoadedCredits: stored.hubLoadedCredits,
                hubCountStart: stored.hubCountStart,
                hubValidTo: stored.hubValidTo,
                ddEnabled: stored.ddEnabled,
                ddToken: stored.ddToken,
                ddPricePlus: stored.ddPricePlus,
                ddPriceBasic: stored.ddPriceBasic,
                ddPriceSintegra: stored.ddPriceSintegra,
                ddPriceFederalRevenue: stored.ddPriceFederalRevenue,
                ddLoadedCredits: stored.ddLoadedCredits,
                ddCountStart: stored.ddCountStart
            };

            return cachedSettings;
        }

        return {
            get: get
        };
    }
);

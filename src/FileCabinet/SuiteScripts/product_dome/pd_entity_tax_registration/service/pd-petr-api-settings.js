/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
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

        // Devolve null quando não existe registro de configuração ativo na conta. Sem
        // configuração o módulo não assume nada: quem chama decide o que fazer. O null NÃO é
        // cacheado, para que o registro criado durante a sessão passe a valer na chamada
        // seguinte — mesmo padrão de pd-petr-validation-settings.get().
        function get() {
            if (cachedSettings) return cachedSettings;

            var stored = findStoredSettings();
            if (!stored) return null;

            cachedSettings = {
                rwsEnabled: stored.rwsEnabled,
                rwsToken: stored.rwsToken,
                rwsRateLimit: stored.rwsRateLimit,
                brasilApiEnabled: stored.brasilApiEnabled
            };

            return cachedSettings;
        }

        return {
            get: get
        };
    }
);

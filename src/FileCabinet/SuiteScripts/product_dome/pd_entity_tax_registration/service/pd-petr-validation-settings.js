/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        '../modules/pd-petr-constants',
        '../util/pd-petr-get-data',
        '../util/pd-petr-set-data',
        '../util/pd-petr-search-data'
    ],
    function (
        constantsModule,
        getDataUtil,
        setDataUtil,
        searchDataUtil
    ) {
        const TYPE = constantsModule.VALIDATION_SETTINGS.TYPE;
        const FIELDS = constantsModule.VALIDATION_SETTINGS.FIELDS;

        let previousValues = null;
        let cachedSettings = null;

        function getTogglableUpdateFields() {
            var toggleFields = {};

            Object.keys(FIELDS).forEach(function (fieldKey) {
                var isUpdateField = fieldKey.indexOf('update') === 0;
                var isNotUpdateAllField = fieldKey !== 'updateAll';

                if (isUpdateField && isNotUpdateAllField) {
                    toggleFields[fieldKey] = FIELDS[fieldKey];
                }
            });

            return toggleFields;
        }

        function applyUpdateAllState(currentRecord) {
            var updateAll = currentRecord.getValue({ fieldId: FIELDS.updateAll.name });
            var toggleFields = getTogglableUpdateFields();

            if (updateAll && !previousValues) {
                previousValues = getDataUtil.bodyFields(toggleFields, currentRecord);
            }

            if (updateAll) {
                var clearedValues = {};
                Object.keys(toggleFields).forEach(function (fieldKey) {
                    clearedValues[fieldKey] = false;
                });
                setDataUtil.bodyFields(toggleFields, currentRecord, clearedValues);
            } else if (previousValues) {
                setDataUtil.bodyFields(toggleFields, currentRecord, previousValues);
                previousValues = null;
            }

            Object.keys(toggleFields).forEach(function (fieldKey) {
                var field = currentRecord.getField({ fieldId: toggleFields[fieldKey].name });
                if (field) field.isDisabled = updateAll;
            });
        }

        function findStoredSettings() {
            try {
                return searchDataUtil.first({
                    type: TYPE,
                    fields: FIELDS,
                    filters: [['isinactive', 'is', 'F']]
                });
            } catch (e) {
                log.error('pd-petr-validation-settings.findStoredSettings', e);
                return null;
            }
        }

        // Devolve null quando não existe registro de configuração ativo na conta. Sem
        // configuração o módulo não assume nada: quem chama avisa o usuário para criar o
        // registro. O null NÃO é cacheado, para que o registro criado durante a sessão
        // passe a valer na chamada seguinte.
        function get() {
            if (cachedSettings) return cachedSettings;

            var stored = findStoredSettings();
            if (!stored) return null;

            var settings = {};

            Object.keys(FIELDS).forEach(function (fieldKey) {
                if (fieldKey !== 'internalId') settings[fieldKey] = stored[fieldKey];
            });

            if (settings.updateAll) {
                var toggleableFields = getTogglableUpdateFields();
                Object.keys(toggleableFields).forEach(function (fieldKey) {
                    settings[fieldKey] = true;
                });
            }

            cachedSettings = settings;

            return cachedSettings;
        }

        function managePageInit(context) {
            applyUpdateAllState(context.currentRecord);
            return true;
        }

        function manageFieldChanged(context) {
            if (context.fieldId !== FIELDS.updateAll.name) return true;

            applyUpdateAllState(context.currentRecord);
            return true;
        }

        return {
            get: get,
            managePageInit: managePageInit,
            manageFieldChanged: manageFieldChanged
        };
    }
);

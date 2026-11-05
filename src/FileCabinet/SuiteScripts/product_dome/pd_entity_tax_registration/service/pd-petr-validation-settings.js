/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * get() devolve null quando não existe registro de Configuração das Validações ativo — quem
 * chama avisa o usuário para criar o registro. O null não é cacheado, para que um registro
 * criado durante a sessão passe a valer na chamada seguinte.
 *
 * - get() lê a configuração pelo Suitelet anônimo de busca (pd-petr-data-lookup-gateway): o
 *   papel de quem abre um Customer/Vendor pode não ter acesso ao registro de configuração, e a
 *   busca direta devolveria null como se o registro não existisse. Falha do Suitelet também
 *   devolve null (logado no gateway). findStoredPublicSettings() é a busca direta, usada só
 *   pelo Suitelet, e já remove VALIDATION_SETTINGS.PRIVATE_FIELD_KEYS.
 *
 * - Busca Automática de Data de Nascimento (enableAutoBirthDate) depende de "Consultar CPF (Hub)":
 *   desabilitada e desmarcada enquanto ele estiver desmarcado (applyCpfDependency no cliente;
 *   manageBeforeSubmit repete a regra no servidor, para inline edit e CSV).
 * - Marcar a busca automática abre um diálogo com "Estou ciente"/"Cancelar" (dialog.create, não
 *   dialog.confirm, para ter os rótulos próprios); Cancelar desmarca a flag.
 * - manageBeforeSubmit grava Ciente em/Ciente por quando a flag passa de desmarcada para marcada.
 *   Em inline edit (xedit) o newRecord só traz os campos alterados — os demais vêm do oldRecord.
 * - "Consulta DirectD na Hierarquia" fica desabilitada e vazia enquanto "DirectD na Hierarquia"
 *   estiver desmarcado (applyDirectdChainDependency). Com ele marcado, o save do formulário exige
 *   a consulta (manageSaveRecord). Inline edit e CSV não são bloqueados: pd-petr-cnpj-lookup trata
 *   a lista vazia como DirectD fora da hierarquia.
 * - N/ui/dialog só é usado nas funções de cliente; o módulo continua carregável no servidor
 *   (get() e manageBeforeSubmit), como pd-petr-entity.js já faz.
 */
define(
    [
        '../modules/pd-petr-constants',
        '../util/pd-petr-get-data',
        '../util/pd-petr-set-data',
        '../util/pd-petr-search-data',
        './pd-petr-data-lookup-gateway',
        'N/ui/dialog',
        'N/runtime'
    ],
    function (
        constantsModule,
        getDataUtil,
        setDataUtil,
        searchDataUtil,
        dataLookupGateway,
        dialog,
        runtime
    ) {
        const TYPE = constantsModule.VALIDATION_SETTINGS.TYPE;
        const FIELDS = constantsModule.VALIDATION_SETTINGS.FIELDS;
        const PRIVATE_FIELD_KEYS = constantsModule.VALIDATION_SETTINGS.PRIVATE_FIELD_KEYS;

        let previousValues = null;
        let cachedSettings = null;

        const AUTO_BIRTH_DATE_WARNING_TITLE = 'Aviso de cobrança adicional';
        const AUTO_BIRTH_DATE_WARNING_MESSAGE = 'Com a Busca Automática de Data de Nascimento ativa, cada CPF que não estiver na base da Hub do Desenvolvedor '
            + 'e não tiver Data de Nascimento no cadastro consumirá até 15 créditos (10 para obter a data de nascimento + 5 para a consulta na Receita Federal). '
            + 'Se o consumo ultrapassar os créditos contratados no pacote, a Hub do Desenvolvedor poderá cobrar valores adicionais.';
        const DIRECTD_CHAIN_MODE_REQUIRED_MESSAGE = 'Escolha a Consulta DirectD na Hierarquia.';

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

        function findStoredPublicSettings() {
            var stored = findStoredSettings();
            if (!stored) return null;

            var publicSettings = {};

            Object.keys(stored).forEach(function (fieldKey) {
                if (PRIVATE_FIELD_KEYS.indexOf(fieldKey) === -1) publicSettings[fieldKey] = stored[fieldKey];
            });

            return publicSettings;
        }

        function get() {
            if (cachedSettings) return cachedSettings;

            var stored = dataLookupGateway.requestData(constantsModule.DATA_LOOKUP.ACTIONS.GET_VALIDATION_SETTINGS);
            if (!stored) return null;

            var settings = Object.assign({}, stored);

            if (settings.updateAll) {
                var toggleableFields = getTogglableUpdateFields();
                Object.keys(toggleableFields).forEach(function (fieldKey) {
                    settings[fieldKey] = true;
                });
            }

            cachedSettings = settings;

            return cachedSettings;
        }

        function applyCpfDependency(currentRecord) {
            var isCpfLookupEnabled = currentRecord.getValue({ fieldId: FIELDS.enableCpfLookup.name });

            if (!isCpfLookupEnabled && currentRecord.getValue({ fieldId: FIELDS.enableAutoBirthDate.name })) {
                currentRecord.setValue({ fieldId: FIELDS.enableAutoBirthDate.name, value: false, ignoreFieldChange: true });
            }

            var field = currentRecord.getField({ fieldId: FIELDS.enableAutoBirthDate.name });
            if (field) field.isDisabled = !isCpfLookupEnabled;
        }

        function applyDirectdChainDependency(currentRecord) {
            var isDirectdInChain = currentRecord.getValue({ fieldId: FIELDS.directdInChain.name });

            if (!isDirectdInChain && currentRecord.getValue({ fieldId: FIELDS.directdChainMode.name })) {
                currentRecord.setValue({ fieldId: FIELDS.directdChainMode.name, value: '', ignoreFieldChange: true });
            }

            var field = currentRecord.getField({ fieldId: FIELDS.directdChainMode.name });
            if (field) field.isDisabled = !isDirectdInChain;
        }

        function confirmAutoBirthDate(currentRecord) {
            dialog.create({
                title: AUTO_BIRTH_DATE_WARNING_TITLE,
                message: AUTO_BIRTH_DATE_WARNING_MESSAGE,
                buttons: [
                    { label: 'Estou ciente', value: true },
                    { label: 'Cancelar', value: false }
                ]
            }).then(function (isAware) {
                if (!isAware) {
                    currentRecord.setValue({ fieldId: FIELDS.enableAutoBirthDate.name, value: false, ignoreFieldChange: true });
                }
            }).catch(function (e) {
                log.error('pd-petr-validation-settings.confirmAutoBirthDate', e);
                currentRecord.setValue({ fieldId: FIELDS.enableAutoBirthDate.name, value: false, ignoreFieldChange: true });
            });
        }

        function managePageInit(context) {
            applyUpdateAllState(context.currentRecord);
            applyCpfDependency(context.currentRecord);
            applyDirectdChainDependency(context.currentRecord);
            return true;
        }

        function manageSaveRecord(context) {
            var currentRecord = context.currentRecord;
            var isDirectdInChain = currentRecord.getValue({ fieldId: FIELDS.directdInChain.name });

            if (isDirectdInChain && !currentRecord.getValue({ fieldId: FIELDS.directdChainMode.name })) {
                dialog.alert({ title: 'Hierarquia da Consulta de CNPJ', message: DIRECTD_CHAIN_MODE_REQUIRED_MESSAGE });
                return false;
            }

            return true;
        }

        function manageFieldChanged(context) {
            var currentRecord = context.currentRecord;

            if (context.fieldId === FIELDS.updateAll.name) {
                applyUpdateAllState(currentRecord);
            } else if (context.fieldId === FIELDS.enableCpfLookup.name) {
                applyCpfDependency(currentRecord);
            } else if (context.fieldId === FIELDS.directdInChain.name) {
                applyDirectdChainDependency(currentRecord);
            } else if (context.fieldId === FIELDS.enableAutoBirthDate.name
                && currentRecord.getValue({ fieldId: FIELDS.enableAutoBirthDate.name })) {
                confirmAutoBirthDate(currentRecord);
            }

            return true;
        }

        function manageBeforeSubmit(context) {
            var types = context.UserEventType;
            if (context.type !== types.CREATE && context.type !== types.EDIT && context.type !== types.XEDIT) return;

            var newRecord = context.newRecord;
            var oldRecord = context.oldRecord;
            var submittedFields = context.type === types.XEDIT ? newRecord.getFields() : null;

            function effectiveValue(fieldId) {
                var isSubmitted = !submittedFields || submittedFields.indexOf(fieldId) !== -1;
                return isSubmitted ? newRecord.getValue({ fieldId: fieldId }) : oldRecord.getValue({ fieldId: fieldId });
            }

            var isAutoBirthDateEnabled = effectiveValue(FIELDS.enableAutoBirthDate.name);

            if (isAutoBirthDateEnabled && !effectiveValue(FIELDS.enableCpfLookup.name)) {
                newRecord.setValue({ fieldId: FIELDS.enableAutoBirthDate.name, value: false });
                return;
            }

            var wasAutoBirthDateEnabled = !!(oldRecord && oldRecord.getValue({ fieldId: FIELDS.enableAutoBirthDate.name }));

            if (!isAutoBirthDateEnabled || wasAutoBirthDateEnabled) return;

            newRecord.setValue({ fieldId: FIELDS.autoBirthDateAckAt.name, value: new Date() });

            var userId = runtime.getCurrentUser().id;
            if (userId > 0) {
                newRecord.setValue({ fieldId: FIELDS.autoBirthDateAckBy.name, value: userId });
            }

            log.audit('pd-petr-validation-settings.manageBeforeSubmit', 'Busca Automática de Data de Nascimento marcada pelo usuário ' + userId);
        }

        return {
            get: get,
            findStoredPublicSettings: findStoredPublicSettings,
            managePageInit: managePageInit,
            manageFieldChanged: manageFieldChanged,
            manageSaveRecord: manageSaveRecord,
            manageBeforeSubmit: manageBeforeSubmit
        };
    }
);

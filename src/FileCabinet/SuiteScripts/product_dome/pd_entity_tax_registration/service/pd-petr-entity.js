/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        'N/record',
        'N/error',
        'N/https',
        'N/url',
        'N/ui/dialog',
        '../modules/pd-petr-constants',
        './pd-petr-script-parameters',
        './pd-petr-vendor',
        './pd-petr-validators',
        './pd-petr-cnpj-api',
        './pd-petr-mapper',
        './pd-petr-validation-settings',
        '../util/pd-petr-search-data'
    ],
    function (
        record,
        error,
        https,
        url,
        dialog,
        constantsModule,
        scriptParametersService,
        vendorService,
        validatorsService,
        cnpjApiService,
        mapperService,
        validationSettingsService,
        searchDataUtil
    ) {
        var FIELDS = constantsModule.ENTITY.FIELDS;
        var TYPE_LIST = constantsModule.ENTITY.TYPE_LIST;

        var lastFetchedDigits = null;

        var MISSING_SETTINGS_MESSAGE = 'Não há registro de Configuração das Validações ativo nesta conta. '
            + 'Crie-o para habilitar a validação e a atualização automática dos dados da entidade. '
            + 'Em caso de dúvida, acione a equipe Dome.';

        var SUPPORT_CONTACT_MESSAGE = 'Se o problema persistir, acione a equipe Dome informando o CNPJ consultado e o horário da tentativa.';

        var MISSING_COUNTRY_MESSAGE = 'Por favor, preencha o campo País primeiro.';

        var MISSING_CNPJ_MESSAGE = 'Por favor, preencha o campo CNPJ primeiro.';

        function isNullOrEmpty(value) {
            return value === null || value === undefined || value === '';
        }

        function digitsOnly(value) {
            return String(value).toUpperCase().replace(/[^0-9A-Z]/g, '');
        }

        function isBrazil(country) {
            return !isNullOrEmpty(country) && country === scriptParametersService.getCountryBrazil();
        }

        function applyFieldState(currentRecord) {
            var country = currentRecord.getValue({ fieldId: FIELDS.country.name });
            var cnpjField = currentRecord.getField({ fieldId: FIELDS.cnpj.name });
            var internationalField = currentRecord.getField({ fieldId: FIELDS.international.name });

            if (isNullOrEmpty(country)) {
                cnpjField.isDisabled = true;
                cnpjField.isMandatory = false;
                internationalField.isDisabled = true;
                internationalField.isMandatory = false;
                return;
            }

            var brazil = isBrazil(country);

            cnpjField.isDisabled = !brazil;
            cnpjField.isMandatory = brazil;
            internationalField.isDisabled = brazil;
            internationalField.isMandatory = !brazil;
        }

        function validateFederalRegistrationFormat(value) {
            var alphanum = digitsOnly(value);

            if (alphanum.length === 14 && !validatorsService.validateCNPJ(value)) {
                return { title: 'CNPJ inválido', message: 'O CNPJ "' + value + '" é inválido.' };
            }
            if (alphanum.length === 11 && !validatorsService.validateCPF(value)) {
                return { title: 'CPF inválido', message: 'O CPF "' + value + '" é inválido.' };
            }
            return null;
        }

        function searchEntityDuplicate(field, value) {
            try {
                return searchDataUtil.first({
                    type: constantsModule.ENTITY.TYPE,
                    fields: { internalId: FIELDS.internalId },
                    filters: [
                        [FIELDS.type.name, 'anyof', [TYPE_LIST.CUSTOMER_AND_JOB]],
                        'AND',
                        [field.name, 'is', value]
                    ]
                });
            } catch (e) {
                log.error('pd-petr-entity.searchEntityDuplicate', e);
                return null;
            }
        }

        function findDuplicate(field, value, entityRecord) {
            var isVendor = entityRecord.type === TYPE_LIST.VENDOR.toLowerCase();

            var match = isVendor
                ? (field === FIELDS.cnpj ? vendorService.getByCnpjOrCpf(value) : vendorService.getByInternational(value))
                : searchEntityDuplicate(field, value);

            if (!match) return null;
            if (String(match.internalId) === String(entityRecord.id)) return null;

            return match;
        }

        function showDuplicateAlert(entityRecord) {
            var isVendor = entityRecord.type === TYPE_LIST.VENDOR.toLowerCase();
            var message = isVendor
                ? 'CNPJ/CPF já está cadastrado em um Fornecedor. <br/> Por favor, insira um CNPJ/CPF não existente na base para seguir.'
                : 'CNPJ/CPF já está cadastrado em um Cliente. <br/> Por favor, insira um CNPJ/CPF não existente na base para seguir.';

            dialog.create({ title: 'Atenção', message: message });
        }

        function showInternationalDuplicateAlert(entityRecord) {
            var isVendor = entityRecord.type === TYPE_LIST.VENDOR.toLowerCase();
            var message = isVendor
                ? 'Registro Fiscal Internacional já está cadastrado em um Fornecedor. <br/> Por favor, insira um valor único para continuar.'
                : 'Registro Fiscal Internacional já está cadastrado em um Cliente. <br/> Por favor, insira um valor único para continuar.';

            dialog.create({ title: 'Atenção', message: message });
        }

        function managePageInit(context) {
            applyFieldState(context.currentRecord);
            return true;
        }

        function manageCnpjChanged(currentRecord) {
            var value = currentRecord.getValue({ fieldId: FIELDS.cnpj.name });
            if (!value) return true;

            var settings = validationSettingsService.get();

            var formatError = validateFederalRegistrationFormat(value);
            if (formatError) {
                dialog.alert({ title: formatError.title, message: formatError.message });
                currentRecord.setValue({ fieldId: FIELDS.cnpj.name, value: '' });
                return false;
            }

            // Sem configuração não há o que habilitar; o aviso ao usuário sai no save e no
            // botão de consulta, para não alertar a cada mudança de campo.
            if (!settings) {
                log.debug({ title: 'pd-petr-entity.manageCnpjChanged', details: MISSING_SETTINGS_MESSAGE });
                return true;
            }

            if (settings.enableDupCnpj && findDuplicate(FIELDS.cnpj, value, currentRecord)) {
                showDuplicateAlert(currentRecord);
                currentRecord.setValue({ fieldId: FIELDS.cnpj.name, value: '' });
                return false;
            }

            return true;
        }

        function manageInternationalChanged(currentRecord) {
            var value = currentRecord.getValue({ fieldId: FIELDS.international.name });
            if (!value) return true;

            var settings = validationSettingsService.get();

            if (!settings) {
                log.debug({ title: 'pd-petr-entity.manageInternationalChanged', details: MISSING_SETTINGS_MESSAGE });
                return true;
            }

            if (!settings.enableDupIntl) return true;

            if (findDuplicate(FIELDS.international, value, currentRecord)) {
                showInternationalDuplicateAlert(currentRecord);
                currentRecord.setValue({ fieldId: FIELDS.international.name, value: '' });
                return false;
            }

            return true;
        }

        function manageFieldChanged(context) {
            var fieldId = context.fieldId;
            var currentRecord = context.currentRecord;

            if (fieldId === FIELDS.country.name) {
                applyFieldState(currentRecord);
                return true;
            }

            var country = currentRecord.getValue({ fieldId: FIELDS.country.name });

            if (fieldId === FIELDS.cnpj.name && isBrazil(country)) {
                return manageCnpjChanged(currentRecord);
            }

            if (fieldId === FIELDS.international.name && !isBrazil(country)) {
                return manageInternationalChanged(currentRecord);
            }

            return true;
        }

        function validateField(context) {
            var fieldId = context.fieldId;
            var currentRecord = context.currentRecord;

            if (fieldId !== FIELDS.cnpj.name) return true;

            var country = currentRecord.getValue({ fieldId: FIELDS.country.name });
            if (!isBrazil(country)) return true;

            var value = currentRecord.getValue({ fieldId: fieldId });
            if (!value) return true;

            var formatError = validateFederalRegistrationFormat(value);
            if (formatError) {
                dialog.alert({ title: formatError.title, message: formatError.message });
                currentRecord.setValue({ fieldId: fieldId, value: '' });
                return false;
            }

            return true;
        }

        function manageSaveRecord(context) {
            var currentRecord = context.currentRecord;
            var country = currentRecord.getValue({ fieldId: FIELDS.country.name });
            var settings = validationSettingsService.get();

            // Sem configuração as validações não rodam, mas o save não é bloqueado — o
            // usuário é avisado para criar o registro de configuração.
            if (!settings) {
                dialog.alert({ title: 'Configuração necessária', message: MISSING_SETTINGS_MESSAGE });
                return true;
            }

            if (isBrazil(country)) {
                var cnpj = currentRecord.getValue({ fieldId: FIELDS.cnpj.name });

                if (settings.enableDupCnpj && cnpj && findDuplicate(FIELDS.cnpj, cnpj, currentRecord)) {
                    showDuplicateAlert(currentRecord);
                    return false;
                }

                var cnpjDigits = cnpj ? digitsOnly(cnpj) : '';
                var isNewCompleteCnpj = cnpjDigits.length === 14 && cnpjDigits !== lastFetchedDigits;

                if (settings.enableAutoLookup && isNewCompleteCnpj) {
                    fetchCNPJ(currentRecord);
                }
            } else {
                if (!settings.enableDupIntl) return true;

                var intl = currentRecord.getValue({ fieldId: FIELDS.international.name });
                if (!intl) return true;

                if (findDuplicate(FIELDS.international, intl, currentRecord)) {
                    showInternationalDuplicateAlert(currentRecord);
                    return false;
                }
            }

            return true;
        }

        function fetchCNPJ(currentRecord, mode) {
            if (mode === 'view') {
                fetchCNPJViaRestlet(currentRecord);
                return;
            }

            var country = currentRecord.getValue({ fieldId: FIELDS.country.name });

            if (isNullOrEmpty(country)) {
                dialog.alert({ title: 'Consultar CNPJ', message: MISSING_COUNTRY_MESSAGE });
                return;
            }

            var value = currentRecord.getValue({ fieldId: FIELDS.cnpj.name });

            if (!value) {
                dialog.alert({ title: 'Consultar CNPJ', message: MISSING_CNPJ_MESSAGE });
                return;
            }

            var formatError = validateFederalRegistrationFormat(value);
            if (formatError) {
                dialog.alert({ title: formatError.title, message: formatError.message });
                return;
            }

            if (!validationSettingsService.get()) {
                dialog.alert({ title: 'Configuração necessária', message: MISSING_SETTINGS_MESSAGE });
                return;
            }

            var response;

            try {
                response = cnpjApiService.get(value);
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJ',
                    details: { stack: e.stack, message: e.message }
                });

                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
                    message: 'Não foi possível se comunicar com o serviço de consulta de CNPJ. ' + SUPPORT_CONTACT_MESSAGE
                });
                return;
            }

            if (response.code !== 200) {
                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
                    message: 'Não foi possível recuperar os dados da empresa. Verifique se o CNPJ está correto e tente novamente. '
                        + SUPPORT_CONTACT_MESSAGE
                });
                return;
            }

            var body;

            try {
                body = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJ',
                    details: { message: 'Resposta não é JSON', body: response.body }
                });

                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
                    message: 'O serviço de consulta devolveu uma resposta inesperada. ' + SUPPORT_CONTACT_MESSAGE
                });
                return;
            }

            var validation = validatorsService.validateApiResponse(body);
            if (!validation.valid) {
                dialog.alert({ title: validation.title, message: validation.message });
            }

            mapperService.setFields(currentRecord, body);
            lastFetchedDigits = digitsOnly(value);
        }

        function fetchCNPJViaRestlet(currentRecord) {

            // Diagnóstico: em modo View, currentRecord pode não refletir o valor de campos
            // fora da aba atualmente renderizada, mesmo com o campo preenchido no registro —
            // por isso a validação de país/CNPJ de fato acontece no servidor (fetchCNPJForRecord),
            // que carrega o record completo via record.load. Este log é só para conferência.
            log.debug({
                title: 'pd-petr-entity.fetchCNPJViaRestlet',
                details: {
                    country: currentRecord.getValue({ fieldId: FIELDS.country.name }),
                    cnpj: currentRecord.getValue({ fieldId: FIELDS.cnpj.name })
                }
            });

            var restletUrl = url.resolveScript({
                scriptId: constantsModule.SCRIPTS.RESTLET.SCRIPT_ID,
                deploymentId: constantsModule.SCRIPTS.RESTLET.DEPLOY_ID,
                returnExternalUrl: false
            });

            var response;

            try {
                response = https.post({
                    url: restletUrl,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recordType: currentRecord.type,
                        id: currentRecord.id
                    })
                });
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJViaRestlet',
                    details: { stack: e.stack, message: e.message }
                });

                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
                    message: 'Não foi possível se comunicar com o serviço de consulta. ' + SUPPORT_CONTACT_MESSAGE
                });
                return;
            }

            var isSuccessfulResponse = response.code === 200;

            if (!isSuccessfulResponse) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJViaRestlet',
                    details: { code: response.code, body: response.body }
                });

                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
                    message: 'O serviço de consulta respondeu com o código ' + response.code + '. ' + SUPPORT_CONTACT_MESSAGE
                });
                return;
            }

            var result;

            // O corpo só é JSON quando o RESTlet respondeu de fato; um HTML de erro/login
            // chegaria aqui e quebraria o parse sem tratamento.
            try {
                result = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJViaRestlet',
                    details: { message: 'Resposta não é JSON', body: response.body }
                });

                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
                    message: 'O serviço de consulta devolveu uma resposta inesperada. ' + SUPPORT_CONTACT_MESSAGE
                });
                return;
            }

            if (!result.success) {
                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
                    message: (result.error || 'Não foi possível atualizar os dados da empresa.') + ' ' + SUPPORT_CONTACT_MESSAGE
                });
                return;
            }

            if (result.warning) {
                dialog.alert({ title: result.warning.title, message: result.warning.message });
            }

            window.location.reload();
        }

        function fetchCNPJForRecord(recordType, id) {
            var entityRecord = record.load({ type: recordType, id: id, isDynamic: true });

            var country = entityRecord.getValue({ fieldId: FIELDS.country.name });
            if (isNullOrEmpty(country)) {
                return { success: false, error: MISSING_COUNTRY_MESSAGE };
            }

            var cnpj = entityRecord.getValue({ fieldId: FIELDS.cnpj.name });
            if (!cnpj) {
                return { success: false, error: MISSING_CNPJ_MESSAGE };
            }

            var formatError = validateFederalRegistrationFormat(cnpj);
            if (formatError) {
                return { success: false, error: formatError.message };
            }

            if (!validationSettingsService.get()) {
                return { success: false, error: MISSING_SETTINGS_MESSAGE };
            }

            var response;

            try {
                response = cnpjApiService.get(cnpj);
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJForRecord',
                    details: { stack: e.stack, message: e.message }
                });

                return {
                    success: false,
                    error: 'Não foi possível se comunicar com o serviço de consulta de CNPJ.'
                };
            }

            if (response.code !== 200) {
                return {
                    success: false,
                    error: 'Não foi possível recuperar os dados da empresa. Verifique se o CNPJ está correto e tente novamente.'
                };
            }

            var body;

            try {
                body = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJForRecord',
                    details: { message: 'Resposta não é JSON', body: response.body }
                });

                return {
                    success: false,
                    error: 'O serviço de consulta devolveu uma resposta inesperada.'
                };
            }

            var validation = validatorsService.validateApiResponse(body);

            mapperService.setFields(entityRecord, body);
            entityRecord.save();

            return {
                success: true,
                warning: validation.valid ? null : { title: validation.title, message: validation.message }
            };
        }

        function manageBeforeSubmitServer(context) {
            var newRecord = context.newRecord;
            var settings = validationSettingsService.get();

            if (!settings) {
                log.error({
                    title: 'pd-petr-entity.manageBeforeSubmitServer',
                    details: MISSING_SETTINGS_MESSAGE
                });
                return;
            }

            var cnpj = newRecord.getValue({ fieldId: FIELDS.cnpj.name });
            if (settings.enableDupCnpj && cnpj && findDuplicate(FIELDS.cnpj, cnpj, newRecord)) {
                throw error.create({
                    name: 'PETR_DUPLICATE_FEDERAL_REGISTRATION',
                    message: 'Registro Fiscal (CNPJ/CPF) já cadastrado.'
                });
            }

            var intl = newRecord.getValue({ fieldId: FIELDS.international.name });
            if (settings.enableDupIntl && intl && findDuplicate(FIELDS.international, intl, newRecord)) {
                throw error.create({
                    name: 'PETR_DUPLICATE_INTERNATIONAL_REGISTRATION',
                    message: 'Registro Fiscal Internacional já cadastrado.'
                });
            }
        }

        function manageCsvImport(newRecord) {
            // CSV Import entra como consulta automática (não é disparo manual pelo botão)
            var settings = validationSettingsService.get();

            if (!settings) {
                log.error({
                    title: 'pd-petr-entity.manageCsvImport',
                    details: MISSING_SETTINGS_MESSAGE
                });
                return;
            }

            if (!settings.enableAutoLookup) return;

            var country = newRecord.getValue({ fieldId: FIELDS.country.name });
            if (!isBrazil(country)) return;

            var cnpj = newRecord.getValue({ fieldId: FIELDS.cnpj.name });
            if (!cnpj) return;

            var formatError = validateFederalRegistrationFormat(cnpj);
            if (formatError || digitsOnly(cnpj).length !== 14) {
                log.debug('pd-petr-entity.manageCsvImport', 'CNPJ "' + cnpj + '" não é válido — pulando enriquecimento.');
                return;
            }

            // O enriquecimento não pode abortar a importação: uma exceção aqui sobe até o
            // beforeSubmit do User Event e cancela o submit, impedindo a criação do registro.
            // Timeout, falha de conexão e estouro de governança lançam exceção; status HTTP
            // (429/404/500) não lança e é tratado pelo response.code abaixo.
            try {

                var response = cnpjApiService.get(cnpj);

                if (response.code !== 200) {
                    log.debug('pd-petr-entity.manageCsvImport', 'BrasilAPI retornou status ' + response.code + ' — pulando.');
                    return;
                }

                var body = JSON.parse(response.body);
                mapperService.setFields(newRecord, body);

            } catch (e) {

                log.error({
                    title: 'pd-petr-entity.manageCsvImport',
                    details: {
                        cnpj: cnpj,
                        message: 'Enriquecimento não executado — registro importado sem os dados da BrasilAPI.',
                        errorName: e.name,
                        errorMessage: e.message,
                        stack: e.stack
                    }
                });

            }
        }

        return {
            managePageInit: managePageInit,
            manageFieldChanged: manageFieldChanged,
            validateField: validateField,
            manageSaveRecord: manageSaveRecord,
            fetchCNPJ: fetchCNPJ,
            fetchCNPJForRecord: fetchCNPJForRecord,
            manageBeforeSubmitServer: manageBeforeSubmitServer,
            manageCsvImport: manageCsvImport
        };
    }
);

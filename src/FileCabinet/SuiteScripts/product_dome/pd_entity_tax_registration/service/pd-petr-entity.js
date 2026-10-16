/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Este arquivo é importado pelo Client Script, então NÃO pode depender (nem
 * transitivamente) de módulos que só existem no servidor — o carregamento AMD é eager e
 * quebraria no navegador antes de qualquer função rodar. Por isso tudo que usa
 * pd-petr-cnpj-lookup (que puxa N/cache via pd-petr-rate-limiter) mora em
 * pd-petr-entity-lookup.js, importado só pelo RESTlet e pelo User Event.
 *
 * - Popup de carregamento: mostrado durante a chamada síncrona ao RESTlet. O hide() só roda
 *   no finally, depois de TODO o tratamento da resposta — escondido logo após o HTTP voltar,
 *   show()+hide() aconteciam quase juntos e o navegador não chegava a pintar o popup. A
 *   duration do popup é só rede de segurança para ele não ficar preso.
 * - fetchCompanyDataViaRestlet (create/edit): o RESTlet só consulta; o preenchimento continua
 *   no cliente via mapperService.setFields. Nunca lança — url.resolveScript fica dentro do try
 *   (antes, uma exceção ali deixava o popup travado sem erro para o usuário).
 * - fetchCNPJViaRestlet (view): o RESTlet carrega, preenche e salva o record. Em view o
 *   currentRecord pode não refletir campos fora da aba renderizada, por isso a validação de
 *   país/CNPJ acontece no servidor; o log local é só para conferência.
 * - O corpo da resposta só é JSON quando o RESTlet respondeu de fato — um HTML de erro/login
 *   quebraria o parse, por isso o try aninhado com mensagem própria.
 * - Sem registro de Configuração das Validações as validações não rodam, mas o save não é
 *   bloqueado: o aviso sai no save e no botão, não a cada mudança de campo.
 * - A Data de Nascimento do formulário vai ao RESTlet já como DD/MM/AAAA, montada com o fuso do
 *   navegador (formatBirthDate) — serializar o Date em JSON viraria ISO em UTC e poderia trocar o
 *   dia. BIRTH_DATE_REQUIRED tem aviso próprio, sem a mensagem de suporte (não é erro).
 * - CPF (11 caracteres) usa o mesmo botão e o mesmo disparo automático do save, mas só quando
 *   "Consultar CPF (Hub)" está marcado — desmarcado, o botão avisa sem chamar o servidor e o
 *   save não consulta (cada consulta de CPF custa de 1 a 15 créditos na Hub).
 */
define(
    [
        'N/error',
        'N/https',
        'N/url',
        'N/ui/dialog',
        'N/ui/message',
        '../modules/pd-petr-constants',
        './pd-petr-script-parameters',
        './pd-petr-vendor',
        './pd-petr-validators',
        './pd-petr-mapper',
        './pd-petr-validation-settings',
        '../util/pd-petr-search-data'
    ],
    function (
        error,
        https,
        url,
        dialog,
        message,
        constantsModule,
        scriptParametersService,
        vendorService,
        validatorsService,
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

        var SUPPORT_CONTACT_MESSAGE = 'Se o problema persistir, acione a equipe Dome informando o CPF/CNPJ consultado e o horário da tentativa.';
        var CPF_LOOKUP_DISABLED_MESSAGE = 'A consulta de CPF está desabilitada. Para habilitar, marque "Consultar CPF (Hub)" no registro de Configuração das Validações.';

        var MISSING_COUNTRY_MESSAGE = 'Por favor, preencha o campo País primeiro.';

        var MISSING_CNPJ_MESSAGE = 'Por favor, preencha o campo CNPJ primeiro.';

        function showLoadingMessage() {
            var loadingMessage = message.create({
                title: 'Aguarde!',
                message: 'Consultando dados do CPF/CNPJ...',
                type: message.Type.INFORMATION
            });
            loadingMessage.show({ duration: 10000 });
            return loadingMessage;
        }

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
                var isLookupableDocument = cnpjDigits.length === 14
                    || (cnpjDigits.length === 11 && settings.enableCpfLookup);
                var isNewCompleteDocument = isLookupableDocument && cnpjDigits !== lastFetchedDigits;

                if (settings.enableAutoLookup && isNewCompleteDocument) {
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

            var settings = validationSettingsService.get();

            if (!settings) {
                dialog.alert({ title: 'Configuração necessária', message: MISSING_SETTINGS_MESSAGE });
                return;
            }

            if (digitsOnly(value).length === 11 && !settings.enableCpfLookup) {
                dialog.alert({ title: 'Consulta de CPF desabilitada', message: CPF_LOOKUP_DISABLED_MESSAGE });
                return;
            }

            var loadingMessage = showLoadingMessage();

            try {
                var birthDate = formatBirthDate(currentRecord.getValue({ fieldId: FIELDS.birthDate.name }));
                var result = fetchCompanyDataViaRestlet(value, birthDate);

                if (!result.success && result.reason === 'BIRTH_DATE_REQUIRED') {
                    dialog.alert({ title: 'Data de Nascimento necessária', message: result.error });
                    return;
                }

                if (!result.success) {
                    dialog.alert({
                        title: 'Erro ao consultar CPF/CNPJ',
                        message: (result.error || 'Não foi possível recuperar os dados da empresa.') + ' ' + SUPPORT_CONTACT_MESSAGE
                    });
                    return;
                }

                var validation = validatorsService.validateApiResponse(result.data);
                if (!validation.valid) {
                    dialog.alert({ title: validation.title, message: validation.message });
                }

                var mapResult = mapperService.setFields(currentRecord, result.data);
                lastFetchedDigits = digitsOnly(value);

                if (mapResult && mapResult.warning) {
                    dialog.alert({ title: mapResult.warning.title, message: mapResult.warning.message });
                }
            } finally {
                loadingMessage.hide();
            }
        }

        function formatBirthDate(value) {
            if (!value || typeof value.getDate !== 'function') return undefined;

            var day = value.getDate();
            var month = value.getMonth() + 1;

            return (day < 10 ? '0' : '') + day + '/' + (month < 10 ? '0' : '') + month + '/' + value.getFullYear();
        }

        function fetchCompanyDataViaRestlet(cnpj, birthDate) {
            try {
                var restletUrl = url.resolveScript({
                    scriptId: constantsModule.SCRIPTS.RESTLET.SCRIPT_ID,
                    deploymentId: constantsModule.SCRIPTS.RESTLET.DEPLOY_ID,
                    returnExternalUrl: false
                });

                var response = https.post({
                    url: restletUrl,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cnpj: cnpj, birthDate: birthDate })
                });

                if (response.code !== 200) {
                    log.error({
                        title: 'pd-petr-entity.fetchCompanyDataViaRestlet',
                        details: { code: response.code, body: response.body }
                    });

                    return {
                        success: false,
                        error: 'O serviço de consulta respondeu com o código ' + response.code + '. ' + SUPPORT_CONTACT_MESSAGE
                    };
                }

                try {
                    return JSON.parse(response.body);
                } catch (parseError) {
                    log.error({
                        title: 'pd-petr-entity.fetchCompanyDataViaRestlet',
                        details: { message: 'Resposta não é JSON', body: response.body }
                    });

                    return {
                        success: false,
                        error: 'O serviço de consulta devolveu uma resposta inesperada. ' + SUPPORT_CONTACT_MESSAGE
                    };
                }
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCompanyDataViaRestlet',
                    details: { stack: e.stack, message: e.message }
                });

                return {
                    success: false,
                    error: 'Não foi possível se comunicar com o serviço de consulta. ' + SUPPORT_CONTACT_MESSAGE
                };
            }
        }

        function fetchCNPJViaRestlet(currentRecord) {

            log.debug({
                title: 'pd-petr-entity.fetchCNPJViaRestlet',
                details: {
                    country: currentRecord.getValue({ fieldId: FIELDS.country.name }),
                    cnpj: currentRecord.getValue({ fieldId: FIELDS.cnpj.name })
                }
            });

            var loadingMessage = showLoadingMessage();

            try {
                var restletUrl = url.resolveScript({
                    scriptId: constantsModule.SCRIPTS.RESTLET.SCRIPT_ID,
                    deploymentId: constantsModule.SCRIPTS.RESTLET.DEPLOY_ID,
                    returnExternalUrl: false
                });

                var response = https.post({
                    url: restletUrl,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recordType: currentRecord.type,
                        id: currentRecord.id
                    })
                });

                var isSuccessfulResponse = response.code === 200;

                if (!isSuccessfulResponse) {
                    log.error({
                        title: 'pd-petr-entity.fetchCNPJViaRestlet',
                        details: { code: response.code, body: response.body }
                    });

                    dialog.alert({
                        title: 'Erro ao consultar CPF/CNPJ',
                        message: 'O serviço de consulta respondeu com o código ' + response.code + '. ' + SUPPORT_CONTACT_MESSAGE
                    });
                    return;
                }

                var result;

                try {
                    result = JSON.parse(response.body);
                } catch (e) {
                    log.error({
                        title: 'pd-petr-entity.fetchCNPJViaRestlet',
                        details: { message: 'Resposta não é JSON', body: response.body }
                    });

                    dialog.alert({
                        title: 'Erro ao consultar CPF/CNPJ',
                        message: 'O serviço de consulta devolveu uma resposta inesperada. ' + SUPPORT_CONTACT_MESSAGE
                    });
                    return;
                }

                if (!result.success) {
                    dialog.alert({
                        title: 'Erro ao consultar CPF/CNPJ',
                        message: (result.error || 'Não foi possível atualizar os dados da empresa.') + ' ' + SUPPORT_CONTACT_MESSAGE
                    });
                    return;
                }

                if (result.warning) {
                    dialog.alert({ title: result.warning.title, message: result.warning.message });
                }

                window.location.reload();
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJViaRestlet',
                    details: { stack: e.stack, message: e.message }
                });

                dialog.alert({
                    title: 'Erro ao consultar CPF/CNPJ',
                    message: 'Não foi possível se comunicar com o serviço de consulta. ' + SUPPORT_CONTACT_MESSAGE
                });
            } finally {
                loadingMessage.hide();
            }
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

        return {
            managePageInit: managePageInit,
            manageFieldChanged: manageFieldChanged,
            validateField: validateField,
            manageSaveRecord: manageSaveRecord,
            fetchCNPJ: fetchCNPJ,
            manageBeforeSubmitServer: manageBeforeSubmitServer
        };
    }
);

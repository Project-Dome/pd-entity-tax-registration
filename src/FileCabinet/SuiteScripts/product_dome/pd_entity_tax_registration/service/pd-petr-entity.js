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

        var SUPPORT_CONTACT_MESSAGE = 'Se o problema persistir, acione a equipe Dome informando o CNPJ consultado e o horário da tentativa.';

        var MISSING_COUNTRY_MESSAGE = 'Por favor, preencha o campo País primeiro.';

        var MISSING_CNPJ_MESSAGE = 'Por favor, preencha o campo CNPJ primeiro.';

        // Feedback visual durante a chamada síncrona ao RESTlet — sem isso a tela fica travada
        // sem nenhum indicativo até a resposta voltar (button, autofetch no save e modo view).
        function showLoadingMessage() {
            var loadingMessage = message.create({
                title: 'Aguarde!',
                message: 'Consultando dados do CNPJ...',
                type: message.Type.INFORMATION
            });
            // duration é rede de segurança: o hide() explícito (try/finally nos call sites)
            // já cobre o fluxo normal — isso só garante que o popup não fique preso pra sempre
            // em algum cenário não previsto.
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

            var loadingMessage = showLoadingMessage();

            // O hide() só roda no finally, depois de TODO o tratamento do resultado (dialog de
            // erro ou setFields) — não logo após a chamada HTTP retornar. Quando a resposta é
            // rápida, esconder o popup ali (antes de checar sucesso/erro e preencher os campos)
            // fazia show()+hide() acontecerem quase no mesmo instante, sem o navegador ter tempo
            // de pintar a mensagem na tela: parecia que o popup "não aparecia".
            try {
                var result = fetchCompanyDataViaRestlet(value);

                if (!result.success) {
                    dialog.alert({
                        title: 'Erro ao consultar CNPJ',
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

                // Aviso específico do preenchimento (ex.: Cidade não identificada
                // automaticamente) — distinto do aviso de qualidade dos dados acima.
                if (mapResult && mapResult.warning) {
                    dialog.alert({ title: mapResult.warning.title, message: mapResult.warning.message });
                }
            } finally {
                loadingMessage.hide();
            }
        }

        // Chamada ao RESTlet só de consulta (sem carregar/salvar nenhum record) — usada no
        // fluxo de create/edit (botão e autofetch do save). O preenchimento de campos continua
        // acontecendo aqui, no cliente, via mapperService.setFields — só a chamada HTTP externa
        // (com o token do ReceitaWS) é que sai do navegador. Diferente de fetchCNPJViaRestlet
        // (abaixo), que é exclusiva do modo view: lá o record já tem id e setValue não funciona
        // em view, então quem carrega/preenche/salva é o próprio RESTlet.
        // Nunca lança exceção — inclusive url.resolveScript entra no try. Antes ele ficava
        // fora, e uma exceção ali (ex.: deployment sem acesso pro papel do usuário) subia sem
        // ser capturada em lugar nenhum, e o chamador (fetchCNPJ) nunca chegava no
        // loadingMessage.hide() — popup travado, silenciosamente, sem erro nenhum pro usuário.
        function fetchCompanyDataViaRestlet(cnpj) {
            try {
                var restletUrl = url.resolveScript({
                    scriptId: constantsModule.SCRIPTS.RESTLET.SCRIPT_ID,
                    deploymentId: constantsModule.SCRIPTS.RESTLET.DEPLOY_ID,
                    returnExternalUrl: false
                });

                var response = https.post({
                    url: restletUrl,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cnpj: cnpj })
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

                // O corpo só é JSON quando o RESTlet respondeu de fato; um HTML de erro/login
                // chegaria aqui e quebraria o parse — try aninhado só pra manter a mensagem
                // específica desse caso, distinta da falha de comunicação do catch de fora.
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

            var loadingMessage = showLoadingMessage();

            // Mesmo motivo do fetchCNPJ: o hide() só roda no finally, depois de TODO o
            // tratamento da resposta (erro ou reload) — não logo após o https.post retornar.
            // Escondido cedo demais, o popup não chegava a ser pintado na tela numa resposta
            // rápida (show()+hide() quase no mesmo instante).
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
            } catch (e) {
                log.error({
                    title: 'pd-petr-entity.fetchCNPJViaRestlet',
                    details: { stack: e.stack, message: e.message }
                });

                dialog.alert({
                    title: 'Erro ao consultar CNPJ',
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

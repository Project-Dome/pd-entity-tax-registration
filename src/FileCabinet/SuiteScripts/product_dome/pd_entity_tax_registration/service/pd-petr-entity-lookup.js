/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Parte SERVER-ONLY do enriquecimento de entidade: tudo que depende de
 * pd-petr-cnpj-lookup (que por sua vez depende de N/cache, via pd-petr-rate-limiter).
 *
 * Está separado de pd-petr-entity.js de propósito: aquele arquivo é importado também pelo
 * Client Script, e o carregamento de módulos AMD é eager — o navegador tentaria carregar
 * N/cache (que só existe no lado servidor) e quebraria com "Module does not exist: N/cache.js",
 * mesmo sem o cliente jamais chamar estas funções. Só RESTlet e User Event importam este
 * arquivo; o Client Script nunca.
 *
 * - fetchCNPJForRecord: ação do RESTlet para o modo view — carrega o record por id, consulta,
 *   preenche e salva no servidor (em view o setValue do cliente não funciona). Prioriza o
 *   aviso de qualidade dos dados; senão, repassa o aviso do preenchimento do endereço.
 * - fetchCompanyDataForCnpj: ação do RESTlet para create/edit (por CNPJ, sem tocar em record).
 * - manageCsvImport: o CSV Import conta como consulta automática. O enriquecimento não pode
 *   abortar a importação — uma exceção subiria até o beforeSubmit e cancelaria o submit; o
 *   try/catch é defensivo, já que getCompanyData nunca lança.
 */
define(
    [
        'N/record',
        '../modules/pd-petr-constants',
        './pd-petr-script-parameters',
        './pd-petr-validators',
        './pd-petr-cnpj-lookup',
        './pd-petr-mapper',
        './pd-petr-validation-settings'
    ],
    function (
        record,
        constantsModule,
        scriptParametersService,
        validatorsService,
        cnpjLookupService,
        mapperService,
        validationSettingsService
    ) {
        var FIELDS = constantsModule.ENTITY.FIELDS;

        var MISSING_SETTINGS_MESSAGE = 'Não há registro de Configuração das Validações ativo nesta conta. '
            + 'Crie-o para habilitar a validação e a atualização automática dos dados da entidade. '
            + 'Em caso de dúvida, acione a equipe Dome.';

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

            var result = cnpjLookupService.getCompanyData(cnpj, {
                birthDate: entityRecord.getValue({ fieldId: FIELDS.birthDate.name })
            });

            if (!result.success) {
                return { success: false, error: result.error };
            }

            var validation = validatorsService.validateApiResponse(result.data);

            var mapResult = mapperService.setFields(entityRecord, result.data);
            entityRecord.save();

            var warning = !validation.valid
                ? { title: validation.title, message: validation.message }
                : (mapResult && mapResult.warning) || null;

            return { success: true, warning: warning };
        }

        function fetchCompanyDataForCnpj(cnpj, birthDate) {
            return cnpjLookupService.getCompanyData(cnpj, { birthDate: birthDate });
        }

        function manageCsvImport(newRecord) {
            var settings = validationSettingsService.get();

            if (!settings) {
                log.error({
                    title: 'pd-petr-entity-lookup.manageCsvImport',
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
            var documentLength = digitsOnly(cnpj).length;
            var isLookupableDocument = documentLength === 14
                || (documentLength === 11 && settings.enableCpfLookup);

            if (formatError || !isLookupableDocument) {
                log.debug('pd-petr-entity-lookup.manageCsvImport', 'CNPJ "' + cnpj + '" não é válido — pulando enriquecimento.');
                return;
            }

            try {

                var result = cnpjLookupService.getCompanyData(cnpj, {
                    birthDate: newRecord.getValue({ fieldId: FIELDS.birthDate.name })
                });

                if (!result.success) {
                    log.debug('pd-petr-entity-lookup.manageCsvImport', result.error + ' — pulando enriquecimento.');
                    return;
                }

                mapperService.setFields(newRecord, result.data);

            } catch (e) {

                log.error({
                    title: 'pd-petr-entity-lookup.manageCsvImport',
                    details: {
                        cnpj: cnpj,
                        message: 'Enriquecimento não executado — registro importado sem os dados enriquecidos.',
                        errorName: e.name,
                        errorMessage: e.message,
                        stack: e.stack
                    }
                });

            }
        }

        return {
            fetchCNPJForRecord: fetchCNPJForRecord,
            fetchCompanyDataForCnpj: fetchCompanyDataForCnpj,
            manageCsvImport: manageCsvImport
        };
    }
);

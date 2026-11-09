/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Parte SERVER-ONLY do enriquecimento de entidade: tudo que depende de
 * pd-petr-cnpj-lookup (que por sua vez depende de N/cache, via pd-petr-rate-limiter) e de
 * pd-petr-directd-lookup (N/record/N/search, via pd-petr-credit-usage).
 *
 * Está separado de pd-petr-entity.js de propósito: aquele arquivo é importado também pelo
 * Client Script, e o carregamento de módulos AMD é eager — o navegador tentaria carregar
 * N/cache (que só existe no lado servidor) e quebraria com "Module does not exist: N/cache.js",
 * mesmo sem o cliente jamais chamar estas funções. Só RESTlet e User Event importam este
 * arquivo; o Client Script nunca.
 *
 * - Modo de consulta (LOOKUP_MODES): DEFAULT usa a hierarquia ReceitaWS → Hub → DirectD
 *   (pd-petr-cnpj-lookup); DD_FULL, DD_PLUS, DD_BASIC e DD_IE são os botões da DirectD e chamam
 *   pd-petr-directd-lookup direto. Modo desconhecido ou ausente vira DEFAULT.
 * - fetchCNPJForRecord: ação do RESTlet para o modo view — carrega o record por id, consulta,
 *   preenche e salva no servidor (em view o setValue do cliente não funciona). No DD_IE a UF vem
 *   do endereço do record carregado. Os avisos (qualidade dos dados, consulta e preenchimento)
 *   são juntados num só, porque a tela recarrega depois. Também é a ação usada pela atualização
 *   em massa do Painel do Cadastro Fiscal, que interrompe pelo reason (MISSING_SETTINGS sem o
 *   registro de Validações) e espera retryAfterSeconds no RATE_LIMIT_NO_FALLBACK.
 * - fetchCompanyDataForCnpj: ação do RESTlet para create/edit (por CNPJ, sem tocar em record).
 *   No DD_IE a UF chega do Client Script.
 * - manageCsvImport: o CSV Import conta como consulta automática (sempre DEFAULT). O
 *   enriquecimento não pode abortar a importação — uma exceção subiria até o beforeSubmit e
 *   cancelaria o submit; o try/catch é defensivo, já que getCompanyData nunca lança.
 * - DD_IE não passa pela validação de situação cadastral: o retorno só traz a IE.
 */
define(
    [
        'N/record',
        '../modules/pd-petr-constants',
        './pd-petr-script-parameters',
        './pd-petr-validators',
        './pd-petr-cnpj-lookup',
        './pd-petr-directd-lookup',
        './pd-petr-mapper',
        './pd-petr-validation-settings'
    ],
    function (
        record,
        constantsModule,
        scriptParametersService,
        validatorsService,
        cnpjLookupService,
        directdLookupService,
        mapperService,
        validationSettingsService
    ) {
        var FIELDS = constantsModule.ENTITY.FIELDS;
        var MODES = constantsModule.LOOKUP_MODES;

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

        function normalizeMode(lookupMode) {
            return MODES[lookupMode] ? lookupMode : MODES.DEFAULT;
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

        function lookup(cnpj, lookupMode, options) {
            if (lookupMode === MODES.DEFAULT) {
                return cnpjLookupService.getCompanyData(cnpj, { birthDate: options.birthDate });
            }

            return directdLookupService.lookup(lookupMode, cnpj, { uf: options.uf });
        }

        function mergeWarnings(warnings) {
            var present = warnings.filter(Boolean);

            if (!present.length) return null;
            if (present.length === 1) return present[0];

            return {
                title: present[0].title,
                message: present.map(function (warning) { return warning.message; }).join('<br/><br/>')
            };
        }

        function fetchCNPJForRecord(recordType, id, lookupMode) {
            var mode = normalizeMode(lookupMode);
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
                return { success: false, error: MISSING_SETTINGS_MESSAGE, reason: 'MISSING_SETTINGS' };
            }

            var result = lookup(cnpj, mode, {
                birthDate: entityRecord.getValue({ fieldId: FIELDS.birthDate.name }),
                uf: mode === MODES.DD_IE ? mapperService.findAddressState(entityRecord) : undefined
            });

            if (!result.success) {
                return { success: false, error: result.error, reason: result.reason, retryAfterSeconds: result.retryAfterSeconds };
            }

            var validation = mode === MODES.DD_IE ? { valid: true } : validatorsService.validateApiResponse(result.data);

            var mapResult = mapperService.setFields(entityRecord, result.data, mapperService.buildMapOptions(result, mode));
            entityRecord.save();

            var warning = mergeWarnings([
                validation.valid ? null : { title: validation.title, message: validation.message },
                result.warning,
                mapResult && mapResult.warning
            ]);

            return { success: true, warning: warning };
        }

        function fetchCompanyDataForCnpj(cnpj, birthDate, lookupMode, uf) {
            return lookup(cnpj, normalizeMode(lookupMode), { birthDate: birthDate, uf: uf });
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

                mapperService.setFields(newRecord, result.data, mapperService.buildMapOptions(result, MODES.DEFAULT));

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

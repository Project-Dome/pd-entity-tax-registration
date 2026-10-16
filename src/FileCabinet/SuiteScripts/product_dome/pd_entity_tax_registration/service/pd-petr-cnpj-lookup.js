/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Orquestra ReceitaWS -> Hub do Desenvolvedor (ordem fixa, não configurável — ver
 * docs/specs/multi-provider-cnpj-lookup.md, §4). Nunca lança exceção: toda falha de rede,
 * timeout ou parse é capturada internamente.
 *
 * - tryReceitaWs devolve rateLimited para diferenciar "cota estourada" (preventivo ou HTTP 429)
 *   de outras falhas. HTTP 429 do próprio ReceitaWS conta como cota estourada mesmo com o
 *   contador local achando que havia cota (rede de segurança do cache não transacional).
 * - Se o ReceitaWS falhou por rate limit e a Hub está desabilitada, a mensagem explica a causa
 *   e quanto tempo falta, em vez do erro genérico de "nenhum provedor disponível".
 * - A Hub sinaliza erro (token inválido, sem saldo, CNPJ não encontrado) com HTTP 200 e
 *   status=false no corpo.
 * - A opção de consultar Inscrição Estadual vem do registro de Configuração das Validações;
 *   sem esse registro, a IE não é consultada.
 * - getCompanyData desvia documentos de 11 caracteres (CPF) para getPersonData, que consulta só
 *   a Hub. Assim botão, modo view e CSV Import atendem CPF sem duplicar o fluxo. Exige
 *   "Consultar CPF (Hub)" marcado e a Hub habilitada com token.
 * - Fluxo do CPF (docs/specs/hub-credit-control.md, §4.3): last_update=2 (grátis) diz se o CPF
 *   está na base da Hub. Na base, v2/cpf só com o CPF (1 crédito). Fora da base, a consulta na
 *   Receita exige data de nascimento: usa a do cadastro (options.birthDate, 5 créditos); sem
 *   ela, só busca no v2/nome_cpf (10 créditos) com "Busca Automática de Data de Nascimento (Hub)"
 *   marcada — senão devolve BIRTH_DATE_REQUIRED sem gastar créditos.
 * - toHubDate normaliza a data para DD/MM/AAAA: chega como Date (record no servidor), como texto
 *   ISO ou já como DD/MM/AAAA (enviada pelo Client Script via RESTlet).
 * - Toda chamada à Hub passa o corpo parseado para creditUsageService.track, que grava o consumo
 *   ("consumed") com o tipo de consulta. tryHub cobre o CNPJ; callHub, as chamadas de CPF.
 * - callHub concentra o tratamento de falha das chamadas de CPF; exceção na chamada é tratada
 *   como timeout, já que a consulta on-line na Receita pode demorar mais que o limite do N/https.
 */
define(
    [
        './pd-petr-api-settings',
        './pd-petr-validation-settings',
        '../util/pd-petr-rate-limiter',
        './pd-petr-receitaws-api',
        './pd-petr-receitaws-adapter',
        './pd-petr-hub-api',
        './pd-petr-hub-adapter',
        './pd-petr-hub-credit-usage',
        '../modules/pd-petr-constants'
    ],
    function (
        apiSettingsService,
        validationSettingsService,
        rateLimiter,
        receitawsApiService,
        receitawsAdapter,
        hubApiService,
        hubAdapter,
        creditUsageService,
        constantsModule
    ) {
        var QUERY_TYPES = constantsModule.HUB_CREDIT_USAGE.QUERY_TYPES;

        var RATE_LIMIT_KEY = 'pd_petr_rws';
        var RATE_LIMIT_WINDOW_SECONDS = 60;

        var NO_SETTINGS_MESSAGE = 'Nenhum provedor de consulta habilitado. Configure o registro de Configuração das APIs.';
        var NO_PROVIDER_AVAILABLE_MESSAGE = 'Não foi possível consultar os dados do CNPJ em nenhum provedor disponível.';
        var CPF_LOOKUP_DISABLED_MESSAGE = 'A consulta de CPF está desabilitada. Para habilitar, marque "Consultar CPF (Hub)" no registro de Configuração das Validações.';
        var CPF_NO_PROVIDER_MESSAGE = 'A consulta de CPF exige a Hub do Desenvolvedor habilitada e com token no registro de Configuração das APIs.';
        var CPF_FAILURE_MESSAGE = 'Não foi possível consultar os dados do CPF na Hub do Desenvolvedor.';
        var CPF_BIRTH_DATE_NOT_FOUND_MESSAGE = 'O CPF não está na base da Hub do Desenvolvedor e não foi possível obter a data de nascimento necessária para consultá-lo na Receita Federal. Preencha os dados manualmente.';
        var CPF_BIRTH_DATE_REQUIRED_MESSAGE = 'O CPF não está na base da Hub do Desenvolvedor. Para consultá-lo na Receita Federal, preencha o campo Data de Nascimento do cadastro e consulte novamente.';
        var CPF_TIMEOUT_MESSAGE = 'A consulta do CPF na Receita Federal não respondeu a tempo ou falhou na comunicação. Tente novamente em alguns minutos.';

        function getCompanyData(cnpj, options) {
            if (String(cnpj).toUpperCase().replace(/[^0-9A-Z]/g, '').length === 11) {
                return getPersonData(cnpj, options || {});
            }

            var settings = apiSettingsService.get();

            if (!settings) {
                return { success: false, reason: 'NO_PROVIDER_AVAILABLE', error: NO_SETTINGS_MESSAGE };
            }

            var rateLimited = false;

            if (settings.rwsEnabled) {
                var receitaWsResult = tryReceitaWs(cnpj, settings);

                if (receitaWsResult.success) {
                    return { success: true, provider: 'RECEITAWS', data: receitaWsResult.data };
                }

                rateLimited = receitaWsResult.rateLimited;
            }

            if (settings.hubEnabled) {
                var hubResult = tryHub(cnpj, settings);

                if (hubResult.success) {
                    return { success: true, provider: 'HUB', data: hubResult.data };
                }
            } else if (rateLimited) {
                return buildRateLimitNoFallbackResult(settings);
            }

            return { success: false, reason: 'NO_PROVIDER_AVAILABLE', error: NO_PROVIDER_AVAILABLE_MESSAGE };
        }

        function buildRateLimitNoFallbackResult(settings) {
            var retryAfterSeconds = rateLimiter.getRetryAfterSeconds(RATE_LIMIT_WINDOW_SECONDS);

            return {
                success: false,
                reason: 'RATE_LIMIT_NO_FALLBACK',
                retryAfterSeconds: retryAfterSeconds,
                error: 'Limite de ' + settings.rwsRateLimit + ' consultas por minuto do ReceitaWS atingido e o '
                    + 'provedor Hub do Desenvolvedor está desabilitado. Aguarde aproximadamente ' + retryAfterSeconds
                    + ' segundos e tente novamente.'
            };
        }

        function tryReceitaWs(cnpj, settings) {
            var hasQuota = rateLimiter.consume(RATE_LIMIT_KEY, settings.rwsRateLimit, RATE_LIMIT_WINDOW_SECONDS);

            if (!hasQuota) {
                log.debug('pd-petr-cnpj-lookup.tryReceitaWs', 'Sem cota disponível no rate limiter local — pulando para a Hub do Desenvolvedor.');
                return { success: false, rateLimited: true };
            }

            var response;

            try {
                response = receitawsApiService.get(cnpj, { token: settings.rwsToken });
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryReceitaWs',
                    details: { stack: e.stack, message: e.message }
                });
                return { success: false, rateLimited: false };
            }

            if (response.code === 429) {
                log.debug('pd-petr-cnpj-lookup.tryReceitaWs', 'ReceitaWS retornou HTTP 429 — pulando para a Hub do Desenvolvedor.');
                return { success: false, rateLimited: true };
            }

            if (response.code !== 200) {
                log.error('pd-petr-cnpj-lookup.tryReceitaWs', 'HTTP ' + response.code + ' — pulando para a Hub do Desenvolvedor.');
                return { success: false, rateLimited: false };
            }

            var body;

            try {
                body = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryReceitaWs',
                    details: { message: 'Resposta não é JSON', body: response.body }
                });
                return { success: false, rateLimited: false };
            }

            if (body.status === 'ERROR') {
                log.debug('pd-petr-cnpj-lookup.tryReceitaWs', 'ReceitaWS retornou status ERROR: ' + body.message);
                return { success: false, rateLimited: false };
            }

            return { success: true, data: receitawsAdapter.toCanonical(body) };
        }

        function tryHub(cnpj, settings) {
            if (!settings.hubToken) {
                log.error('pd-petr-cnpj-lookup.tryHub', 'Hub do Desenvolvedor habilitada sem token configurado — consulta não realizada.');
                return { success: false };
            }

            var validationSettings = validationSettingsService.get();
            var includeStateRegistration = !!(validationSettings && validationSettings.enableStateRegLookup);

            var response;

            try {
                response = hubApiService.get(cnpj, {
                    token: settings.hubToken,
                    includeStateRegistration: includeStateRegistration
                });
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryHub',
                    details: { stack: e.stack, message: e.message }
                });
                return { success: false };
            }

            if (response.code !== 200) {
                log.error('pd-petr-cnpj-lookup.tryHub', 'HTTP ' + response.code);
                return { success: false };
            }

            var body;

            try {
                body = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.tryHub',
                    details: { message: 'Resposta não é JSON', body: response.body }
                });
                return { success: false };
            }

            creditUsageService.track(
                body,
                includeStateRegistration ? QUERY_TYPES.CNPJ_WITH_STATE_REGISTRATION : QUERY_TYPES.CNPJ,
                cnpj
            );

            if (body.status !== true || !body.result) {
                log.error('pd-petr-cnpj-lookup.tryHub', 'Hub retornou erro: ' + body.message);
                return { success: false };
            }

            return { success: true, data: hubAdapter.toCanonical(body.result) };
        }

        function getPersonData(cpf, lookupOptions) {
            var validationSettings = validationSettingsService.get();

            if (!validationSettings || !validationSettings.enableCpfLookup) {
                return { success: false, reason: 'CPF_LOOKUP_DISABLED', error: CPF_LOOKUP_DISABLED_MESSAGE };
            }

            var settings = apiSettingsService.get();

            if (!settings || !settings.hubEnabled || !settings.hubToken) {
                return { success: false, reason: 'NO_PROVIDER_AVAILABLE', error: CPF_NO_PROVIDER_MESSAGE };
            }

            var options = { token: settings.hubToken };

            var lastUpdate = callHub(hubApiService.getCpfLastUpdate, cpf, options, QUERY_TYPES.CPF_DATABASE_CHECK);
            if (lastUpdate.failure) return lastUpdate.failure;

            var isInHubDatabase = lastUpdate.body.status === true;

            log.debug('pd-petr-cnpj-lookup.getPersonData', 'CPF na base da Hub: ' + isInHubDatabase);

            if (!isInHubDatabase) {
                var birthDate = toHubDate(lookupOptions.birthDate);

                if (!birthDate) {
                    if (!validationSettings.enableAutoBirthDate) {
                        return { success: false, reason: 'BIRTH_DATE_REQUIRED', error: CPF_BIRTH_DATE_REQUIRED_MESSAGE };
                    }

                    var nameAndBirthDate = callHub(hubApiService.getNameAndBirthDate, cpf, options, QUERY_TYPES.BIRTH_DATE);
                    if (nameAndBirthDate.failure) return nameAndBirthDate.failure;

                    birthDate = nameAndBirthDate.body.status === true
                        ? toHubDate(hubAdapter.toBirthDate(nameAndBirthDate.body.result))
                        : undefined;

                    if (!birthDate) {
                        log.error('pd-petr-cnpj-lookup.getPersonData', 'Data de nascimento não obtida: ' + nameAndBirthDate.body.message);
                        return { success: false, reason: 'PROVIDER_ERROR', error: CPF_BIRTH_DATE_NOT_FOUND_MESSAGE };
                    }
                }

                options.birthDate = birthDate;
            }

            var person = callHub(
                hubApiService.getCpf,
                cpf,
                options,
                options.birthDate ? QUERY_TYPES.CPF_FEDERAL_REVENUE : QUERY_TYPES.CPF_HUB_DATABASE
            );
            if (person.failure) return person.failure;

            if (person.body.status !== true || !person.body.result) {
                log.error('pd-petr-cnpj-lookup.getPersonData', 'Hub retornou erro: ' + person.body.message);
                return {
                    success: false,
                    reason: 'PROVIDER_ERROR',
                    error: CPF_FAILURE_MESSAGE + (person.body.message ? ' Retorno da Hub: ' + person.body.message : '')
                };
            }

            var data = hubAdapter.toCanonicalPerson(person.body.result);
            data.data_nascimento = toHubDate(data.data_nascimento) || options.birthDate;

            return { success: true, provider: 'HUB', data: data };
        }

        function callHub(hubFunction, cpf, options, queryType) {
            var response;

            try {
                response = hubFunction(cpf, options);
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.callHub',
                    details: { queryType: queryType, stack: e.stack, message: e.message }
                });
                return { failure: { success: false, reason: 'PROVIDER_ERROR', error: CPF_TIMEOUT_MESSAGE } };
            }

            if (response.code !== 200) {
                log.error('pd-petr-cnpj-lookup.callHub', queryType + ' | HTTP ' + response.code);
                return { failure: { success: false, reason: 'PROVIDER_ERROR', error: CPF_FAILURE_MESSAGE } };
            }

            var body;

            try {
                body = JSON.parse(response.body);
            } catch (e) {
                log.error({
                    title: 'pd-petr-cnpj-lookup.callHub',
                    details: { queryType: queryType, message: 'Resposta não é JSON', body: response.body }
                });
                return { failure: { success: false, reason: 'PROVIDER_ERROR', error: CPF_FAILURE_MESSAGE } };
            }

            creditUsageService.track(body, queryType, cpf);

            return { body: body };
        }

        function toHubDate(value) {
            if (!value) return undefined;

            if (value instanceof Date || typeof value.getDate === 'function') {
                return pad(value.getDate()) + '/' + pad(value.getMonth() + 1) + '/' + value.getFullYear();
            }

            var text = String(value).trim();

            if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;

            var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
            if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];

            log.debug('pd-petr-cnpj-lookup.toHubDate', 'Formato de data não reconhecido: ' + text);
            return undefined;
        }

        function pad(number) {
            return (number < 10 ? '0' : '') + number;
        }

        return { getCompanyData: getCompanyData };
    }
);

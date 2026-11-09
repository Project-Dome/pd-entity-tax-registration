/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Leituras do Painel do Cadastro Fiscal (docs/specs/tax-registration-panel.md). SERVER-ONLY:
 * importado só pelo RESTlet do painel (pd-petr-tax-registration-panel.rl.js).
 *
 * - getSettings(): saldo atual de cada provedor pago, modos de consulta oferecidos na
 *   atualização em massa, preços da DirectD (custo estimado no modal) e a cota da ReceitaWS (aviso
 *   de queda para os provedores pagos). NUNCA devolve tokens. Status do saldo: ACTIVE (com
 *   available), DISABLED, UNLIMITED (DirectD sem Créditos Carregados) ou ERROR (falha no cálculo).
 *   A Hub só é ACTIVE com "Habilitar Hub" marcado e Créditos Carregados > 0, mesma regra da
 *   hierarquia (pd-petr-cnpj-lookup.isHubActive).
 * - Modos: DEFAULT sempre; cada modo DirectD só com a DirectD habilitada na Configuração das APIs e
 *   o botão correspondente habilitado nas Validações (PANEL.DIRECTD_MODE_SETTINGS).
 * - Preço estimado por modo: Completa = CNPJ Plus + Sintegra; Inscrição Estadual = Sintegra.
 * - listEntities(): Customer ou Vendor ativos com CPF/CNPJ preenchido; o nome é procurado em
 *   entityid, companyname e legalname e a lista sai ordenada pela Razão Social (companyname) e
 *   depois pelo ID (entityid, numérico em contas com numeração automática). Atenção às chaves de
 *   ENTITY.FIELDS, trocadas em relação ao conteúdo: FIELDS.tradeName = companyname (Razão Social,
 *   gravada pelo mapper a partir de razao_social) e FIELDS.companyName = legalname (Nome
 *   Fantasia). Na linha devolvida: corporateName = companyname e tradeName = legalname.
 * - Colunas do relatório = todos os campos gravados por pd-petr-mapper (spec §3.2), declarados em
 *   ENTITY_COLUMNS. As "optional" (legalname, firstname, IE, regime, data de nascimento, número e
 *   complemento do endereço via join) podem não existir na busca de algum tipo/conta: se a busca
 *   completa falhar, cada opcional é testada isoladamente (isColumnAccepted) e a busca é repetida
 *   só com as aceitas; as recusadas voltam vazias, em vez de quebrar a tela. O filtro de nome só
 *   usa legalname quando ele foi aceito.
 * - A URL de cada cadastro vem de url.resolveRecord, para o link abrir em nova aba.
 * - País editável (spec §3.2): getCountryOptions lê as opções do próprio campo País num Customer
 *   em modo dynamic que nunca é salvo (não depende do id da lista); falha → lista vazia e a coluna
 *   fica só leitura. setCountry grava só o País com submitFields, ignorando os outros campos
 *   obrigatórios (o cadastro pode ter outras pendências que não cabem ao painel).
 * - listCreditUsage(): delega a pd-petr-credit-usage.list.
 */
define(
    [
        'N/record',
        'N/search',
        'N/url',
        '../modules/pd-petr-constants',
        './pd-petr-api-settings',
        './pd-petr-validation-settings',
        './pd-petr-credit-usage'
    ],
    function (
        record,
        search,
        url,
        constantsModule,
        apiSettingsService,
        validationSettingsService,
        creditUsageService
    ) {
        var PANEL = constantsModule.PANEL;
        var ENTITY = constantsModule.ENTITY;
        var FIELDS = ENTITY.FIELDS;
        var RECORD_TYPES = ENTITY.RECORD_TYPES;

        var INVALID_ENTITY_TYPE_MESSAGE = 'Escolha o tipo de entidade: Cliente ou Fornecedor.';
        var INVALID_ENTITY_ID_MESSAGE = 'Entidade não informada.';
        var MISSING_COUNTRY_MESSAGE = 'Selecione o País.';

        function isEmpty(value) {
            return value === null || value === undefined || value === '';
        }

        function toAmount(value) {
            return Number(value) || 0;
        }

        function roundCurrency(value) {
            return Math.round(value * 100) / 100;
        }

        function buildBalance(providerKey, apiSettings) {
            try {
                return { status: 'ACTIVE', available: creditUsageService.getCurrentBalance(providerKey, apiSettings) };
            } catch (e) {
                log.error({
                    title: 'pd-petr-tax-registration-panel.buildBalance',
                    details: { provider: providerKey, message: e.message, stack: e.stack }
                });
                return { status: 'ERROR', available: null };
            }
        }

        function buildHubBalance(apiSettings) {
            var isHubActive = !!apiSettings.hubEnabled && Number(apiSettings.hubLoadedCredits) > 0;

            return isHubActive ? buildBalance('HUB', apiSettings) : { status: 'DISABLED', available: null };
        }

        function buildDirectdBalance(apiSettings) {
            if (!apiSettings.ddEnabled) return { status: 'DISABLED', available: null };
            if (isEmpty(apiSettings.ddLoadedCredits)) return { status: 'UNLIMITED', available: null };

            return buildBalance('DIRECTD', apiSettings);
        }

        function buildModes(apiSettings, validationSettings) {
            var modes = [{ id: constantsModule.LOOKUP_MODES.DEFAULT, label: PANEL.MODE_LABELS.DEFAULT }];

            if (!apiSettings.ddEnabled) return modes;

            Object.keys(PANEL.DIRECTD_MODE_SETTINGS).forEach(function (mode) {
                if (validationSettings[PANEL.DIRECTD_MODE_SETTINGS[mode]]) {
                    modes.push({ id: mode, label: PANEL.MODE_LABELS[mode] });
                }
            });

            return modes;
        }

        function buildPrices(apiSettings) {
            var plus = toAmount(apiSettings.ddPricePlus);
            var basic = toAmount(apiSettings.ddPriceBasic);
            var sintegra = toAmount(apiSettings.ddPriceSintegra);

            return {
                DD_FULL: roundCurrency(plus + sintegra),
                DD_PLUS: roundCurrency(plus),
                DD_BASIC: roundCurrency(basic),
                DD_IE: roundCurrency(sintegra)
            };
        }

        function getSettings() {
            var apiSettings = apiSettingsService.get() || {};
            var validationSettings = validationSettingsService.get();
            var validations = validationSettings || {};

            return {
                hasApiSettings: !isEmpty(apiSettings.ddEnabled) || !isEmpty(apiSettings.hubEnabled),
                hasValidationSettings: !!validationSettings,
                balances: {
                    hub: buildHubBalance(apiSettings),
                    directd: buildDirectdBalance(apiSettings)
                },
                modes: buildModes(apiSettings, validations),
                prices: buildPrices(apiSettings),
                receitaWs: {
                    inChain: !!apiSettings.rwsEnabled && !!validations.rwsInChain,
                    rateLimit: toAmount(apiSettings.rwsRateLimit)
                },
                countries: getCountryOptions()
            };
        }

        function getCountryOptions() {
            try {
                var draftRecord = record.create({ type: RECORD_TYPES.CUSTOMER, isDynamic: true });
                var countryField = draftRecord.getField({ fieldId: FIELDS.country.name });
                if (!countryField) return [];

                return countryField.getSelectOptions().filter(function (option) {
                    return !isEmpty(option.value);
                }).map(function (option) {
                    return { id: String(option.value), text: option.text };
                });
            } catch (e) {
                log.error({
                    title: 'pd-petr-tax-registration-panel.getCountryOptions',
                    details: { message: e.message, stack: e.stack }
                });
                return [];
            }
        }

        function setCountry(data) {
            var input = data || {};
            var recordType = input.recordType;
            var id = parseInt(input.id, 10);
            var country = String(input.country || '').trim();

            if (recordType !== RECORD_TYPES.CUSTOMER && recordType !== RECORD_TYPES.VENDOR) {
                throw new Error(INVALID_ENTITY_TYPE_MESSAGE);
            }
            if (!id) throw new Error(INVALID_ENTITY_ID_MESSAGE);
            if (!country) throw new Error(MISSING_COUNTRY_MESSAGE);

            var values = {};
            values[FIELDS.country.name] = country;

            record.submitFields({
                type: recordType,
                id: id,
                values: values,
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });

            return { id: String(id), country: country };
        }

        function listCreditUsage(filters) {
            return creditUsageService.list(filters || {}, PANEL.CREDIT_USAGE_PAGE_SIZE);
        }

        var ENTITY_COLUMNS = [
            { key: 'corporateName', name: FIELDS.tradeName.name, sort: 1 },
            { key: 'entityId', name: FIELDS.entityId.name, sort: 2 },
            { key: 'country', name: FIELDS.country.name, optional: true, withText: true },
            { key: 'document', name: FIELDS.cnpj.name },
            { key: 'tradeName', name: FIELDS.companyName.name, optional: true },
            { key: 'firstName', name: FIELDS.firstName.name, optional: true },
            { key: 'birthDate', name: FIELDS.birthDate.name, optional: true },
            { key: 'stateRegistration', name: FIELDS.stateRegistration.name, optional: true },
            { key: 'taxRegime', name: FIELDS.taxRegime.name, optional: true, asText: true },
            { key: 'phone', name: FIELDS.phone.name },
            { key: 'email', name: FIELDS.email.name },
            { key: 'zip', name: FIELDS.billZip.name },
            { key: 'street', name: FIELDS.billAddress1.name },
            { key: 'number', name: FIELDS.billAddress3.name, optional: true },
            { key: 'complement', name: ENTITY.SUBLISTS.ADDRESS.SUBRECORD.FIELDS.COMPLEMENT, join: PANEL.BILLING_ADDRESS_JOIN, optional: true },
            { key: 'district', name: FIELDS.billAddress2.name },
            { key: 'city', name: FIELDS.billCity.name },
            { key: 'state', name: FIELDS.billState.name },
            { key: 'lastModified', name: FIELDS.lastModified.name }
        ];

        function createColumn(definition) {
            var options = { name: definition.name };
            if (definition.join) options.join = definition.join;
            if (definition.sort) options.sort = search.Sort.ASC;
            return search.createColumn(options);
        }

        function isColumnAccepted(entityType, definition) {
            try {
                search.create({
                    type: entityType,
                    filters: [[FIELDS.isInactive.name, 'is', 'F']],
                    columns: [createColumn(definition)]
                }).run().getRange({ start: 0, end: 1 });
                return true;
            } catch (e) {
                log.audit('pd-petr-tax-registration-panel.isColumnAccepted', entityType + ': coluna ' + (definition.join ? definition.join + '.' : '') + definition.name + ' recusada (' + e.message + ').');
                return false;
            }
        }

        function buildEntityFilters(name, includeLegalName) {
            var filters = [
                [FIELDS.isInactive.name, 'is', 'F'],
                'AND',
                [FIELDS.cnpj.name, 'isnotempty', '']
            ];

            var trimmedName = String(name || '').trim();
            if (!trimmedName) return filters;

            var nameFilters = [
                [FIELDS.entityId.name, 'contains', trimmedName],
                'OR',
                [FIELDS.tradeName.name, 'contains', trimmedName]
            ];

            if (includeLegalName) nameFilters.push('OR', [FIELDS.companyName.name, 'contains', trimmedName]);

            filters.push('AND', nameFilters);

            return filters;
        }

        function fetchEntityPage(entityType, options, pageSize, columnDefinitions) {
            var includeLegalName = columnDefinitions.some(function (definition) { return definition.key === 'tradeName'; });

            var pagedData = search.create({
                type: entityType,
                filters: buildEntityFilters(options.name, includeLegalName),
                columns: columnDefinitions.map(createColumn)
            }).runPaged({ pageSize: pageSize });

            if (!pagedData.count) return { count: 0, pageCount: 0, page: 1, data: [] };

            var pageCount = pagedData.pageRanges.length;
            var page = Math.min(Math.max(parseInt(options.page, 10) || 1, 1), pageCount);

            return {
                count: pagedData.count,
                pageCount: pageCount,
                page: page,
                data: pagedData.fetch({ index: page - 1 }).data
            };
        }

        function resolveEntityUrl(entityType, id) {
            try {
                return url.resolveRecord({ recordType: entityType, recordId: id });
            } catch (e) {
                return '';
            }
        }

        function readColumn(result, definition) {
            var column = createColumn(definition);
            var value = definition.asText ? result.getText(column) : result.getValue(column);
            return isEmpty(value) ? '' : value;
        }

        function listEntities(filters) {
            var options = filters || {};
            var entityType = options.entityType;

            if (entityType !== RECORD_TYPES.CUSTOMER && entityType !== RECORD_TYPES.VENDOR) {
                throw new Error(INVALID_ENTITY_TYPE_MESSAGE);
            }

            var pageSize = PANEL.ENTITIES_PAGE_SIZE;
            var columnDefinitions = ENTITY_COLUMNS;
            var entityPage;

            try {
                entityPage = fetchEntityPage(entityType, options, pageSize, columnDefinitions);
            } catch (e) {
                log.audit('pd-petr-tax-registration-panel.listEntities', 'Busca completa recusada (' + e.message + ') — testando as colunas opcionais.');
                columnDefinitions = ENTITY_COLUMNS.filter(function (definition) {
                    return !definition.optional || isColumnAccepted(entityType, definition);
                });
                entityPage = fetchEntityPage(entityType, options, pageSize, columnDefinitions);
            }

            var rows = entityPage.data.map(function (result) {
                var row = {
                    id: result.id,
                    recordType: entityType,
                    url: resolveEntityUrl(entityType, result.id)
                };

                ENTITY_COLUMNS.forEach(function (definition) {
                    row[definition.key] = '';
                    if (definition.withText) row[definition.key + 'Text'] = '';
                });
                columnDefinitions.forEach(function (definition) {
                    row[definition.key] = readColumn(result, definition);
                    if (definition.withText) row[definition.key + 'Text'] = readColumn(result, { name: definition.name, join: definition.join, asText: true });
                });

                return row;
            });

            return {
                count: entityPage.count,
                pageCount: entityPage.pageCount,
                page: entityPage.page,
                pageSize: pageSize,
                countryAvailable: columnDefinitions.some(function (definition) { return definition.key === 'country'; }),
                rows: rows
            };
        }

        return {
            getSettings: getSettings,
            listCreditUsage: listCreditUsage,
            listEntities: listEntities,
            setCountry: setCountry
        };
    }
);

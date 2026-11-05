/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Vinicius Betim & Mário Augusto Braga Costa
 */
/*
 * - Sem registro de Configuração das Validações o enriquecimento não roda — quem chamou avisa
 *   o usuário.
 * - companyname é a razão social exibida em toda a conta, por isso sempre reflete o retorno da
 *   Receita, mesmo sobrescrevendo valor já preenchido. Os demais campos só são preenchidos se
 *   estiverem vazios.
 * - Inscrição Estadual vem da Hub (quando enableStateRegLookup está marcado) ou da DirectD
 *   (opção writeStateRegistration) — por isso usa essas condições em vez de uma "update*".
 * - Retorno de CPF (tipo_pessoa "PF") só preenche o nome, em firstname, sempre refletindo a
 *   Receita (mesma regra de companyname). firstname só existe em cadastro de Pessoa Física
 *   (Individual); sem ele, devolve um aviso em vez de falhar. A data de nascimento devolvida
 *   pela Hub (DD/MM/AAAA) vai para custentity_pd_petr_birth_date_dt somente se estiver vazio. * - insertAddress devolve um aviso {title, message} quando não completa o endereço (ex.:
 *   Cidade não identificada), repassado a quem chamou setFields. Falhar no endereço não pode
 *   abortar o save: manipular o subrecord fora do modo dynamic é instável no NetSuite
 *   (getSublistSubrecord pode devolver null). Em modo dynamic, ler linha existente exige
 *   selectLine + getCurrentSublistSubrecord + cancelLine.
 * - Cidade e Regime Tributário: os ids são resolvidos pelo Suitelet anônimo de busca
 *   (pd-petr-data-lookup-gateway), porque o papel de quem clica em "Consultar CNPJ" pode não
 *   ter acesso a customrecord_ftebr_city / customrecord_fte_taxregime. Para a cidade vão o
 *   código IBGE (do provedor de CNPJ — nenhum dos atuais retorna — ou da consulta de CEP), o
 *   município e a UF; a regra de prioridade está em pd-petr-city.js.
 * - regime_tributario: "ano" pode vir como string — comparado com Number() para não virar
 *   comparação lexicográfica ("9" > "10").
 * - Opções de setFields (docs/specs/directd-integration.md §6.6): writeStateRegistration grava a
 *   IE sem depender de "Consultar Inscrição Estadual (Hub)" (retorno da DirectD, que só traz IE
 *   quando o Sintegra foi consultado); stateRegistrationOnly (botão "Consultar Inscrição
 *   Estadual") grava só a IE, se o campo estiver vazio, e avisa quando não grava.
 * - findAddressState: UF do endereço de faturamento padrão ou, sem ele, da primeira linha do
 *   addressbook com estado. Mesmo padrão de leitura de subrecord de addressbookHasZip (funciona
 *   no cliente e no servidor).
 */
define(
    [
        '../modules/pd-petr-constants',
        './pd-petr-cep-api',
        './pd-petr-validation-settings',
        './pd-petr-data-lookup-gateway'
    ],
    function (
        constantsModule,
        cepApiService,
        validationSettingsService,
        dataLookupGateway
    ) {
        var LOOKUP_ACTIONS = constantsModule.DATA_LOOKUP.ACTIONS;
        var FIELDS = constantsModule.ENTITY.FIELDS;

        function setFields(currentRecord, json, options) {
            var settings = validationSettingsService.get();
            var mapOptions = options || {};

            if (!settings) {
                log.error({
                    title: 'pd-petr-mapper.setFields',
                    details: 'Não há registro de Configurações de Validação ativo — enriquecimento não executado.'
                });
                return { success: false };
            }

            if (mapOptions.stateRegistrationOnly) {
                return setStateRegistrationOnly(currentRecord, json);
            }

            if (json.tipo_pessoa === 'PF') {
                return setPersonFields(currentRecord, json);
            }

            var wasLegalNameEmpty = fieldExists(currentRecord, FIELDS.companyName.name)
                && !currentRecord.getValue({ fieldId: FIELDS.companyName.name });

            if (settings.updateTradeName && json.nome_fantasia && wasLegalNameEmpty) {
                currentRecord.setValue({ fieldId: FIELDS.companyName.name, value: json.nome_fantasia });
            }

            if (settings.updateCompanyName && json.razao_social) {
                currentRecord.setValue({ fieldId: FIELDS.tradeName.name, value: json.razao_social });
            }

            if (settings.updatePhone && json.ddd_telefone_1) setIfEmpty(currentRecord, FIELDS.phone.name, formatPhone(json.ddd_telefone_1));
            if (settings.updateEmail && json.email) setIfEmpty(currentRecord, FIELDS.email.name, json.email);

            if ((settings.enableStateRegLookup || mapOptions.writeStateRegistration) && json.inscricao_estadual) {
                if (fieldExists(currentRecord, FIELDS.stateRegistration.name)) {
                    setIfEmpty(currentRecord, FIELDS.stateRegistration.name, json.inscricao_estadual);
                } else {
                    log.debug('pd-petr-mapper.setFields', 'Field ' + FIELDS.stateRegistration.name + ' not present on this record/form — skipping state registration mapping.');
                }
            }

            if (settings.updateTaxRegime) {
                if (fieldExists(currentRecord, FIELDS.taxRegime.name)) {
                    var taxRegimeLabel = resolveTaxRegimeLabel(json);
                    if (taxRegimeLabel) {
                        var taxRegimeId = lookupTaxRegimeIdByLabel(taxRegimeLabel);
                        if (taxRegimeId) {
                            setIfEmpty(currentRecord, FIELDS.taxRegime.name, taxRegimeId);
                        } else {
                            log.debug('pd-petr-mapper.setFields', 'Could not resolve ' + constantsModule.ENTITY.TAX_REGIME_LOOKUP.RECORD_TYPE + ' for label "' + taxRegimeLabel + '" — leaving Tax Regime blank.');
                        }
                    }
                } else {
                    log.debug('pd-petr-mapper.setFields', 'Field ' + FIELDS.taxRegime.name + ' not present on this record/form — skipping tax regime mapping.');
                }
            }

            if (json.qsa && json.qsa.length) {
                log.debug('pd-petr-mapper.setFields', json.qsa.length + ' socio(s) found in qsa — not mapped (would require a related custom record, out of scope for this product)');
            }

            var addressWarning = settings.updateAddress ? insertAddress(currentRecord, json) : null;

            return { success: true, warning: addressWarning || null };
        }

        function setStateRegistrationOnly(currentRecord, json) {
            var fieldId = FIELDS.stateRegistration.name;

            if (!fieldExists(currentRecord, fieldId)) {
                return {
                    success: true,
                    warning: {
                        title: 'Inscrição Estadual não preenchida',
                        message: 'A Inscrição Estadual ' + json.inscricao_estadual + ' foi encontrada, mas o campo Inscrição Estadual não está disponível neste formulário.'
                    }
                };
            }

            var current = currentRecord.getValue({ fieldId: fieldId });

            if (current) {
                return {
                    success: true,
                    warning: {
                        title: 'Inscrição Estadual mantida',
                        message: 'O cadastro já tem a Inscrição Estadual ' + current + '. A inscrição encontrada no Sintegra ('
                            + json.inscricao_estadual + ') não foi gravada.'
                    }
                };
            }

            currentRecord.setValue({ fieldId: fieldId, value: json.inscricao_estadual });

            return { success: true, warning: null };
        }

        function buildMapOptions(result, lookupMode) {
            return {
                writeStateRegistration: !!result && result.provider === 'DIRECTD',
                stateRegistrationOnly: lookupMode === constantsModule.LOOKUP_MODES.DD_IE
            };
        }

        function findAddressState(currentRecord) {
            var sublistId = constantsModule.ENTITY.SUBLISTS.ADDRESS.ID;
            var subrecordId = constantsModule.ENTITY.SUBLISTS.ADDRESS.SUBRECORD.ID;
            var stateFieldId = constantsModule.ENTITY.SUBLISTS.ADDRESS.SUBRECORD.FIELDS.STATE;
            var lineCount = currentRecord.getLineCount({ sublistId: sublistId });
            var isDynamic = currentRecord.isDynamic;
            var defaultBillingState = '';
            var firstState = '';

            for (var line = 0; line < lineCount; line++) {
                var state = '';

                try {
                    var addressSubrecord;

                    if (isDynamic) {
                        currentRecord.selectLine({ sublistId: sublistId, line: line });
                        addressSubrecord = currentRecord.getCurrentSublistSubrecord({ sublistId: sublistId, fieldId: subrecordId });
                    } else {
                        addressSubrecord = currentRecord.getSublistSubrecord({ sublistId: sublistId, fieldId: subrecordId, line: line });
                    }

                    state = addressSubrecord ? String(addressSubrecord.getValue({ fieldId: stateFieldId }) || '').trim() : '';

                    if (isDynamic) currentRecord.cancelLine({ sublistId: sublistId });
                } catch (e) {
                    log.error({
                        title: 'pd-petr-mapper.findAddressState',
                        details: { line: line, isDynamic: isDynamic, message: e.message }
                    });
                }

                if (!state) continue;

                if (!firstState) firstState = state;

                var isDefaultBilling = currentRecord.getSublistValue({ sublistId: sublistId, fieldId: 'defaultbilling', line: line });
                if (isDefaultBilling === true || isDefaultBilling === 'T') {
                    defaultBillingState = state;
                    break;
                }
            }

            return (defaultBillingState || firstState).toUpperCase();
        }

        function setPersonFields(currentRecord, json) {
            if (!json.nome) return { success: true, warning: null };

            if (!fieldExists(currentRecord, FIELDS.firstName.name)) {
                log.debug('pd-petr-mapper.setPersonFields', 'Field ' + FIELDS.firstName.name + ' not present on this record/form — skipping CPF name mapping.');
                return {
                    success: true,
                    warning: {
                        title: 'Nome não preenchido',
                        message: 'O CPF foi consultado, mas o campo Nome não está disponível neste cadastro. '
                            + 'Verifique se o cadastro está marcado como Pessoa Física (Individual).'
                    }
                };
            }

            currentRecord.setValue({ fieldId: FIELDS.firstName.name, value: json.nome });

            var birthDate = parseHubDate(json.data_nascimento);
            if (birthDate && fieldExists(currentRecord, FIELDS.birthDate.name)) {
                setIfEmpty(currentRecord, FIELDS.birthDate.name, birthDate);
            }

            return { success: true, warning: null };
        }

        function parseHubDate(value) {
            var match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
            if (!match) return null;
            return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
        }

        function insertAddress(currentRecord, json) {
            var sublistId = constantsModule.ENTITY.SUBLISTS.ADDRESS.ID;
            var subrecordId = constantsModule.ENTITY.SUBLISTS.ADDRESS.SUBRECORD.ID;
            var f = constantsModule.ENTITY.SUBLISTS.ADDRESS.SUBRECORD.FIELDS;

            var zipDigits = json.cep ? json.cep.replace(/\D/g, '') : '';

            if (currentRecord.getLineCount({ sublistId: sublistId }) > 0) {
                if (!zipDigits) {
                    log.debug('pd-petr-mapper.insertAddress', 'Cadastro de endereços já tem linha(s) e a API não retornou CEP — nada a comparar, endereços existentes mantidos.');
                    return;
                }

                if (addressbookHasZip(currentRecord, sublistId, subrecordId, f.ZIP, zipDigits)) {
                    log.debug('pd-petr-mapper.insertAddress', 'CEP ' + zipDigits + ' já existe no cadastro de endereços — nenhuma linha nova inserida.');
                    return;
                }

                log.debug('pd-petr-mapper.insertAddress', 'CEP ' + zipDigits + ' difere de todas as linhas existentes — inserindo nova linha de endereço.');
            }

            var cep = json.cep ? cepApiService.get(json.cep) : null;

            var isDynamic = currentRecord.isDynamic;

            log.debug('isDynamicTest', isDynamic);

            var line;
            var subrecord;

            try {

                if (isDynamic) {
                    currentRecord.selectNewLine({ sublistId: sublistId });
                    subrecord = currentRecord.getCurrentSublistSubrecord({
                        sublistId: sublistId,
                        fieldId: subrecordId
                    });
                } else {
                    line = currentRecord.getLineCount({ sublistId: sublistId });
                    currentRecord.insertLine({ sublistId: sublistId, line: line });
                    subrecord = currentRecord.getSublistSubrecord({
                        sublistId: sublistId,
                        fieldId: subrecordId,
                        line: line
                    });
                }

                if (!subrecord) {
                    log.error({
                        title: 'pd-petr-mapper.insertAddress',
                        details: 'Subrecord de endereço não disponível (isDynamic=' + isDynamic + ') — endereço não inserido.'
                    });
                    return {
                        title: 'Endereço não preenchido',
                        message: 'Os demais dados foram atualizados, mas não foi possível preencher o endereço automaticamente. '
                            + 'Preencha manualmente na aba Endereço, se necessário.'
                    };
                }

                if (zipDigits) {
                    subrecord.setValue({ fieldId: f.ZIP, value: zipDigits });
                }

                var logradouro = (cep && cep.street) ? cep.street : json.logradouro;
                if (logradouro) subrecord.setValue({ fieldId: f.ADDR1, value: normalize(logradouro) });

                if (json.numero) subrecord.setValue({ fieldId: f.ADDR3, value: json.numero });

                var bairro = (cep && cep.neighborhood) ? cep.neighborhood : json.bairro;
                if (bairro) subrecord.setValue({ fieldId: f.ADDR2, value: normalize(bairro) });

                if (json.complemento) subrecord.setValue({ fieldId: f.COMPLEMENT, value: normalize(json.complemento) });

                var uf = (cep && cep.state) ? cep.state : json.uf;
                if (uf) subrecord.setValue({ fieldId: f.STATE, value: uf });

                var cityId = resolveCityInternalId(json, uf, cep);
                if (cityId) {
                    subrecord.setValue({ fieldId: f.CITY, value: cityId });
                }

                if (isDynamic) currentRecord.commitLine({ sublistId: sublistId });

                return cityId ? null : buildCityNotResolvedWarning();

            } catch (e) {

                log.error({
                    title: 'pd-petr-mapper.insertAddress',
                    details: { isDynamic: isDynamic, stack: e.stack, message: e.message }
                });

                return buildCityNotResolvedWarning();

            }
        }

        function buildCityNotResolvedWarning() {
            return {
                title: 'Endereço incompleto',
                message: 'Os demais dados foram atualizados, mas não foi possível identificar automaticamente a Cidade do endereço. '
                    + 'Preencha o campo manualmente na aba Endereço.'
            };
        }

        function addressbookHasZip(currentRecord, sublistId, subrecordId, zipFieldId, zipDigits) {
            var lineCount = currentRecord.getLineCount({ sublistId: sublistId });
            var isDynamic = currentRecord.isDynamic;
            var hasMatch = false;

            for (var line = 0; line < lineCount && !hasMatch; line++) {
                var existingSubrecord;

                if (isDynamic) {
                    currentRecord.selectLine({ sublistId: sublistId, line: line });
                    existingSubrecord = currentRecord.getCurrentSublistSubrecord({
                        sublistId: sublistId,
                        fieldId: subrecordId
                    });
                } else {
                    existingSubrecord = currentRecord.getSublistSubrecord({
                        sublistId: sublistId,
                        fieldId: subrecordId,
                        line: line
                    });
                }

                if (existingSubrecord) {
                    var existingZip = String(existingSubrecord.getValue({ fieldId: zipFieldId }) || '').replace(/\D/g, '');
                    hasMatch = !!existingZip && existingZip === zipDigits;
                }

                if (isDynamic) currentRecord.cancelLine({ sublistId: sublistId });
            }

            return hasMatch;
        }

        function setIfEmpty(currentRecord, fieldId, value) {
            var current = currentRecord.getValue({ fieldId: fieldId });
            if (current !== '' && current !== null && typeof current !== 'undefined') return;
            currentRecord.setValue({ fieldId: fieldId, value: value });
        }

        function resolveCityInternalId(json, uf, cep) {
            var ibgeCode = json.codigo_municipio_ibge || (cep && cep.ibge && cep.ibge.city);

            if (!ibgeCode && !(json.municipio && uf)) {
                log.debug('pd-petr-mapper.resolveCityInternalId', 'No codigo_municipio_ibge nor municipio/uf in response — leaving City blank.');
                return null;
            }

            return dataLookupGateway.requestData(LOOKUP_ACTIONS.FIND_CITY, {
                ibgeCode: ibgeCode,
                name: json.municipio,
                uf: uf
            });
        }

        function fieldExists(currentRecord, fieldId) {
            return currentRecord.getField({ fieldId: fieldId }) !== null;
        }

        function lookupTaxRegimeIdByLabel(label) {
            if (!label) return null;
            return dataLookupGateway.requestData(LOOKUP_ACTIONS.FIND_TAX_REGIME, { label: label });
        }

        function resolveTaxRegimeLabel(json) {
            var labels = constantsModule.ENTITY.TAX_REGIME_LOOKUP.LABELS;

            if (json.opcao_pelo_mei === true) return labels.SIMPLES;
            if (json.opcao_pelo_simples === true) return labels.SIMPLES;

            if (json.regime_tributario && json.regime_tributario.length) {
                var latest = json.regime_tributario.reduce(function (latestEntry, entry) {
                    var isMoreRecent = !latestEntry || Number(entry.ano) > Number(latestEntry.ano);
                    return isMoreRecent ? entry : latestEntry;
                }, null);

                var forma = latest && latest.forma_de_tributacao;
                if (forma === 'LUCRO PRESUMIDO') return labels.LUCRO_PRESUMIDO;
                if (forma === 'LUCRO REAL') return labels.LUCRO_REAL;

                log.debug('pd-petr-mapper.resolveTaxRegimeLabel', 'Unrecognized forma_de_tributacao "' + forma + '" — tax regime not mapped.');
                return null;
            }

            log.debug('pd-petr-mapper.resolveTaxRegimeLabel', 'No opcao_pelo_mei/opcao_pelo_simples/regime_tributario data in response — tax regime not mapped.');
            return null;
        }

        function normalize(str) {
            if (!str) return '';
            if (typeof str.normalize === 'function') {
                return str.normalize('NFD').replace(/[^\x00-\x7F]/g, '');
            }
            return str;
        }

        function formatPhone(raw) {
            if (!raw) return '';
            var digits = raw.replace(/\D/g, '');
            if (digits.length === 10) return '(' + digits.substring(0, 2) + ') ' + digits.substring(2, 6) + '-' + digits.substring(6);
            if (digits.length === 11) return '(' + digits.substring(0, 2) + ') ' + digits.substring(2, 7) + '-' + digits.substring(7);
            return raw;
        }

        return {
            setFields: setFields,
            insertAddress: insertAddress,
            buildMapOptions: buildMapOptions,
            findAddressState: findAddressState
        };
    }
);

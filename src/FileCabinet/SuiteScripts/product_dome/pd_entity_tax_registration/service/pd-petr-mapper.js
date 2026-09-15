/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Vinicius Betim & Mário Augusto Braga Costa
 */
define(
    [
        '../modules/pd-petr-constants',
        './pd-petr-cep-api',
        './pd-petr-validation-settings',
        '../util/pd-petr-search-data'
    ],
    function (
        constantsModule,
        cepApiService,
        validationSettingsService,
        searchDataUtil
    ) {
        var FIELDS = constantsModule.ENTITY.FIELDS;

        function setFields(currentRecord, json) {
            var settings = validationSettingsService.get();

            // Sem registro de configuração o enriquecimento não roda — quem chamou avisa o usuário
            if (!settings) {
                log.error({
                    title: 'pd-petr-mapper.setFields',
                    details: 'Não há registro de Configurações de Validação ativo — enriquecimento não executado.'
                });
                return false;
            }

            var wasLegalNameEmpty = fieldExists(currentRecord, FIELDS.companyName.name)
                && !currentRecord.getValue({ fieldId: FIELDS.companyName.name });

            if (settings.updateTradeName && json.nome_fantasia && wasLegalNameEmpty) {
                currentRecord.setValue({ fieldId: FIELDS.companyName.name, value: json.nome_fantasia });
            }

            // companyname é a razão social exibida em toda a conta (listas, busca, documentos) —
            // por isso sempre reflete o retorno da Receita, mesmo sobrescrevendo valor já preenchido.
            if (settings.updateCompanyName && json.razao_social) {
                currentRecord.setValue({ fieldId: FIELDS.tradeName.name, value: json.razao_social });
            }

            if (settings.updatePhone    && json.ddd_telefone_1) setIfEmpty(currentRecord, FIELDS.phone.name,    formatPhone(json.ddd_telefone_1));
            if (settings.updateAltPhone && json.ddd_telefone_2) setIfEmpty(currentRecord, FIELDS.altPhone.name, formatPhone(json.ddd_telefone_2));
            if (settings.updateFax      && json.ddd_fax)        setIfEmpty(currentRecord, FIELDS.fax.name,      formatPhone(json.ddd_fax));
            if (settings.updateEmail    && json.email)          setIfEmpty(currentRecord, FIELDS.email.name,    json.email);

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

            if (settings.updateAddress) insertAddress(currentRecord, json);

            return true;
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

            log.debug('isDynamic', isDynamic);

            var line;
            var subrecord;

            // Manipular o subrecord de endereço fora do modo dynamic é instável no NetSuite
            // (getSublistSubrecord pode devolver null). Falhar aqui não pode abortar o save
            // do registro — o endereço é enriquecimento, não dado obrigatório.
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
                    return;
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

                if (json.codigo_municipio_ibge) {
                    var cityId = lookupCityInternalId(json.codigo_municipio_ibge);
                    if (cityId) {
                        subrecord.setValue({ fieldId: f.CITY, value: cityId });
                    } else {
                        log.debug('pd-petr-mapper.insertAddress', 'Could not resolve city for IBGE code ' + json.codigo_municipio_ibge + ' — leaving City blank.');
                    }
                } else {
                    log.debug('pd-petr-mapper.insertAddress', 'No codigo_municipio_ibge in response — leaving City blank.');
                }

                if (isDynamic) currentRecord.commitLine({ sublistId: sublistId });

            } catch (e) {

                log.error({
                    title: 'pd-petr-mapper.insertAddress',
                    details: { isDynamic: isDynamic, stack: e.stack, message: e.message }
                });

            }
        }

        function addressbookHasZip(currentRecord, sublistId, subrecordId, zipFieldId, zipDigits) {
            var lineCount = currentRecord.getLineCount({ sublistId: sublistId });
            var isDynamic = currentRecord.isDynamic;
            var hasMatch = false;

            // Leitura de linha já existente: em modo dynamic, getSublistSubrecord não é
            // suportado — é preciso selectLine + getCurrentSublistSubrecord, e cancelLine
            // ao final para não deixar a linha selecionada antes do selectNewLine seguinte.
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

        function lookupCityInternalId(ibgeCode) {
            if (!ibgeCode) return null;
            try {
                var result = searchDataUtil.first({
                    type: constantsModule.ENTITY.CITY_LOOKUP.RECORD_TYPE,
                    fields: constantsModule.ENTITY.CITY_LOOKUP.FIELDS,
                    filters: [[constantsModule.ENTITY.CITY_LOOKUP.FIELDS.ibgeCode.name, 'equalto', Number(ibgeCode)]]
                });

                if (!result) {
                    log.debug('pd-petr-mapper.lookupCityInternalId', 'No ' + constantsModule.ENTITY.CITY_LOOKUP.RECORD_TYPE + ' match for IBGE code ' + ibgeCode);
                    return null;
                }
                return result.internalId;
            } catch (e) {
                log.error('pd-petr-mapper.lookupCityInternalId', e);
                return null;
            }
        }

        function fieldExists(currentRecord, fieldId) {
            return currentRecord.getField({ fieldId: fieldId }) !== null;
        }

        function lookupTaxRegimeIdByLabel(label) {
            if (!label) return null;
            try {
                var result = searchDataUtil.first({
                    type: constantsModule.ENTITY.TAX_REGIME_LOOKUP.RECORD_TYPE,
                    fields: constantsModule.ENTITY.TAX_REGIME_LOOKUP.FIELDS,
                    filters: [[constantsModule.ENTITY.TAX_REGIME_LOOKUP.FIELDS.name.name, 'is', label]]
                });

                if (!result) {
                    log.debug('pd-petr-mapper.lookupTaxRegimeIdByLabel', 'No ' + constantsModule.ENTITY.TAX_REGIME_LOOKUP.RECORD_TYPE + ' match for label "' + label + '"');
                    return null;
                }
                return result.internalId;
            } catch (e) {
                log.error('pd-petr-mapper.lookupTaxRegimeIdByLabel', e);
                return null;
            }
        }

        function resolveTaxRegimeLabel(json) {
            var labels = constantsModule.ENTITY.TAX_REGIME_LOOKUP.LABELS;

            if (json.opcao_pelo_mei === true)     return labels.SIMPLES;
            if (json.opcao_pelo_simples === true) return labels.SIMPLES;

            if (json.regime_tributario && json.regime_tributario.length) {
                // Number() porque a BrasilAPI pode devolver "ano" como string, e aí a
                // comparação seria lexicográfica ("9" > "10" daria true)
                var latest = json.regime_tributario.reduce(function (latestEntry, entry) {
                    var isMoreRecent = !latestEntry || Number(entry.ano) > Number(latestEntry.ano);
                    return isMoreRecent ? entry : latestEntry;
                }, null);

                var forma = latest && latest.forma_de_tributacao;
                if (forma === 'LUCRO PRESUMIDO') return labels.LUCRO_PRESUMIDO;
                if (forma === 'LUCRO REAL')      return labels.LUCRO_REAL;

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
            insertAddress: insertAddress
        };
    }
);

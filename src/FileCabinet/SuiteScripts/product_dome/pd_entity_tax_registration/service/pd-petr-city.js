/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Busca direta em customrecord_ftebr_city — só deve rodar dentro do Suitelet de busca
 * (pd-petr-data-lookup.sl.js), que executa como Administrador. Os demais scripts resolvem a
 * cidade via pd-petr-data-lookup-gateway, porque o papel de quem clica em "Consultar CNPJ"
 * pode não ter acesso a esse registro.
 *
 * - resolveId: prioriza o código IBGE; sem ele (ou sem correspondência), busca por município
 *   + UF.
 * - findIdByNameAndUf: o registro não tem campos separados de nome/UF (ver NAME_FORMULAS em
 *   pd-petr-constants). Filtro amplo por UF + 1ª letra e comparação exata em JS sem acento e
 *   caixa, porque o "startswith" do formulatext não é acento-insensível.
 */
define(
    [
        '../modules/pd-petr-constants',
        '../util/pd-petr-search-data'
    ],
    function (
        constantsModule,
        searchDataUtil
    ) {
        var CITY_LOOKUP = constantsModule.ENTITY.CITY_LOOKUP;

        function resolveId(options) {
            if (options.ibgeCode) {
                var cityIdByIbge = findIdByIbgeCode(options.ibgeCode);
                if (cityIdByIbge) return cityIdByIbge;
                log.debug('pd-petr-city.resolveId', 'Could not resolve city for IBGE code ' + options.ibgeCode + ' — trying name+uf.');
            }

            if (options.name && options.uf) {
                return findIdByNameAndUf(options.name, options.uf);
            }

            log.debug('pd-petr-city.resolveId', 'No IBGE code nor name/uf informed — city not resolved.');
            return null;
        }

        function findIdByIbgeCode(ibgeCode) {
            if (!ibgeCode) return null;

            var result = searchDataUtil.first({
                type: CITY_LOOKUP.RECORD_TYPE,
                fields: CITY_LOOKUP.FIELDS,
                filters: [[CITY_LOOKUP.FIELDS.ibgeCode.name, 'equalto', Number(ibgeCode)]]
            });

            if (!result) {
                log.debug('pd-petr-city.findIdByIbgeCode', 'No ' + CITY_LOOKUP.RECORD_TYPE + ' match for IBGE code ' + ibgeCode);
                return null;
            }

            return result.internalId;
        }

        function findIdByNameAndUf(name, uf) {
            if (!name || !uf) return null;

            var formulas = CITY_LOOKUP.NAME_FORMULAS;
            var normalizedTarget = normalizeForCompare(name);

            var candidates = searchDataUtil.run({
                type: CITY_LOOKUP.RECORD_TYPE,
                fields: {
                    internalId: CITY_LOOKUP.FIELDS.internalId,
                    cityName: { name: 'formulatext', formula: formulas.NAME }
                },
                filters: [
                    searchDataUtil.formulaFilter(formulas.UF, 'is', uf),
                    'AND',
                    searchDataUtil.formulaFilter(formulas.NAME, 'startswith', normalizedTarget.charAt(0))
                ]
            });

            var match = candidates.filter(function (candidate) {
                return normalizeForCompare(candidate.cityName) === normalizedTarget;
            })[0];

            if (!match) {
                log.debug('pd-petr-city.findIdByNameAndUf', 'No ' + CITY_LOOKUP.RECORD_TYPE + ' match for "' + name + '" / ' + uf);
                return null;
            }

            return match.internalId;
        }

        function normalizeForCompare(str) {
            if (!str) return '';
            var stripped = typeof str.normalize === 'function'
                ? str.normalize('NFD').replace(/[^\x00-\x7F]/g, '')
                : str;
            return stripped.toLowerCase().trim();
        }

        return {
            resolveId: resolveId
        };
    }
);

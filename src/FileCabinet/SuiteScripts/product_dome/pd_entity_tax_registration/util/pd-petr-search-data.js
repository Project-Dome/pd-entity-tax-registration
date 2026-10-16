/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Campos marcados com isCheckbox voltam da busca como string "T"/"F" (e "F" é truthy) — o
 * mapResult normaliza para boolean.
 *
 * formulaFilter() monta um filtro por fórmula SQL (ex.: SUBSTR/INSTR sobre campo nativo). O
 * N/search aceita misturar esses objetos com expressões [nome, operador, valor] no mesmo
 * array de options.filters, unidos por "AND"/"OR".
 */
define(['N/search'], function (search) {

    function toBoolean(value) {
        return value === true || value === 'T' || value === 'true';
    }

    function buildColumns(fields) {
        return Object.keys(fields)
            .filter(function (key) { return !fields[key].excludeFromSearch; })
            .map(function (key) {
                var field = fields[key];
                return search.createColumn({ name: field.name, join: field.join, formula: field.formula });
            });
    }

    function mapResult(fields, result) {
        var data = {};

        Object.keys(fields).forEach(function (key) {
            var field = fields[key];

            if (field.excludeFromSearch) return;

            if (field.name === 'internalid') {
                data[key] = result.id;
                return;
            }

            if (field.isCheckbox) {
                data[key] = toBoolean(result.getValue({ name: field.name, join: field.join, formula: field.formula }));
                return;
            }

            if (field.isMultiSelect) {
                var rawValue = result.getValue({ name: field.name, join: field.join, formula: field.formula });
                data[key] = String(rawValue || '').split(',').filter(Boolean);
                return;
            }

            data[key] = field.isSelect
                ? {
                    value: result.getValue({ name: field.name, join: field.join, formula: field.formula }),
                    text: result.getText({ name: field.name, join: field.join, formula: field.formula })
                }
                : result.getValue({ name: field.name, join: field.join, formula: field.formula });
        });

        return data;
    }

    function run(options) {
        var searchDefinition = search.create({
            type: options.type,
            filters: options.filters,
            columns: buildColumns(options.fields)
        });

        var results = [];

        searchDefinition.run().each(function (result) {
            results.push(mapResult(options.fields, result));
            return !options.max || results.length < options.max;
        });

        return results;
    }

    function first(options) {
        var results = run(Object.assign({}, options, { max: 1 }));
        return results.length ? results[0] : null;
    }

    function formulaFilter(formula, operator, value) {
        return search.createFilter({
            name: 'formulatext',
            formula: formula,
            operator: operator,
            values: value
        });
    }

    return {
        run: run,
        first: first,
        buildColumns: buildColumns,
        mapResult: mapResult,
        formulaFilter: formulaFilter
    };
});

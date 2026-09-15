/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(['N/record'], function (record) {

    function bodyFields(fields, targetRecord, data) {
        Object.keys(fields).forEach(function (key) {
            var field = fields[key];

            if (field.name === 'internalid') return;
            if (!Object.prototype.hasOwnProperty.call(data, key)) return;

            targetRecord.setValue({ fieldId: field.name, value: data[key] });
        });
    }

    function sublistFields(fields, targetRecord, sublistId, line, data) {
        Object.keys(fields).forEach(function (key) {
            var field = fields[key];

            if (!Object.prototype.hasOwnProperty.call(data, key)) return;

            targetRecord.setSublistValue({
                sublistId: sublistId,
                fieldId: field.name,
                line: line,
                value: data[key]
            });
        });
    }

    function submitFields(options) {
        var values = {};

        Object.keys(options.fields).forEach(function (key) {
            var field = options.fields[key];

            if (field.name === 'internalid') return;
            if (!Object.prototype.hasOwnProperty.call(options.data, key)) return;

            values[field.name] = options.data[key];
        });

        return record.submitFields({
            type: options.type,
            id: options.id,
            values: values
        });
    }

    return {
        bodyFields: bodyFields,
        sublistFields: sublistFields,
        submitFields: submitFields
    };
});

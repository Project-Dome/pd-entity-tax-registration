/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define([], function () {

    function bodyFields(fields, targetRecord) {
        var data = {};

        Object.keys(fields).forEach(function (key) {
            var field = fields[key];

            data[key] = field.name === 'internalid'
                ? targetRecord.id
                : targetRecord.getValue({ fieldId: field.name });
        });

        return data;
    }

    function sublistFields(fields, targetRecord, sublistId) {
        var lineCount = targetRecord.getLineCount({ sublistId: sublistId });
        var lines = [];

        for (var line = 0; line < lineCount; line++) {
            var lineData = {};

            Object.keys(fields).forEach(function (key) {
                var field = fields[key];

                lineData[key] = targetRecord.getSublistValue({
                    sublistId: sublistId,
                    fieldId: field.name,
                    line: line
                });
            });

            lines.push(lineData);
        }

        return lines;
    }

    return {
        bodyFields: bodyFields,
        sublistFields: sublistFields
    };
});

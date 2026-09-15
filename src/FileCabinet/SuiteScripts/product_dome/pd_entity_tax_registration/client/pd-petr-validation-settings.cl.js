/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        '../service/pd-petr-validation-settings'
    ],
    function (
        validationSettingsService
    ) {

        function pageInit(context) {
            return validationSettingsService.managePageInit(context);
        }

        function fieldChanged(context) {
            return validationSettingsService.manageFieldChanged(context);
        }

        return {
            pageInit: pageInit,
            fieldChanged: fieldChanged
        };
    }
);

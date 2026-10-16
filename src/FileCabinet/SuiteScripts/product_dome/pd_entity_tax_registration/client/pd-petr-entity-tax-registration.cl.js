/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * O modo do formulário é lido no clique do botão (URL + id do record), e não no pageInit:
 * context.mode do pageInit nunca vale "view" (só create/copy/edit), e o pageInit sequer roda
 * em modo View.
 */
define(
    [
        'N/currentRecord',
        '../service/pd-petr-entity'
    ],
    function (
        currentRecord,
        entityService
    ) {

        function pageInit(context) {
            return entityService.managePageInit(context);
        }

        function fieldChanged(context) {
            return entityService.manageFieldChanged(context);
        }

        function validateField(context) {
            return entityService.validateField(context);
        }

        function saveRecord(context) {
            return entityService.manageSaveRecord(context);
        }

        function getRecordMode(rec) {
            if (!rec.id) return 'create';

            var hasEditParam = window.location.href.indexOf('e=T') !== -1;
            return hasEditParam ? 'edit' : 'view';
        }

        function fetchCNPJ() {
            var rec = currentRecord.get();
            entityService.fetchCNPJ(rec, getRecordMode(rec));
        }

        return {
            pageInit: pageInit,
            fieldChanged: fieldChanged,
            validateField: validateField,
            saveRecord: saveRecord,
            fetchCNPJ: fetchCNPJ
        };
    }
);

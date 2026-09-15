/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
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

        // context.mode do pageInit nunca vale 'view' (só 'create'/'copy'/'edit'), e pageInit
        // sequer roda em modo View — por isso o modo é lido aqui, no clique do botão, a partir
        // da URL e do id do record, em vez de depender do valor capturado no pageInit.
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

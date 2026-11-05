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
 *
 * Uma função de clique por botão: "Consultar CNPJ" (fetchCNPJ, modo DEFAULT = hierarquia) e os
 * botões da DirectD (fetchDirectd*, modos DD_*), todas via entityService.fetchCNPJ.
 */
define(
    [
        'N/currentRecord',
        '../modules/pd-petr-constants',
        '../service/pd-petr-entity'
    ],
    function (
        currentRecord,
        constantsModule,
        entityService
    ) {
        var LOOKUP_MODES = constantsModule.LOOKUP_MODES;

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

        function runLookup(lookupMode) {
            var rec = currentRecord.get();
            entityService.fetchCNPJ(rec, getRecordMode(rec), lookupMode);
        }

        function fetchCNPJ() {
            runLookup(LOOKUP_MODES.DEFAULT);
        }

        function fetchDirectdFull() {
            runLookup(LOOKUP_MODES.DD_FULL);
        }

        function fetchDirectdPlus() {
            runLookup(LOOKUP_MODES.DD_PLUS);
        }

        function fetchDirectdBasic() {
            runLookup(LOOKUP_MODES.DD_BASIC);
        }

        function fetchDirectdStateReg() {
            runLookup(LOOKUP_MODES.DD_IE);
        }

        return {
            pageInit: pageInit,
            fieldChanged: fieldChanged,
            validateField: validateField,
            saveRecord: saveRecord,
            fetchCNPJ: fetchCNPJ,
            fetchDirectdFull: fetchDirectdFull,
            fetchDirectdPlus: fetchDirectdPlus,
            fetchDirectdBasic: fetchDirectdBasic,
            fetchDirectdStateReg: fetchDirectdStateReg
        };
    }
);

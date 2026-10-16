/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Registro PD | PETR | Configuração das Validações: grava a ciência (Ciente em/Ciente por) ao
 * marcar "Busca Automática de Data de Nascimento (Hub)" e reforça no servidor a dependência com
 * "Consultar CPF (Hub)". Toda a lógica fica em pd-petr-validation-settings.manageBeforeSubmit.
 */
define(
    [
        '../service/pd-petr-validation-settings'
    ],
    function (
        validationSettingsService
    ) {

        function beforeSubmit(context) {
            validationSettingsService.manageBeforeSubmit(context);
        }

        return {
            beforeSubmit: beforeSubmit
        };
    }
);

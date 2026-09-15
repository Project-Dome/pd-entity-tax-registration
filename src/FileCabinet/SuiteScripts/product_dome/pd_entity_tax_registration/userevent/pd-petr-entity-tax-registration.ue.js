/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        'N/runtime',
        '../modules/pd-petr-constants',
        '../service/pd-petr-entity',
        '../service/pd-petr-validation-settings'
    ],
    function (
        runtime,
        constantsModule,
        entityService,
        validationSettingsService
    ) {

        function beforeLoad(context) {
            var isUI = runtime.executionContext === runtime.ContextType.USER_INTERFACE;
            var isCreateEditOrView = context.type === context.UserEventType.CREATE
                || context.type === context.UserEventType.EDIT
                || context.type === context.UserEventType.VIEW;

            if (!isUI || !isCreateEditOrView) return;

            var settings = validationSettingsService.get(); 

            // Sem registro de configuração o botão continua visível de propósito: é ao clicar
            // nele que o usuário recebe o aviso para criar as Configurações de Validação.
            var shouldShowCnpjButton = !settings || settings.enableCnpjButton;

            log.debug({
                title: 'pd-petr-entity-tax-registration.ue.js | beforeLoad',
                details: 'shouldShowCnpjButton: ' + shouldShowCnpjButton
            });

            if (shouldShowCnpjButton) {
                context.form.addButton({
                    id: constantsModule.BUTTON.ID,
                    label: constantsModule.BUTTON.LABEL,
                    functionName: constantsModule.BUTTON.FUNCTION
                });
                context.form.clientScriptModulePath = constantsModule.SCRIPTS.CLIENT_SCRIPT_PATH;
            }
        }

        function beforeSubmit(context) {
            if (context.type === context.UserEventType.CSVIMPORT) {
                entityService.manageCsvImport(context.newRecord);
                return;
            }

            entityService.manageBeforeSubmitServer(context);
        }

        return {
            beforeLoad: beforeLoad,
            beforeSubmit: beforeSubmit
        };
    }
);

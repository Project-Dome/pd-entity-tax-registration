/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Sem registro de Configuração das Validações o botão "Consultar CNPJ" continua visível de
 * propósito: é ao clicar nele que o usuário recebe o aviso para criar o registro.
 *
 * Com "Consultar CPF (Hub)" marcado o botão passa a se chamar "Consultar CPF/CNPJ" — mesmo
 * botão e mesma função; o desvio para a consulta de CPF acontece em pd-petr-cnpj-lookup.js.
 *
 * Botões da DirectD (DIRECTD_BUTTONS): um por flag marcada na Configuração das Validações. Só
 * dependem dessa flag — a habilitação e o token da DirectD são checados no clique, para o User
 * Event não ler a Configuração das APIs (guarda os tokens e pode não estar acessível ao papel).
 */
define(
    [
        'N/runtime',
        '../modules/pd-petr-constants',
        '../service/pd-petr-entity',
        '../service/pd-petr-entity-lookup',
        '../service/pd-petr-validation-settings'
    ],
    function (
        runtime,
        constantsModule,
        entityService,
        entityLookupService,
        validationSettingsService
    ) {

        function beforeLoad(context) {
            var isUI = runtime.executionContext === runtime.ContextType.USER_INTERFACE;
            var isCreateEditOrView = context.type === context.UserEventType.CREATE
                || context.type === context.UserEventType.EDIT
                || context.type === context.UserEventType.VIEW;

            if (!isUI || !isCreateEditOrView) return;

            var settings = validationSettingsService.get(); 

            var shouldShowCnpjButton = !settings || settings.enableCnpjButton;

            log.debug({
                title: 'pd-petr-entity-tax-registration.ue.js | beforeLoad',
                details: 'shouldShowCnpjButton: ' + shouldShowCnpjButton
            });

            if (shouldShowCnpjButton) {
                var buttonLabel = settings && settings.enableCpfLookup
                    ? constantsModule.BUTTON.LABEL_WITH_CPF
                    : constantsModule.BUTTON.LABEL;

                context.form.addButton({
                    id: constantsModule.BUTTON.ID,
                    label: buttonLabel,
                    functionName: constantsModule.BUTTON.FUNCTION
                });
            }

            var directdButtons = settings
                ? constantsModule.DIRECTD_BUTTONS.filter(function (button) { return settings[button.SETTING]; })
                : [];

            directdButtons.forEach(function (button) {
                context.form.addButton({
                    id: button.ID,
                    label: button.LABEL,
                    functionName: button.FUNCTION
                });
            });

            if (shouldShowCnpjButton || directdButtons.length) {
                context.form.clientScriptModulePath = constantsModule.SCRIPTS.CLIENT_SCRIPT_PATH;
            }
        }

        function beforeSubmit(context) {
            if (context.type === context.UserEventType.CSVIMPORT) {
                entityLookupService.manageCsvImport(context.newRecord);
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

/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Painel do Cadastro Fiscal (docs/specs/tax-registration-panel.md) — Suitelet-casca no padrão de
 * dbanking/remittance_file (pd-dbk-batch-send.sl.js): só monta a página com os estáticos de
 * PANEL.STATICS e entrega em SUITELET_PARAMETERS as URLs do RESTlet de leitura do painel
 * (panelUrl) e do RESTlet de atualização já existente (updateUrl). Toda leitura e ação acontece
 * no JS estático, via esses RESTlets.
 */
define(
    [
        'N/url',
        '../modules/pd-petr-constants',
        '../util/pd-petr-suitelet'
    ],
    function (
        url,
        constantsModule,
        suiteletUtil
    ) {
        var PANEL = constantsModule.PANEL;
        var SCRIPTS = constantsModule.SCRIPTS;

        function onRequest(context) {
            try {
                suiteletUtil.build({
                    context: context,
                    title: PANEL.TITLE,
                    jquery: true,
                    bootstrap: true,
                    statics: {
                        html: [PANEL.STATICS.HTML],
                        js: [PANEL.STATICS.JS],
                        css: [PANEL.STATICS.CSS]
                    },
                    parameters: {
                        homeUrl: PANEL.HOME_URL,
                        panelUrl: url.resolveScript({
                            scriptId: SCRIPTS.PANEL_RESTLET.SCRIPT_ID,
                            deploymentId: SCRIPTS.PANEL_RESTLET.DEPLOY_ID
                        }),
                        updateUrl: url.resolveScript({
                            scriptId: SCRIPTS.RESTLET.SCRIPT_ID,
                            deploymentId: SCRIPTS.RESTLET.DEPLOY_ID
                        })
                    }
                });
            } catch (e) {
                log.error('pd-petr-tax-registration-panel.sl.onRequest', e);
                context.response.write('Não foi possível abrir o Painel do Cadastro Fiscal: ' + e.message
                    + '. Se o problema persistir, acione a equipe Dome.');
            }
        }

        return {
            onRequest: onRequest
        };
    }
);

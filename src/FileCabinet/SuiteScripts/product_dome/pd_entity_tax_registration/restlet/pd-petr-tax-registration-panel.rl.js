/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Leituras do Painel do Cadastro Fiscal (docs/specs/tax-registration-panel.md §6.2), chamadas pelo
 * JS estático do painel via GET ?action=...: settings (saldos, modos, preços e cota da ReceitaWS),
 * creditUsage (consumo paginado) e entities (clientes/fornecedores paginados). Responde sempre
 * { success: true, data } ou { success: false, error }. POST { action: 'setCountry', recordType,
 * id, country } grava só o País da entidade, escolhido na tabela. A atualização das entidades não passa
 * por aqui: o painel chama o RESTlet existente pd-petr-entity-tax-registration.rl.js por id.
 */
define(
    [
        '../modules/pd-petr-constants',
        '../service/pd-petr-tax-registration-panel'
    ],
    function (
        constantsModule,
        panelService
    ) {
        var ACTIONS = constantsModule.PANEL.ACTIONS;

        function get(parameters) {
            try {
                var params = parameters || {};

                switch (params.action) {
                    case ACTIONS.SETTINGS:
                        return { success: true, data: panelService.getSettings() };
                    case ACTIONS.CREDIT_USAGE:
                        return { success: true, data: panelService.listCreditUsage(params) };
                    case ACTIONS.ENTITIES:
                        return { success: true, data: panelService.listEntities(params) };
                    default:
                        return { success: false, error: 'Ação não suportada: ' + params.action };
                }
            } catch (e) {
                log.error('pd-petr-tax-registration-panel.rl.get', e);
                return { success: false, error: e.message };
            }
        }

        function post(body) {
            try {
                var data = body || {};

                switch (data.action) {
                    case ACTIONS.SET_COUNTRY:
                        return { success: true, data: panelService.setCountry(data) };
                    default:
                        return { success: false, error: 'Ação não suportada: ' + data.action };
                }
            } catch (e) {
                log.error('pd-petr-tax-registration-panel.rl.post', e);
                return { success: false, error: e.message };
            }
        }

        return {
            get: get,
            post: post
        };
    }
);

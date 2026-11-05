/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Registro PD | PETR | Configuração das APIs: ao abrir o registro na interface, mostra o saldo
 * atual de cada provedor em "Créditos Disponíveis (Hub)" e "Créditos Disponíveis (R$)" (campos
 * não gravados). Toda a lógica fica em pd-petr-credit-usage.fillCurrentBalances
 * (docs/specs/directd-integration.md §4.6).
 */
define(
    [
        '../service/pd-petr-credit-usage'
    ],
    function (
        creditUsageService
    ) {

        function beforeLoad(context) {
            creditUsageService.fillCurrentBalances(context);
        }

        return {
            beforeLoad: beforeLoad
        };
    }
);

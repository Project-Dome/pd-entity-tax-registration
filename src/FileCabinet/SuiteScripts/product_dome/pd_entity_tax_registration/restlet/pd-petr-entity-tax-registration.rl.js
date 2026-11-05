/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Duas ações, conforme o corpo da requisição: por id (modo view — carrega, preenche e salva o
 * record no servidor) ou por CNPJ (modo create/edit — só consulta, o cliente preenche os
 * campos). Ver pd-petr-entity.js (fetchCNPJViaRestlet x fetchCompanyDataViaRestlet).
 *
 * O corpo traz também "mode" (LOOKUP_MODES: DEFAULT = hierarquia; DD_* = botões da DirectD) e,
 * no DD_IE em create/edit, "uf" (estado do endereço lido pelo Client Script).
 */
define(
    [
        '../service/pd-petr-entity-lookup'
    ],
    function (
        entityLookupService
    ) {

        function post(requestBody) {
            try {
                if (requestBody.id) {
                    return entityLookupService.fetchCNPJForRecord(requestBody.recordType, requestBody.id, requestBody.mode);
                }

                return entityLookupService.fetchCompanyDataForCnpj(
                    requestBody.cnpj,
                    requestBody.birthDate,
                    requestBody.mode,
                    requestBody.uf
                );
            } catch (e) {
                log.error('pd-petr-entity-tax-registration.rl.post', e);
                return { success: false, error: e.message };
            }
        }

        return {
            post: post
        };
    }
);

/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        '../service/pd-petr-entity-lookup'
    ],
    function (
        entityLookupService
    ) {

        // Duas ações, conforme o corpo da requisição: por id (modo view — carrega, preenche e
        // salva o record no servidor) ou por CNPJ (modo create/edit — só consulta, o cliente
        // preenche os campos). Ver client/pd-petr-entity-tax-registration.cl.js e
        // service/pd-petr-entity.js (fetchCNPJViaRestlet vs. fetchCompanyDataViaRestlet).
        function post(requestBody) {
            try {
                if (requestBody.id) {
                    return entityLookupService.fetchCNPJForRecord(requestBody.recordType, requestBody.id);
                }

                return entityLookupService.fetchCompanyDataForCnpj(requestBody.cnpj);
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

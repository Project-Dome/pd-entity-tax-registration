/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define(
    [
        '../service/pd-petr-entity'
    ],
    function (
        entityService
    ) {

        function post(requestBody) {
            try {
                return entityService.fetchCNPJForRecord(requestBody.recordType, requestBody.id);
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

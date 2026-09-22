/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
define([], function () {

    // Converte o JSON do ReceitaWS para o shape canônico — o mesmo shape que a BrasilAPI já
    // devolve hoje, consumido sem alteração por pd-petr-mapper.js e pd-petr-validators.js.
    // Ver tabela de mapeamento em docs/specs/multi-provider-cnpj-lookup.md, seção 2.
    function toCanonical(body) {
        return {
            cnpj: body.cnpj,
            razao_social: body.nome,
            nome_fantasia: body.fantasia,
            descricao_situacao_cadastral: body.situacao,
            logradouro: body.logradouro,
            numero: body.numero,
            complemento: body.complemento,
            bairro: body.bairro,
            cep: body.cep,
            uf: body.uf,
            municipio: body.municipio,
            // ReceitaWS não retorna código IBGE — pd-petr-mapper.js resolve a cidade por
            // municipio + uf quando este campo não vem preenchido.
            codigo_municipio_ibge: undefined,
            email: body.email,
            // ReceitaWS clássico só tem um campo de telefone, às vezes com mais de um número
            // separado por "/" — usa só o primeiro. pd-petr-mapper.js já normaliza qualquer
            // formatação (remove tudo que não é dígito), não precisa pré-formatar aqui.
            ddd_telefone_1: firstPhone(body.telefone),
            ddd_telefone_2: undefined,
            ddd_fax: undefined,
            opcao_pelo_simples: !!(body.simples && body.simples.optante === true),
            opcao_pelo_mei: !!(body.simei && body.simei.optante === true),
            // ReceitaWS não tem equivalente ao histórico regime_tributario (Lucro
            // Presumido/Real) da BrasilAPI — resolveTaxRegimeLabel() do mapper já prioriza
            // opcao_pelo_simples/opcao_pelo_mei antes de olhar este array, então a limitação
            // (só Simples/MEI ou em branco) é automática, sem precisar tocar no mapper.
            regime_tributario: [],
            qsa: body.qsa
        };
    }

    function firstPhone(telefone) {
        if (!telefone) return undefined;
        return String(telefone).split('/')[0].trim();
    }

    return { toCanonical: toCanonical };
});

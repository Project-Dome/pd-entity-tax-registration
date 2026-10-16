/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Converte o JSON do ReceitaWS para o shape canônico do módulo, consumido sem alteração por
 * pd-petr-mapper.js e pd-petr-validators.js (tabela em docs/specs/multi-provider-cnpj-lookup.md, §2).
 *
 * Limitações do ReceitaWS: sem código IBGE (o mapper resolve a cidade por CEP ou
 * municipio + uf); um único campo de telefone, às vezes com vários números separados por "/"
 * (usa só o primeiro); sem histórico de regime tributário (Regime Tributário fica só
 * Simples/MEI ou em branco); sem Inscrição Estadual.
 */
define([], function () {

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
            codigo_municipio_ibge: undefined,
            email: body.email,
            ddd_telefone_1: firstPhone(body.telefone),
            opcao_pelo_simples: !!(body.simples && body.simples.optante === true),
            opcao_pelo_mei: !!(body.simei && body.simei.optante === true),
            regime_tributario: [],
            qsa: body.qsa,
            inscricao_estadual: undefined
        };
    }

    function firstPhone(telefone) {
        if (!telefone) return undefined;
        return String(telefone).split('/')[0].trim();
    }

    return { toCanonical: toCanonical };
});

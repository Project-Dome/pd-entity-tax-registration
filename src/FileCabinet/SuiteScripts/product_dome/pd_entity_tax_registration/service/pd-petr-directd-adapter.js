/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Converte o "retorno" das APIs da DirectD para o shape canônico do módulo — o mesmo de
 * pd-petr-receitaws-adapter.js e pd-petr-hub-adapter.js (docs/specs/directd-integration.md §4.4
 * e §6.2). Funções puras.
 *
 * - toCanonical: Cadastro – Pessoa Jurídica – Plus e Básica (mesma estrutura; a Básica não traz
 *   opcaoSimples/opcaoMEI). Endereço, telefone e e-mail vêm do primeiro item de enderecos[],
 *   telefones[] e emails[]. Sem código IBGE.
 * - toCanonicalFromFederalRevenue: Receita Federal – Pessoa Jurídica (campos diretos, sem
 *   Simples/MEI). Telefone pode vir com vários números separados por "/" — usa o primeiro.
 * - toStateRegistration: Sintegra. IE de "ie"; vazia, a primeira de inscricoesEstaduais[] da UF
 *   consultada e habilitada. Devolve também o código IBGE (informacaoIBGE.codigo) e o
 *   regimeApuracao. applyStateRegistration junta isso ao cadastro do Plus/Básico/Receita PJ:
 *   com useRegimeApuracao (cadastro veio de API sem Simples/MEI), regimeApuracao contendo
 *   "SIMPLES" marca opcao_pelo_simples.
 * - Mapeamento escrito a partir do exemplo da documentação da DirectD. Os valores de opcaoSimples,
 *   opcaoMEI e ativoHabilitada ainda não foram conferidos numa resposta real (Parte 0 do
 *   checklist da spec): isAffirmative aceita as formas mais prováveis ("S", "SIM", true...).
 */
define([], function () {

    var AFFIRMATIVE_VALUES = ['S', 'SIM', 'TRUE', '1', 'Y', 'YES', 'OPTANTE', 'ATIVA', 'ATIVO', 'HABILITADA', 'HABILITADO'];

    function isAffirmative(value) {
        if (value === true) return true;
        if (value === null || value === undefined) return false;
        return AFFIRMATIVE_VALUES.indexOf(String(value).trim().toUpperCase()) !== -1;
    }

    function firstItem(list) {
        return (list && list.length) ? list[0] : {};
    }

    function firstPhone(telefone) {
        if (!telefone) return undefined;
        return String(telefone).split('/')[0].trim();
    }

    function toCanonical(retorno) {
        var address = firstItem(retorno.enderecos);

        return {
            cnpj: retorno.cnpj,
            razao_social: retorno.razaoSocial,
            nome_fantasia: retorno.nomeFantasia,
            descricao_situacao_cadastral: retorno.situacaoCadastral,
            logradouro: address.logradouro,
            numero: address.numero,
            complemento: address.complemento,
            bairro: address.bairro,
            cep: address.cep,
            uf: address.uf,
            municipio: address.cidade,
            codigo_municipio_ibge: undefined,
            email: firstItem(retorno.emails).enderecoEmail,
            ddd_telefone_1: firstItem(retorno.telefones).telefoneComDDD,
            opcao_pelo_simples: isAffirmative(retorno.opcaoSimples),
            opcao_pelo_mei: isAffirmative(retorno.opcaoMEI),
            regime_tributario: [],
            qsa: retorno.socios,
            inscricao_estadual: undefined
        };
    }

    function toCanonicalFromFederalRevenue(retorno) {
        return {
            cnpj: retorno.numeroInscricao,
            razao_social: retorno.nomeEmpresarial,
            nome_fantasia: retorno.nomeFantasia,
            descricao_situacao_cadastral: retorno.situacaoCadastral,
            logradouro: retorno.logradouro,
            numero: retorno.numero,
            complemento: retorno.complemento,
            bairro: retorno.bairroDistrito,
            cep: retorno.cep,
            uf: retorno.uf,
            municipio: retorno.municipio,
            codigo_municipio_ibge: undefined,
            email: retorno.enderecoEletronico,
            ddd_telefone_1: firstPhone(retorno.telefone),
            opcao_pelo_simples: false,
            opcao_pelo_mei: false,
            regime_tributario: [],
            qsa: retorno.socios,
            inscricao_estadual: undefined
        };
    }

    function toStateRegistration(retorno, uf) {
        var targetUf = String(uf || '').toUpperCase();
        var stateRegistration = retorno.ie ? String(retorno.ie).trim() : '';

        if (!stateRegistration) {
            var match = (retorno.inscricoesEstaduais || []).filter(function (entry) {
                return String(entry.uf || '').toUpperCase() === targetUf
                    && isAffirmative(entry.ativoHabilitada)
                    && entry.inscricao;
            })[0];

            stateRegistration = match ? String(match.inscricao).trim() : '';
        }

        return {
            inscricao_estadual: stateRegistration || undefined,
            codigo_municipio_ibge: retorno.informacaoIBGE ? retorno.informacaoIBGE.codigo : undefined,
            regime_apuracao: retorno.regimeApuracao
        };
    }

    function applyStateRegistration(companyData, stateRegistrationData, useRegimeApuracao) {
        var merged = Object.assign({}, companyData);

        merged.inscricao_estadual = stateRegistrationData.inscricao_estadual;

        if (stateRegistrationData.codigo_municipio_ibge) {
            merged.codigo_municipio_ibge = stateRegistrationData.codigo_municipio_ibge;
        }

        var isSimplesByRegime = String(stateRegistrationData.regime_apuracao || '').toUpperCase().indexOf('SIMPLES') !== -1;

        if (useRegimeApuracao && isSimplesByRegime) merged.opcao_pelo_simples = true;

        return merged;
    }

    return {
        toCanonical: toCanonical,
        toCanonicalFromFederalRevenue: toCanonicalFromFederalRevenue,
        toStateRegistration: toStateRegistration,
        applyStateRegistration: applyStateRegistration
    };
});

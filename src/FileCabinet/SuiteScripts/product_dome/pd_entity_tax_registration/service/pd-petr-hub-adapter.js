/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Converte o "result" da Hub do Desenvolvedor (v2/cnpj) para o shape canônico do módulo — o
 * mesmo de pd-petr-receitaws-adapter.js. Os nomes seguem o padrão do ReceitaWS, exceto CNPJ
 * (numero_de_inscricao), sócios (quadro_socios) e Inscrições Estaduais (inscricoes_estaduais,
 * só com ie=1). Mapeamento conferido contra uma resposta real da API em 2026-10-06.
 *
 * Limitações da Hub: sem código IBGE; telefone único, às vezes com vários números separados
 * por "/" (usa só o primeiro); sem Simples/MEI (Regime Tributário fica em branco).
 *
 * Inscrição Estadual: usa ie_uf_origem; só se vier vazio, cai para a IE ativa (ativado "1")
 * da mesma UF do endereço em outras_ies.
 *
 * toCanonicalPerson converte o "result" do v2/cpf (nome_da_pf, situacao_cadastral, conforme a
 * documentação da Hub) para um shape próprio de pessoa física, marcado com tipo_pessoa "PF" —
 * é essa marca que faz pd-petr-mapper.js e pd-petr-validators.js tratarem o retorno como CPF.
 *
 * toBirthDate lê a data de nascimento do "result" do v2/nome_cpf. O formato desse retorno ainda
 * não foi conferido contra uma resposta real — aceita data_nascimento, data_de_nascimento ou
 * nascimento até a primeira consulta confirmar o nome do campo (ver log do body em
 * pd-petr-hub-api.getNameAndBirthDate).
 */
define([], function () {

    function toCanonical(result) {
        return {
            cnpj: result.numero_de_inscricao || result.cnpj,
            razao_social: result.nome,
            nome_fantasia: result.fantasia,
            descricao_situacao_cadastral: result.situacao,
            logradouro: result.logradouro,
            numero: result.numero,
            complemento: result.complemento,
            bairro: result.bairro,
            cep: result.cep,
            uf: result.uf,
            municipio: result.municipio,
            codigo_municipio_ibge: undefined,
            email: result.email,
            ddd_telefone_1: firstPhone(result.telefone),
            opcao_pelo_simples: !!(result.simples && result.simples.optante === true),
            opcao_pelo_mei: !!(result.simei && result.simei.optante === true),
            regime_tributario: [],
            qsa: result.quadro_socios,
            inscricao_estadual: resolveStateRegistration(result.inscricoes_estaduais, result.uf)
        };
    }

    function toCanonicalPerson(result) {
        return {
            tipo_pessoa: 'PF',
            cpf: result.numero_de_cpf,
            nome: result.nome_da_pf,
            situacao_cadastral: result.situacao_cadastral,
            data_nascimento: result.data_nascimento
        };
    }

    function toBirthDate(result) {
        if (!result) return undefined;
        return result.data_nascimento || result.data_de_nascimento || result.nascimento || undefined;
    }

    function resolveStateRegistration(stateRegistrations, uf) {
        if (!stateRegistrations || stateRegistrations['return'] !== 'OK') return undefined;

        if (stateRegistrations.ie_uf_origem) return stateRegistrations.ie_uf_origem;

        var match = (stateRegistrations.outras_ies || []).filter(function (entry) {
            return entry.uf === uf && String(entry.ativado) === '1' && entry.numero;
        })[0];

        return match ? match.numero : undefined;
    }

    function firstPhone(telefone) {
        if (!telefone) return undefined;
        return String(telefone).split('/')[0].trim();
    }

    return {
        toCanonical: toCanonical,
        toCanonicalPerson: toCanonicalPerson,
        toBirthDate: toBirthDate
    };
});

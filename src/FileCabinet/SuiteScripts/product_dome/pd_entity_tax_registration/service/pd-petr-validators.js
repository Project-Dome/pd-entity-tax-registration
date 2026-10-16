/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Vinicius Betim
 */
/*
 * validateCNPJ suporta o CNPJ alfanumérico da Receita Federal: o dígito verificador usa o
 * código ASCII de cada caractere menos 48 (0-9 => 0-9, A-Z => 17-42).
 *
 * validateApiResponse: retorno de CNPJ precisa estar "ATIVA"; retorno de CPF (tipo_pessoa "PF")
 * precisa estar "REGULAR". Fora disso devolve um aviso — não bloqueia o cadastro.
 */
define([], function () {

    function validateCNPJ(cnpj) {
        cnpj = String(cnpj).toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (cnpj.length !== 14) return false;
        if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
        if (/^(.)\1+$/.test(cnpj)) return false;

        function charValue(ch) {
            return ch.charCodeAt(0) - 48;
        }

        var tamanho, base, digitos, soma, pos, i, resultado;

        tamanho = 12;
        base = cnpj.substring(0, tamanho);
        digitos = cnpj.substring(tamanho);
        soma = 0;
        pos = tamanho - 7;

        for (i = tamanho; i >= 1; i--) {
            soma += charValue(base.charAt(tamanho - i)) * pos--;
            if (pos < 2) pos = 9;
        }
        resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
        if (resultado !== parseInt(digitos.charAt(0), 10)) return false;

        tamanho = 13;
        base = cnpj.substring(0, tamanho);
        soma = 0;
        pos = tamanho - 7;

        for (i = tamanho; i >= 1; i--) {
            soma += charValue(base.charAt(tamanho - i)) * pos--;
            if (pos < 2) pos = 9;
        }
        resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
        if (resultado !== parseInt(digitos.charAt(1), 10)) return false;

        return true;
    }

    function validateCPF(cpf) {
        cpf = String(cpf).replace(/\D/g, '');
        if (cpf.length !== 11) return false;
        if (/^(\d)\1+$/.test(cpf)) return false;

        var i, soma, resto;

        soma = 0;
        for (i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i), 10) * (10 - i);
        resto = (soma * 10) % 11;
        if (resto === 10 || resto === 11) resto = 0;
        if (resto !== parseInt(cpf.charAt(9), 10)) return false;

        soma = 0;
        for (i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i), 10) * (11 - i);
        resto = (soma * 10) % 11;
        if (resto === 10 || resto === 11) resto = 0;
        if (resto !== parseInt(cpf.charAt(10), 10)) return false;

        return true;
    }

    function validateApiResponse(body) {
        if (body.tipo_pessoa === 'PF') {
            var personStatus = body.situacao_cadastral || '';
            if (personStatus.toUpperCase() !== 'REGULAR') {
                return {
                    valid: false,
                    title: 'Situação Cadastral do CPF',
                    message: 'O CPF ' + body.cpf + ' não está regular na Receita Federal. Situação atual: ' + personStatus
                };
            }
            return { valid: true };
        }

        var status = body.descricao_situacao_cadastral || '';
        if (status.toUpperCase() !== 'ATIVA') {
            return {
                valid: false,
                title: 'Situação Cadastral do CNPJ',
                message: 'O CNPJ ' + body.cnpj + ' não está ativo. Situação atual: ' + status
            };
        }
        return { valid: true };
    }

    return {
        validateCNPJ: validateCNPJ,
        validateCPF: validateCPF,
        validateApiResponse: validateApiResponse
    };
});

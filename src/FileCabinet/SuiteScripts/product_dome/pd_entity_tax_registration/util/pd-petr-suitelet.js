/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @author Produto Dome - Mario Augusto Braga Costa
 */
/*
 * Monta a página de um Suitelet-casca (cópia de dbanking/util/pd-dbk-suitelet.js): HTML, CSS e
 * JS estáticos do File Cabinet + jQuery/Bootstrap por CDN + os parâmetros da página em
 * SUITELET_PARAMETERS (acrescidos do usuário logado).
 *
 * - Os estáticos são localizados pelo NOME do arquivo em todo o File Cabinet (busca do tipo
 *   "file"): o nome precisa ser único na conta. O HTML é lido e embutido no <body>; CSS e JS
 *   entram pela URL do arquivo.
 * - Arquivo não encontrado ou ilegível lança NsSuiteletException com o nome do arquivo.
 * - Nome encontrado mais de uma vez também lança (DUPLICATE_FILE_NAME), em vez de servir o arquivo
 *   errado em silêncio (ex.: o service homônimo carregado no navegador no lugar do JS da tela).
 * - A URL de CSS/JS leva ?v=<data de alteração do arquivo>: a cada deploy o navegador baixa a
 *   versão nova em vez de usar a do cache (o HTML já vem embutido, não precisa).
 */
define(
    [
        'N/runtime',
        'N/search',
        'N/file'
    ],
    function (runtime, search, file) {

        const JQUERY_CDN = 'https://code.jquery.com/jquery-3.7.1.min.js';
        const BOOTSTRAP_CSS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
        const BOOTSTRAP_JS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js';
        const BOOTSTRAP_ICONS = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css';

        function build(options) {
            validateBuildOptions(options);
            options.context.response.write(buildHTML(options));
        }

        function buildHTML(options) {
            const projectFiles = resolveProjectFiles(options.statics);
            const parametersBlock = buildParametersBlock(options.parameters);

            return [
                '<!DOCTYPE html>',
                '<html lang="pt-BR">',
                '<head>',
                '<meta charset="UTF-8">',
                '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
                '<title>' + esc(options.title) + '</title>',
                options.bootstrap === true ? '<link rel="stylesheet" href="' + BOOTSTRAP_CSS + '">' : '',
                options.bootstrap === true ? '<link rel="stylesheet" href="' + BOOTSTRAP_ICONS + '">' : '',
                projectFiles.css.map(function (url) { return '<link rel="stylesheet" href="' + url + '">'; }).join(''),
                '</head>',
                '<body>',
                projectFiles.html.join(''),
                parametersBlock,
                options.jquery === true ? '<script src="' + JQUERY_CDN + '"></script>' : '',
                options.bootstrap === true ? '<script src="' + BOOTSTRAP_JS + '"></script>' : '',
                projectFiles.js.map(function (url) { return '<script src="' + url + '"></script>'; }).join(''),
                '</body>',
                '</html>'
            ].join('');
        }

        function resolveProjectFiles(statics) {
            const result = { html: [], js: [], css: [] };

            const htmlFiles = statics.html || [];
            const jsFiles = statics.js || [];
            const cssFiles = statics.css || [];

            const fileMap = resolveProjectFileMap(htmlFiles.concat(jsFiles).concat(cssFiles));

            htmlFiles.forEach(function (fileName) {
                const entry = fileMap[fileName.toLowerCase().trim()];
                if (!entry) {
                    throw buildException('HTML_FILE_NOT_FOUND', 'Arquivo HTML não encontrado no File Cabinet: "' + fileName + '"');
                }
                try {
                    result.html.push(file.load({ id: entry.id }).getContents());
                } catch (e) {
                    throw buildException('HTML_FILE_LOAD_ERROR', 'Erro ao carregar conteúdo do arquivo HTML: "' + fileName + '". Detalhe: ' + (e.message || String(e)));
                }
            });

            jsFiles.forEach(function (fileName) {
                const entry = fileMap[fileName.toLowerCase().trim()];
                if (!entry) {
                    throw buildException('JS_FILE_NOT_FOUND', 'Arquivo JS não encontrado no File Cabinet: "' + fileName + '"');
                }
                result.js.push(entry.url);
            });

            cssFiles.forEach(function (fileName) {
                const entry = fileMap[fileName.toLowerCase().trim()];
                if (!entry) {
                    throw buildException('CSS_FILE_NOT_FOUND', 'Arquivo CSS não encontrado no File Cabinet: "' + fileName + '"');
                }
                result.css.push(entry.url);
            });

            return result;
        }

        function resolveProjectFileMap(fileNames) {
            const map = {};

            const toSearch = fileNames.filter(function (name) { return !!name; });
            if (toSearch.length === 0) return map;

            const filters = [];
            toSearch.forEach(function (fileName, index) {
                if (index > 0) filters.push('or');
                filters.push(['name', 'is', fileName]);
            });

            search.create({
                type: 'file',
                filters: filters,
                columns: [
                    search.createColumn({ name: 'name' }),
                    search.createColumn({ name: 'url' }),
                    search.createColumn({ name: 'modified' })
                ]
            }).run().each(function (result) {
                const name = (result.getValue({ name: 'name' }) || '').toLowerCase().trim();
                if (name && map[name]) {
                    throw buildException('DUPLICATE_FILE_NAME', 'Há mais de um arquivo "' + name + '" no File Cabinet: o nome dos estáticos precisa ser único na conta.');
                }
                if (name) {
                    map[name] = { url: withVersion(result.getValue({ name: 'url' }), result.getValue({ name: 'modified' })), id: result.id };
                }
                return true;
            });

            return map;
        }

        function withVersion(fileUrl, modified) {
            if (!fileUrl || !modified) return fileUrl;
            return fileUrl + (fileUrl.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(modified);
        }

        function buildParametersBlock(extraParams) {
            const user = runtime.getCurrentUser();
            const params = Object.assign({}, extraParams || {}, {
                currentUserId: user.id,
                currentUserEmail: user.email,
                currentUserName: user.name,
                currentUserRole: user.roleId
            });
            return [
                '<script type="text/javascript">',
                'const SUITELET_PARAMETERS = ' + JSON.stringify(params).replace(/</g, '\\u003c'),
                '</script>'
            ].join('');
        }

        function validateBuildOptions(options) {
            if (options == null) {
                throw buildException('MISSING_OPTIONS', 'Parâmetro "options" é obrigatório.');
            }
            if (options.context == null) {
                throw buildException('MISSING_CONTEXT', 'options.context é obrigatório.');
            }
            if (!options.title) {
                throw buildException('MISSING_TITLE', 'options.title é obrigatório.');
            }
            if (options.statics == null || !Array.isArray(options.statics.html) || options.statics.html.length === 0) {
                throw buildException('MISSING_STATICS_HTML', 'options.statics.html é obrigatório e deve conter ao menos um arquivo.');
            }
        }

        function esc(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function buildException(code, message) {
            const err = new Error(message);
            err.code = code;
            err.name = 'NsSuiteletException';
            return err;
        }

        return {
            build: build
        };
    }
);

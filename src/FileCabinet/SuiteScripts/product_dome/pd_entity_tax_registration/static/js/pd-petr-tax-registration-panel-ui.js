/*
 * Painel do Cadastro Fiscal (docs/specs/tax-registration-panel.md) — JS estático carregado pelo
 * Suitelet-casca pd-petr-tax-registration-panel.sl.js. Mesmo padrão de dbanking
 * (pd-dbk-batch-send.js): jQuery + Bootstrap 5, chamadas aos RESTlets sempre pelo helper
 * restlet() com $.ajax (fetch não envia o cookie de sessão para o domínio dos RESTlets).
 *
 * - Leituras: RESTlet do painel (SUITELET_PARAMETERS.panelUrl), ?action=settings|creditUsage|
 *   entities, resposta { success, data } ou { success: false, error }.
 * - Atualização em massa: POST no RESTlet existente (SUITELET_PARAMETERS.updateUrl) com
 *   { recordType, id, mode }, UMA entidade por vez, em sequência. Resposta direta
 *   { success, warning, error, reason, retryAfterSeconds }.
 * - INTERRUPT_REASONS param a execução (as próximas falhariam pelo mesmo motivo) e marcam as
 *   restantes como "Não executado". RATE_LIMIT_NO_FALLBACK espera retryAfterSeconds e repete a
 *   mesma entidade. Falha HTTP marca a linha como Erro e segue.
 * - A seleção vale só para a página carregada; trocar de página ou filtrar limpa a seleção e os
 *   resultados. Ao fim da atualização em massa a página atual é recarregada mantendo os
 *   resultados (keepResults), para as colunas mostrarem os valores gravados pelas APIs.
 * - Tabela de entidades: todos os campos gravados pelo mapper (ENTITY_FIELD_KEYS, na mesma ordem
 *   do <thead>), com seleção e Nome fixos à esquerda na rolagem horizontal; sem coluna Resultado:
 *   o badge de resultado fica em .result-cell, abaixo do link do Nome. Durante a execução, abas,
 *   filtros, paginação, seleção e País ficam travados e o navegador pede confirmação para sair.
 * - País editável: as opções vêm de settings.countries (sem opções, a coluna é só texto). Ao trocar,
 *   POST setCountry no RESTlet do painel grava só esse campo; falha volta ao valor anterior
 *   (data-previous). Linha sem País fica com is-invalid, e "Atualizar" não consulta enquanto
 *   houver selecionada sem País (a consulta recusaria com "preencha o campo País primeiro") —
 *   só quando a busca conseguiu ler o País (countryAvailable).
 * - Aba "Retorno das APIs": conteúdo estático no HTML, sem chamada ao RESTlet; aqui só é travada
 *   durante a atualização em massa, junto com a de Consumo de Créditos.
 * - Mensagens do servidor podem trazer <br/> (avisos juntados em pd-petr-entity-lookup): o texto é
 *   escapado e só o <br> é restaurado (messageHtml).
 */
(function ($) {
    'use strict';

    const PARAMS = typeof SUITELET_PARAMETERS !== 'undefined' ? SUITELET_PARAMETERS : {};
    const PANEL_URL = PARAMS.panelUrl;
    const UPDATE_URL = PARAMS.updateUrl;

    const INTERRUPT_REASONS = [
        'EXPIRED',
        'NO_BALANCE',
        'BALANCE_CHECK_ERROR',
        'ALL_PROVIDERS_BLOCKED',
        'NO_PROVIDER_IN_CHAIN',
        'MISSING_SETTINGS'
    ];
    const RATE_LIMIT_REASON = 'RATE_LIMIT_NO_FALLBACK';
    const DEFAULT_RETRY_SECONDS = 60;
    const SUPPORT_CONTACT_MESSAGE = 'Se o problema persistir, acione a equipe Dome informando o CPF/CNPJ consultado e o horário da tentativa.';

    const ENTITY_FIELD_KEYS = [
        'document', 'corporateName', 'tradeName', 'firstName', 'birthDate', 'stateRegistration', 'taxRegime',
        'phone', 'email', 'zip', 'street', 'number', 'complement', 'district', 'city', 'state'
    ];
    const ENTITY_COLUMN_COUNT = 20;

    const RESULT_STATUS = {
        UPDATED: { label: 'Atualizado', css: 'bg-success' },
        WARNING: { label: 'Atualizado com aviso', css: 'bg-warning' },
        ERROR: { label: 'Erro', css: 'bg-danger' },
        RUNNING: { label: 'Atualizando...', css: 'bg-info' },
        WAITING: { label: 'Aguardando...', css: 'bg-info' },
        NOT_RUN: { label: 'Não executado', css: 'bg-secondary' }
    };

    let settings = null;

    let usageRows = [];
    let usagePage = 1;
    let usagePageCount = 0;

    let entityRows = [];
    let entityPage = 1;
    let entityPageCount = 0;
    let entityFilterApplied = null;
    let entityCountryAvailable = false;
    let selectedIds = {};
    let results = {};
    let isRunning = false;

    $(function () {
        initHeader();
        setDefaultUsageFilters();
        bindEvents();
        loadSettings();
        loadUsage(1);
    });

    function initHeader() {
        $('#user-name').text(PARAMS.currentUserName || '—');
        $('#user-role').text(PARAMS.currentUserRole || '');
        $('#user-avatar').text(initials(PARAMS.currentUserName || ''));
        if (PARAMS.homeUrl) $('#home-link').attr('href', PARAMS.homeUrl);
    }

    function bindEvents() {
        $('#usage-filter-form').on('submit', function (event) { event.preventDefault(); loadUsage(1); });
        $('#usage-clear-filter').on('click', function () { setDefaultUsageFilters(); loadUsage(1); });
        $('#usage-prev-page').on('click', function () { loadUsage(usagePage - 1); });
        $('#usage-next-page').on('click', function () { loadUsage(usagePage + 1); });
        $('#usage-export-csv').on('click', exportUsageCsv);

        $('#entity-filter-form').on('submit', function (event) { event.preventDefault(); applyEntityFilter(); });
        $('#entity-clear-filter').on('click', clearEntityFilter);
        $('#entity-prev-page').on('click', function () { loadEntities(entityPage - 1); });
        $('#entity-next-page').on('click', function () { loadEntities(entityPage + 1); });
        $('#entity-select-all').on('change', toggleSelectAll);
        $('#entity-body').on('change', '.row-check', onRowCheck);
        $('#entity-body').on('change', '.country-select', onCountryChange);
        $('#entity-body').on('click', '.result-badge[data-has-message="true"]', showResultMessage);
        $('#clear-selection').on('click', clearSelection);
        $('#run-update').on('click', confirmUpdate);

        $(window).on('beforeunload', function (event) {
            if (!isRunning) return undefined;
            event.preventDefault();
            event.returnValue = '';
            return '';
        });
    }

    function restlet(options) {
        let requestUrl = options.url;
        if (options.params) requestUrl += '&' + $.param(options.params);

        return $.ajax({
            url: requestUrl,
            method: options.method || 'GET',
            contentType: 'application/json',
            dataType: 'json',
            data: options.body ? JSON.stringify(options.body) : undefined
        });
    }

    function callPanel(params) {
        return new Promise(function (resolve, reject) {
            restlet({ url: PANEL_URL, params: params })
                .done(function (response) {
                    if (response && response.success) resolve(response.data);
                    else reject(new Error((response && response.error) || 'Erro inesperado.'));
                })
                .fail(function (jqXHR) { reject(new Error(errMsg(jqXHR))); });
        });
    }

    function callPanelPost(body) {
        return new Promise(function (resolve, reject) {
            restlet({ url: PANEL_URL, method: 'POST', body: body })
                .done(function (response) {
                    if (response && response.success) resolve(response.data);
                    else reject(new Error((response && response.error) || 'Erro inesperado.'));
                })
                .fail(function (jqXHR) { reject(new Error(errMsg(jqXHR))); });
        });
    }

    function callUpdate(row, mode) {
        return new Promise(function (resolve) {
            restlet({ url: UPDATE_URL, method: 'POST', body: { recordType: row.recordType, id: row.id, mode: mode } })
                .done(function (response) { resolve(response || { success: false, error: 'Resposta vazia do servidor.' }); })
                .fail(function (jqXHR) { resolve({ success: false, httpError: true, error: errMsg(jqXHR) }); });
        });
    }

    function loadSettings() {
        return callPanel({ action: 'settings' })
            .then(function (data) {
                settings = data;
                renderBalances();
                renderModes();
                if (entityRows.length && !isRunning) renderEntities();
            })
            .catch(function (error) {
                settings = null;
                renderBalances();
                renderModes();
                showAlert('Falha ao carregar a configuração do painel: ' + messageHtml(error.message));
            });
    }

    function renderBalances() {
        const balances = settings ? settings.balances : null;
        const hubText = formatBalance(balances && balances.hub, 'HUB');
        const directdText = formatBalance(balances && balances.directd, 'DIRECTD');

        $('#kpi-hub-balance').text(hubText);
        $('#kpi-dd-balance').text(directdText);
        $('#kpi-entity-hub-balance').text('Hub: ' + hubText);
        $('#kpi-entity-dd-balance').text('DirectD: ' + directdText);
    }

    function formatBalance(balance, provider) {
        if (!balance) return '—';
        if (balance.status === 'DISABLED') return 'Desligada';
        if (balance.status === 'UNLIMITED') return 'Sem limite';
        if (balance.status === 'ERROR') return 'Erro ao calcular';
        if (balance.available === null || balance.available === undefined) return 'Sem limite';

        return provider === 'HUB' ? formatInteger(balance.available) + ' créditos' : formatBRL(balance.available);
    }

    function renderModes() {
        const $select = $('#update-mode').empty();
        const modes = settings && settings.modes && settings.modes.length
            ? settings.modes
            : [{ id: 'DEFAULT', label: 'Hierarquia padrão (ReceitaWS → Hub → DirectD)' }];

        modes.forEach(function (mode) {
            $select.append($('<option>').val(mode.id).text(mode.label));
        });
    }

    function setDefaultUsageFilters() {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

        $('#usage-start').val(toIsoDate(firstDay));
        $('#usage-end').val(toIsoDate(today));
        $('#usage-provider').val('');
        $('#usage-document').val('');
    }

    function loadUsage(page) {
        if (isRunning) return;

        showLoading(true);

        callPanel({
            action: 'creditUsage',
            startDate: $('#usage-start').val() || '',
            endDate: $('#usage-end').val() || '',
            provider: $('#usage-provider').val() || '',
            document: $('#usage-document').val() || '',
            page: Math.max(page || 1, 1)
        })
            .then(function (data) {
                usageRows = data.rows || [];
                usagePage = data.page || 1;
                usagePageCount = data.pageCount || 0;
                $('#kpi-hub-credits').text(formatInteger((data.totals && data.totals.hubCredits) || 0));
                $('#kpi-dd-cost').text(formatBRL((data.totals && data.totals.directdCost) || 0));
                renderUsage();
                renderPagination('usage', data);
            })
            .catch(function (error) {
                usageRows = [];
                renderUsage();
                renderPagination('usage', { count: 0 });
                showAlert('Falha ao carregar o consumo de créditos: ' + messageHtml(error.message));
            })
            .then(function () { showLoading(false); });
    }

    function renderUsage() {
        const $body = $('#usage-body').empty();

        if (!usageRows.length) {
            $body.append('<tr><td colspan="8" class="text-center text-muted py-4">Nenhum consumo encontrado no período.</td></tr>');
            return;
        }

        usageRows.forEach(function (row) {
            $body.append(
                '<tr>' +
                '<td class="text-muted text-nowrap">' + esc(row.created) + '</td>' +
                '<td><span class="badge bg-secondary">' + esc(row.provider) + '</span></td>' +
                '<td>' + esc(row.queryType) + '</td>' +
                '<td class="text-nowrap">' + esc(row.document) + '</td>' +
                '<td class="text-end">' + (isBlank(row.credits) ? '—' : formatInteger(row.credits)) + '</td>' +
                '<td class="text-end">' + (isBlank(row.cost) ? '—' : formatBRL(parseAmount(row.cost))) + '</td>' +
                '<td class="text-end">' + esc(formatBalanceAfter(row)) + '</td>' +
                '<td>' + esc(row.user) + '</td>' +
                '</tr>'
            );
        });
    }

    function isHubRow(row) {
        return String(row.provider || '').toLowerCase().indexOf('hub') !== -1;
    }

    function formatBalanceAfter(row) {
        if (isHubRow(row)) return isBlank(row.hubBalance) ? '—' : formatInteger(row.hubBalance);
        return isBlank(row.directdBalance) ? '—' : formatBRL(parseAmount(row.directdBalance));
    }

    function exportUsageCsv() {
        if (!usageRows.length) { showAlert('Não há dados para exportar.'); return; }

        const csvLines = [['Data/Hora', 'Provedor', 'Tipo de Consulta', 'CPF/CNPJ', 'Créditos', 'Custo (R$)', 'Saldo Após', 'Usuário'].join(';')];

        usageRows.forEach(function (row) {
            const balanceAfter = isHubRow(row) ? row.hubBalance : row.directdBalance;
            csvLines.push([
                csv(row.created),
                csv(row.provider),
                csv(row.queryType),
                csv(row.document),
                csv(row.credits),
                csv(String(row.cost == null ? '' : row.cost).replace('.', ',')),
                csv(String(balanceAfter == null ? '' : balanceAfter).replace('.', ',')),
                csv(row.user)
            ].join(';'));
        });

        downloadCsv(csvLines, 'consumo-creditos-' + ($('#usage-start').val() || '') + '-' + ($('#usage-end').val() || '') + '.csv');
    }

    function applyEntityFilter() {
        entityFilterApplied = {
            entityType: $('#entity-type').val(),
            name: $.trim($('#entity-name').val() || '')
        };

        if (!entityFilterApplied.entityType) { showAlert('Escolha o tipo: Cliente ou Fornecedor.'); return; }

        loadEntities(1);
    }

    function clearEntityFilter() {
        $('#entity-filter-form')[0].reset();
        entityFilterApplied = null;
        entityRows = [];
        selectedIds = {};
        results = {};
        renderPagination('entity', { count: 0 });
        $('#kpi-entities-total').text(0);
        $('#entity-body').html('<tr><td colspan="' + ENTITY_COLUMN_COUNT + '" class="text-center text-muted py-4">Use os filtros acima para carregar as entidades.</td></tr>');
        updateSelection();
    }

    function loadEntities(page, keepResults) {
        if (isRunning || !entityFilterApplied) return;

        showLoading(true);

        callPanel({
            action: 'entities',
            entityType: entityFilterApplied.entityType,
            name: entityFilterApplied.name,
            page: Math.max(page || 1, 1)
        })
            .then(function (data) {
                entityRows = data.rows || [];
                entityPage = data.page || 1;
                entityPageCount = data.pageCount || 0;
                entityCountryAvailable = !!data.countryAvailable;
                selectedIds = {};
                if (!keepResults) results = {};
                $('#entity-select-all').prop('checked', false);
                $('#kpi-entities-total').text(data.count || 0);
                renderEntities();
                renderPagination('entity', data);
            })
            .catch(function (error) {
                entityRows = [];
                selectedIds = {};
                if (!keepResults) results = {};
                $('#kpi-entities-total').text(0);
                renderEntities();
                renderPagination('entity', { count: 0 });
                showAlert('Falha ao carregar as entidades: ' + messageHtml(error.message));
            })
            .then(function () { showLoading(false); });
    }

    function renderEntities() {
        const $body = $('#entity-body').empty();

        if (!entityRows.length) {
            $body.append('<tr><td colspan="' + ENTITY_COLUMN_COUNT + '" class="text-center text-muted py-4">Nenhuma entidade com CPF/CNPJ encontrada.</td></tr>');
            updateSelection();
            return;
        }

        entityRows.forEach(function (row) {
            const checkedAttr = selectedIds[row.id] ? ' checked' : '';
            const disabledAttr = isRunning ? ' disabled' : '';
            const displayName = row.tradeName || row.corporateName || row.entityId;
            const nameCell = row.url
                ? '<a href="' + esc(row.url) + '" target="_blank" rel="noopener" title="' + esc(displayName) + '">' + esc(displayName) + '</a>'
                : esc(displayName);
            const fieldCells = ENTITY_FIELD_KEYS.map(function (key) { return '<td>' + cellText(row[key]) + '</td>'; }).join('');

            $body.append(
                '<tr>' +
                '<td class="text-center petr-sticky petr-sticky-check"><input type="checkbox" class="form-check-input row-check" data-id="' + esc(row.id) + '"' + checkedAttr + disabledAttr + '></td>' +
                '<td class="petr-sticky petr-sticky-name">' + nameCell + '<div class="result-cell">' + resultBadge(row.id) + '</div></td>' +
                '<td>' + countryCell(row) + '</td>' +
                fieldCells +
                '<td class="text-muted">' + cellText(row.lastModified) + '</td>' +
                '</tr>'
            );
        });

        updateSelection();
    }

    function getCountries() {
        return settings && settings.countries ? settings.countries : [];
    }

    function countryCell(row) {
        const countries = getCountries();
        if (!countries.length || !entityCountryAvailable) return cellText(row.countryText);

        const missingClass = isBlank(row.country) ? ' is-invalid' : '';
        const disabledAttr = isRunning ? ' disabled' : '';
        let options = '<option value="">Selecione...</option>';

        countries.forEach(function (country) {
            options += '<option value="' + esc(country.id) + '"' + (String(row.country) === country.id ? ' selected' : '') + '>' + esc(country.text) + '</option>';
        });

        return '<select class="form-select form-select-sm country-select' + missingClass + '" data-id="' + esc(row.id) + '"'
            + ' data-previous="' + esc(row.country) + '"' + disabledAttr + '>' + options + '</select>';
    }

    function onCountryChange() {
        const $select = $(this);
        const rowId = String($select.data('id'));
        const row = entityRows.find(function (entityRow) { return String(entityRow.id) === rowId; });
        const previous = String($select.attr('data-previous') || '');
        const country = $select.val();

        if (!row) return;
        if (!country) {
            $select.val(previous);
            showAlert('O País é obrigatório e não pode ficar vazio.');
            return;
        }

        $select.prop('disabled', true).removeClass('is-invalid is-valid');

        callPanelPost({ action: 'setCountry', recordType: row.recordType, id: row.id, country: country })
            .then(function () {
                row.country = country;
                row.countryText = $select.find('option:selected').text();
                $select.attr('data-previous', country).addClass('is-valid');
                setTimeout(function () { $select.removeClass('is-valid'); }, 1500);
            })
            .catch(function (error) {
                $select.val(previous).toggleClass('is-invalid', !previous);
                showAlert('Não foi possível gravar o País: ' + messageHtml(error.message));
            })
            .then(function () { $select.prop('disabled', isRunning); });
    }

    function cellText(value) {
        return isBlank(value) ? '<span class="text-muted">—</span>' : esc(value);
    }

    function resultBadge(id) {
        const result = results[id];
        if (!result) return '';

        const status = RESULT_STATUS[result.status];
        const hasMessage = !isBlank(result.message);

        return '<span class="badge result-badge ' + status.css + '" data-id="' + esc(id) + '" data-has-message="' + hasMessage + '"'
            + (hasMessage ? ' title="Clique para ver a mensagem"' : '') + '>' + esc(status.label) + '</span>';
    }

    function showResultMessage() {
        const result = results[$(this).data('id')];
        if (!result || isBlank(result.message)) return;

        showAlert(messageHtml(result.message), RESULT_STATUS[result.status].label);
    }

    function onRowCheck() {
        const rowId = $(this).data('id');
        if (this.checked) selectedIds[rowId] = true; else delete selectedIds[rowId];
        syncSelectAll();
        updateSelection();
    }

    function toggleSelectAll() {
        const isChecked = this.checked;
        $('#entity-body .row-check').each(function () {
            this.checked = isChecked;
            const rowId = $(this).data('id');
            if (isChecked) selectedIds[rowId] = true; else delete selectedIds[rowId];
        });
        updateSelection();
    }

    function syncSelectAll() {
        const total = $('#entity-body .row-check').length;
        const checked = $('#entity-body .row-check:checked').length;
        $('#entity-select-all').prop('checked', total > 0 && checked === total);
    }

    function getSelectedRows() {
        return entityRows.filter(function (row) { return selectedIds[row.id]; });
    }

    function updateSelection() {
        const selectedCount = getSelectedRows().length;

        $('#kpi-entities-selected').text(selectedCount);
        $('#ab-count').text(selectedCount);
        $('#action-bar').toggleClass('show', selectedCount > 0 || isRunning);
    }

    function clearSelection() {
        selectedIds = {};
        $('#entity-select-all').prop('checked', false);
        renderEntities();
    }

    function confirmUpdate() {
        const rows = getSelectedRows();
        if (!rows.length) { showAlert('Selecione ao menos uma entidade.'); return; }

        const withoutCountry = entityCountryAvailable ? rows.filter(function (row) { return isBlank(row.country); }) : [];
        if (withoutCountry.length) {
            showAlert(withoutCountry.length + ' entidade(s) selecionada(s) sem <b>País</b>. Selecione o País na tabela (campos em vermelho) antes de atualizar.');
            return;
        }

        const mode = $('#update-mode').val() || 'DEFAULT';
        const modeLabel = $('#update-mode option:selected').text();
        const parts = [
            'Atualizar <b>' + rows.length + '</b> entidade(s) com <b>' + esc(modeLabel) + '</b>?',
            'Os campos atualizados seguem as opções de "Atualização de Campos" da Configuração das Validações.'
        ];

        if (mode !== 'DEFAULT') {
            const price = settings && settings.prices ? Number(settings.prices[mode]) || 0 : 0;
            parts.push('Custo estimado: <b>' + formatBRL(price * rows.length) + '</b> (' + rows.length + ' × ' + formatBRL(price) + ').');

            const cpfCount = rows.filter(function (row) { return documentLength(row.document) === 11; }).length;
            if (cpfCount) parts.push(cpfCount + ' entidade(s) com CPF serão recusadas: a DirectD só consulta CNPJ.');
        } else if (settings && settings.receitaWs && settings.receitaWs.inChain && settings.receitaWs.rateLimit > 0) {
            parts.push('A ReceitaWS (gratuita) atende até <b>' + settings.receitaWs.rateLimit + '</b> consultas por minuto; '
                + 'acima disso as consultas seguem para a Hub do Desenvolvedor/DirectD e consomem créditos.');
        }

        showConfirm(parts.join('<br><br>'), 'Atualizar entidades').then(function (wasConfirmed) {
            if (wasConfirmed) executeUpdate(rows, mode);
        });
    }

    async function executeUpdate(rows, mode) {
        const summary = { UPDATED: 0, WARNING: 0, ERROR: 0, NOT_RUN: 0 };
        let interruption = null;

        results = {};
        setRunning(true);

        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];

            if (interruption) {
                setResult(row.id, 'NOT_RUN', '');
                summary.NOT_RUN++;
                continue;
            }

            setProgress('Atualizando ' + (index + 1) + ' de ' + rows.length + '...');
            setResult(row.id, 'RUNNING', '');

            let response = await callUpdate(row, mode);

            while (!response.success && response.reason === RATE_LIMIT_REASON) {
                setResult(row.id, 'WAITING', '');
                await countdown(Number(response.retryAfterSeconds) || DEFAULT_RETRY_SECONDS, index + 1, rows.length);
                setResult(row.id, 'RUNNING', '');
                response = await callUpdate(row, mode);
            }

            if (response.success && !response.warning) {
                setResult(row.id, 'UPDATED', '');
                summary.UPDATED++;
            } else if (response.success) {
                setResult(row.id, 'WARNING', formatWarning(response.warning));
                summary.WARNING++;
            } else {
                setResult(row.id, 'ERROR', response.error || 'Erro inesperado.');
                summary.ERROR++;

                if (INTERRUPT_REASONS.indexOf(response.reason) !== -1) {
                    interruption = response.error || 'Consulta bloqueada.';
                }
            }
        }

        setProgress('');
        setRunning(false);
        loadSettings();
        loadEntities(entityPage, true);
        showSummary(summary, interruption);
    }

    function countdown(seconds, position, total) {
        return new Promise(function (resolve) {
            let remaining = Math.max(Math.ceil(seconds), 1);

            setProgress('Entidade ' + position + ' de ' + total + ': aguardando a cota da ReceitaWS (' + remaining + 's)...');

            const timer = setInterval(function () {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(timer);
                    resolve();
                    return;
                }
                setProgress('Entidade ' + position + ' de ' + total + ': aguardando a cota da ReceitaWS (' + remaining + 's)...');
            }, 1000);
        });
    }

    function formatWarning(warning) {
        if (!warning) return '';
        if (typeof warning === 'string') return warning;
        return (warning.title ? warning.title + ': ' : '') + (warning.message || '');
    }

    function setResult(id, status, message) {
        results[id] = { status: status, message: message };
        $('#entity-body .row-check[data-id="' + id + '"]').closest('tr').find('.result-cell').html(resultBadge(id));
    }

    function setProgress(text) {
        $('#ab-progress').text(text);
    }

    function setRunning(running) {
        isRunning = running;

        $('#entity-filter-form').find('input, select, button').prop('disabled', running);
        $('#entity-prev-page').prop('disabled', running || entityPage <= 1);
        $('#entity-next-page').prop('disabled', running || entityPage >= entityPageCount);
        $('#entity-select-all, #entity-body .row-check, #entity-body .country-select, #update-mode, #clear-selection, #run-update').prop('disabled', running);
        $('#tab-usage, #tab-providers').toggleClass('disabled', running).prop('disabled', running);

        updateSelection();
    }

    function showSummary(summary, interruption) {
        const lines = [
            '<b>' + summary.UPDATED + '</b> atualizada(s)',
            '<b>' + summary.WARNING + '</b> com aviso',
            '<b>' + summary.ERROR + '</b> com erro',
            '<b>' + summary.NOT_RUN + '</b> não executada(s)'
        ];
        let html = lines.join('<br>');

        if (interruption) {
            html += '<br><br><b>Atualização interrompida:</b> ' + messageHtml(interruption) + '<br><br>' + esc(SUPPORT_CONTACT_MESSAGE);
        } else if (summary.WARNING || summary.ERROR) {
            html += '<br><br>Clique no resultado de cada linha para ver a mensagem.';
        }

        showAlert(html, interruption ? 'Atualização interrompida' : 'Atualização concluída');
    }

    function renderPagination(prefix, data) {
        const count = data.count || 0;
        const page = data.page || 1;
        const pageCount = data.pageCount || 0;

        $('#' + prefix + '-page-info').text(count ? ('Página ' + page + ' de ' + pageCount + ' — ' + count + ' registro(s)') : '');
        $('#' + prefix + '-prev-page').prop('disabled', isRunning || page <= 1 || !count);
        $('#' + prefix + '-next-page').prop('disabled', isRunning || page >= pageCount || !count);
    }

    function downloadCsv(lines, fileName) {
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function showLoading(isLoading) {
        $('#overlay').toggleClass('d-none', !isLoading).toggleClass('d-flex', isLoading);
    }

    function showAlert(html, title) {
        return showModal({ html: html, title: title || 'Aviso', showCancel: false });
    }

    function showConfirm(html, title) {
        return showModal({ html: html, title: title || 'Confirmação', showCancel: true });
    }

    function showModal(options) {
        return new Promise(function (resolve) {
            const modalElement = $('#app-modal').get(0);
            const modalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);

            $('#app-modal-title').text(options.title);
            $('#app-modal-body').html(options.html);
            $('#app-modal-cancel').toggleClass('d-none', !options.showCancel);
            $('#app-modal-confirm').text(options.showCancel ? 'Confirmar' : 'OK');

            let wasConfirmed = false;

            $('#app-modal-confirm').off('click').on('click', function () { wasConfirmed = true; });
            $('#app-modal').off('hidden.bs.modal').on('hidden.bs.modal', function () { resolve(wasConfirmed); });

            modalInstance.show();
        });
    }

    function errMsg(jqXHR) {
        const body = jqXHR && jqXHR.responseJSON;
        if (body && body.error && body.error.message) return body.error.message;
        if (body && body.message) return body.message;
        if (jqXHR && jqXHR.status === 0) return 'Sem conexão com o NetSuite.';
        if (jqXHR && jqXHR.status) return 'Erro HTTP ' + jqXHR.status + (jqXHR.statusText ? ' (' + jqXHR.statusText + ')' : '') + '.';
        return 'Erro inesperado.';
    }

    function messageHtml(text) {
        return esc(text).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    }

    function initials(name) {
        const nameParts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!nameParts.length) return '--';
        if (nameParts.length === 1) return nameParts[0].substring(0, 2).toUpperCase();
        return (nameParts[0].charAt(0) + nameParts[1].charAt(0)).toUpperCase();
    }

    function documentLength(value) {
        return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '').length;
    }

    function toIsoDate(date) {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return date.getFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
    }

    function isBlank(value) {
        return value === null || value === undefined || value === '';
    }

    function parseAmount(value) {
        if (isBlank(value)) return 0;
        if (typeof value === 'number') return value;
        const raw = String(value);
        if (raw.indexOf(',') !== -1) return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
        return parseFloat(raw) || 0;
    }

    function formatBRL(value) {
        return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatInteger(value) {
        return Math.round(parseAmount(value)).toLocaleString('pt-BR');
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function csv(value) {
        return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
    }
})(jQuery);

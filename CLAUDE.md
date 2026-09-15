# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Instruções de Interação

- Responder sempre em português (PT-BR), independente do idioma da mensagem do usuário.
- Antes de executar qualquer comando (shell, deploy, etc.), explicar o que o comando faz.
- Identificadores de código (variáveis, funções, propriedades) sempre em inglês, mesmo em módulos de domínio brasileiro (boleto, FEBRABAN, linha digitável etc.). Comentários e mensagens de log/erro continuam em português, inclusive jargão BR sem tradução natural. Aplicar arquivo por arquivo, sob demanda — não é necessário reescrever o repositório inteiro por causa disso.

## Project Overview

This is a NetSuite **SDF (SuiteCloud Development Framework) Account Customization** project for the client **RGM** (SDF account: `RGM-Adm-Prod`), maintained by ProjectDome. It contains multiple independent SuiteScript feature modules plus the account's custom object definitions (forms, fields, center categories, etc.) under `src/Objects`.

The flagship module is the **LMX Integration** (`src/FileCabinet/SuiteScripts/ProjectDome/LMXIntegration/`), a bidirectional integration between NetSuite and the LMX Logística WMS. See `README.md` for the full functional spec (in Portuguese) and `project-manifest.md` for the exhaustive script/record/field spec used as the source of truth for object IDs, deployment IDs, and field mappings.

## Commands

```bash
npm test                                    # run all Jest unit tests
npx jest path/to/file.test.js               # run a single test file
npx jest -t "test name"                     # run tests matching a name
suitecloud project:deploy --accountid RGM-Adm-Prod   # deploy to the SDF account (runs Jest as a pre-deploy hook)
suitecloud project:validate                 # validate the SDF project without deploying
```

Jest is wired through `@oracle/suitecloud-unit-testing`'s `SuiteCloudJestConfiguration` (see `jest.config.js`), which stubs NetSuite's `N/*` modules so tests can `jest.mock('N/record')` etc. without a live account. `suitecloud.config.js` also hooks the full Jest suite to run automatically before `project:deploy` — a failing test blocks deployment.

## Scaffolding new scripts and Objects

Use the project skills instead of hand-writing boilerplate:
- `.claude/skills/suitescript-scaffold/SKILL.md` — creates SuiteScript entry points (Suitelet, RESTlet, Client Script, User Event, Scheduled Script, Map/Reduce) and Service/lib modules, plus the matching `customscript_*.xml` deployment Object.
- `.claude/skills/netsuite-object-scaffold/SKILL.md` — creates custom field/record/role Objects under `src/Objects/` (does not cover `customscript_*.xml`, which is the other skill's job).

Both skills are written generically (parameterized by project prefix) so they can be reused across ProjectDome repos.

## Architecture

### Three coexisting folder conventions — use the newest for new work

This repo accumulated three different script-organization conventions over time, with no prescriptive documentation until now. **For any new script, follow the `suitescript-scaffold` skill's convention** (hyphenated filenames + spelled-out type suffix, e.g. `pd-aig-boleto-pdf.suitelet.js`, entry points in `{prefix}_suitelet/`, `{prefix}_restlet/` etc., business logic in `{prefix}_service/`, framework-free libs in `libs/lib.{Name}.js`). Do not copy the other two conventions into new code:

- `src/FileCabinet/SuiteScripts/ProjectDome/LMXIntegration/` — legacy convention, already deployed in NetSuite (`entry_points/` + `use_cases/` + `client/`, PascalCase module folder). Described in detail below since it's the largest existing module.
- `src/FileCabinet/SuiteScripts/project_dome/pd_iau_*/`, `pd_ipi_*/` — an earlier snake_case convention (`modules/`, abbreviated suffixes `_cl`/`_rl`/`_sl`/`_ue`). Kept only in those two existing modules; not extended further.
- `src/FileCabinet/SuiteScripts/project_dome/ds-aig-advance-invoice-generation/`, `ds-advance-invoice-generation/` — the newer convention in active use, matching the scaffold skill.

`src/Objects/` is a flat directory of exported SDF custom object XML (fields, forms, center categories/tabs, custom records) — account-wide configuration, not tied to a single feature module. `src/deploy.xml` / `src/manifest.xml` is the SDF deployment manifest (covers `AccountConfiguration`, `FileCabinet`, `Objects`, `Translations`). `.attributes/.folder.attr.xml` files scattered through the tree are SDF File Cabinet folder metadata (auto-generated, not hand-edited).

### Per-module internal structure (LMX Integration and similar entry_points/use_cases layouts)

- `entry_points/` — the actual deployed script files (`*.userevent.js`, `*.suitelet.js`, `*.restlet.js`, `*.mapreduce.js`, `*.client.js`). These are thin: they wire NetSuite triggers/HTTP to use-case modules and handle only entry-point-specific concerns (form/button injection, request/response shaping).
- `use_cases/` (or `modules/` in some older feature folders, `{prefix}_service/` in the newest convention) — reusable business logic, one file per responsibility (e.g. `orderPayload.js` builds a payload, `registerOrderLMX.js` performs the HTTP call, `saveLMXOrderReturn.js` persists the result). Entry points call into these; use-case modules never reference `N/ui/*`.
- `client/` — browser-side Client Scripts, injected by a UserEvent's `beforeLoad`, calling back into Suitelets for anything requiring `N/https` or credentials.
- `Docs/` — architecture diagrams (SVG) and a generated code/requirements summary for that module.

### Cross-cutting architectural pattern (LMX Integration, and the model to follow for similar integrations)

Client Scripts cannot make complex external HTTP calls in NetSuite, so **Suitelets act as a server-side proxy**: they hold OAuth credentials and make all outbound HTTP calls to the external system, while Client Scripts only orchestrate a chain of internal Suitelet calls. Business logic is factored into use-case modules shared between Suitelets and the Map/Reduce script, rather than duplicated per entry point.

Environment configuration (external endpoint URLs, OAuth credentials) lives in a **single custom record** (`customrecord_pd_lmx_integrat_credentials` for LMX) rather than script parameters — switching sandbox/production is a data change, not a code change.

Two independent sync channels keep external state consistent without a single point of failure: a scheduled **Map/Reduce** that polls status via SuiteQL, and a **RESTlet webhook** that receives real-time push notifications. Note the Map/Reduce reuses one OAuth token across all `map` invocations via a module-level `let accessToken` variable (set once, read on subsequent iterations) to avoid one OAuth call per record.

Watch for two data-shape traps when touching the LMX module specifically: the polling path and the webhook path return history entries with different key casing (`dataHistorico`/`descSituacao`/`nomeUsuario` vs `data_historico`/`desc_situacao`/`nome_usuario`), and there are two separate date parsers for two different upstream date formats (`saveLMXOrderReturn.parseShippingDate` for `DD-MM-YYYY HH:MM:SS`, `parseDate.parseDateLMX` for ISO). Don't assume one parser/shape covers both channels.

### Conventions observed in existing scripts

- Standard AMD `define([...], function(...) {...})` module wrapper with `@NApiVersion 2.1` and `@NModuleScope SameAccount` header; use-case modules return a plain object of named functions.
- Use-case functions that call external systems catch all errors internally and return a `{ success, statusCode, body, error }`-shaped result rather than throwing — callers (Suitelets/Map-Reduce) branch on `result.success`.
- Suitelets themselves return `{ success: false, error: "..." }` on failure; final handling (user alert, log-and-skip, etc.) is the caller's responsibility, not the Suitelet's.
- HTTP 401 / token-related errors are treated as a distinct, non-retried error class (checked via string matching on the error message) to avoid retry storms in the Map/Reduce.
- The `pd_c_netsuite_tools` library referenced by some older scripts is not physically present in this repo — it's deployed separately to the NetSuite account's File Cabinet. Don't assume that import is available by default in new code.

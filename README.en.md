# JS Reverse MCP

[中文 README](README.md)

An MCP server that standardizes frontend JavaScript reverse-engineering workflows.
The goal is not just page debugging. It is to connect page observation, runtime sampling, local reproduction, environment patching, and evidence capture into one reusable workflow.

## Core Methodology

This project follows these defaults:

- `Observe-first`
- `Hook-preferred`
- `Breakpoint-last`
- `Rebuild-oriented`
- `Evidence-first`
- `Pure-extraction-after-pass`

In practice, that means:

1. Confirm requests, scripts, functions, and dependencies in the browser first.
2. Use the smallest possible hook-based sampling.
3. Export a local rebuild bundle.
4. Patch the Node environment step by step.
5. Persist every step into task artifacts instead of leaving it only in chat history.

## Indexed Cases

The following parameter chains already have public in-repo entry points:

- JD `h5st`
  - Index: [scripts/cases/README.md](scripts/cases/README.md)
  - Case: [scripts/cases/jd-h5st-pure-node.mjs](scripts/cases/jd-h5st-pure-node.mjs)

- Kuaishou `falcon`
  - Index: [scripts/cases/README.md](scripts/cases/README.md)
  - Case: [scripts/cases/ks-hxfalcon-pure-node.mjs](scripts/cases/ks-hxfalcon-pure-node.mjs)

- Douyin `a-bogus`
  - Index: [scripts/cases/README.md](scripts/cases/README.md)
  - Case: [scripts/cases/douyin-a-bogus-pure-node.mjs](scripts/cases/douyin-a-bogus-pure-node.mjs)

Notes:

- The homepage only shows sanitized parameter categories and public entry points.
- Real `artifacts/tasks/<task-id>/` directories are treated as local/private task folders by default.
- Git only tracks `artifacts/tasks/_TEMPLATE/` by default.

## Capabilities

### Page Observation and Script Discovery

Use these tools to answer: what scripts are loaded, and where the target logic likely lives.

- `list_scripts`
- `get_script_source`
- `find_in_script`
- `search_in_scripts`

### Hooking and Runtime Sampling

Use lightweight observation before stepping into paused debugging.

- `create_hook`
- `inject_hook`
- `get_hook_data`
- `hook_function`
- `trace_function`

### Breakpoints and Debug Control

Use paused debugging only when hooks are not enough.

- `set_breakpoint`
- `set_breakpoint_on_text`
- `resume`
- `pause`
- `step_over` / `step_into` / `step_out`

### Request and Network Analysis

Locate the target request and identify what triggers it.

- `list_network_requests`
- `get_network_request`
- `get_request_initiator`
- `break_on_xhr`

### Page State and Runtime Checks

Inspect browser state, logs, and storage dependencies.

- `check_browser_health`
- `list_console_messages`
- `get_storage`
- `evaluate_script`
- `search_in_sources`

### WebSocket Inspection

Useful for long-lived connections, streaming flows, and binary frames.

- `list_websocket_connections`
- `analyze_websocket_messages`
- `get_websocket_messages`

### Local Rebuild and Environment Patching

Bring browser evidence back to a local Node workflow.

- `export_rebuild_bundle`
- `diff_env_requirements`
- `record_reverse_evidence`

### Page Automation

Use the minimum page actions needed to reproduce a flow.

- `navigate_page`
- `query_dom`
- `click_element`
- `type_text`
- `take_screenshot`

### Deep Analysis

Once code and runtime evidence are available:

- `collect_code`
- `understand_code`
- `deobfuscate_code`
- `risk_panel`

### Session and Login-State Reuse

- `save_session_state`
- `restore_session_state`
- `dump_session_state`
- `load_session_state`

For full parameter details, see [docs/reference/tool-reference.md](docs/reference/tool-reference.md).
For workflow-oriented tool selection, see [docs/reference/reverse-workflow.md](docs/reference/reverse-workflow.md).

## External AI Configuration

The project supports external LLMs as an analysis enhancement layer.
Currently supported providers:

- `openai`
- `anthropic`
- `gemini`

The real configuration surface is environment variables.
When launched from an MCP client, prefer passing them via the MCP server `env` block.
Use `.env` mainly when you run `node build/src/index.js` or `npm run start` directly from the project root.

Example:

```toml
[mcp_servers.js-reverse]
command = "node"
args = ["/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js"]

[mcp_servers.js-reverse.env]
DEFAULT_LLM_PROVIDER = "anthropic"
ANTHROPIC_API_KEY = "your_key"
ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"
```

If you start the project locally from the repository root, you can also use `.env`:

```bash
DEFAULT_LLM_PROVIDER=gemini

# OpenAI
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=

# Anthropic
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_BASE_URL=

# Gemini
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash-exp

# Optional Gemini CLI fallback
GEMINI_CLI_PATH=gemini-cli
```

Notes:

- `DEFAULT_LLM_PROVIDER` selects the default provider.
- `gemini` supports two modes: API mode when `GEMINI_API_KEY` is present, or CLI mode via `GEMINI_CLI_PATH`.
- `openai` and `anthropic` require their own API keys.

## Standard Task Layout

Task directories use:

- `artifacts/tasks/_TEMPLATE/`
- `artifacts/tasks/<task-id>/`

Recommended structure:

- `task.json`
- `runtime-evidence.jsonl`
- `network.jsonl`
- `scripts.jsonl`
- `env/env.js`
- `env/polyfills.js`
- `env/entry.js`
- `env/capture.json`
- `run/`
- `report.md`

Responsibility boundaries:

- `env.js`
  - Minimal host objects and shims
- `polyfills.js`
  - Proxy diagnostics, `watch`, `safeFunction`, `makeFunction`
- `entry.js`
  - Runtime entry, target script loading, and first-divergence output

## Standard Execution Flow

Recommended flow:

1. Page observation
2. Runtime sampling
3. Evidence capture
4. Local rebuild
5. Environment patching
6. First-divergence analysis
7. Pure extraction only after `env-pass`

Default rules:

- Do not guess the environment before collecting browser evidence.
- Do not simulate the whole browser at once.
- Do not commit real task directories directly.

## Parameter Retention and Safety Boundary

Recommended lookup order:

1. Local task artifacts first
   - `artifacts/tasks/<task-id>/`
2. Abstract case scripts second
   - `scripts/cases/*`
3. Create from templates if still missing
   - [docs/reference/parameter-methodology-template.md](docs/reference/parameter-methodology-template.md)
   - [docs/reference/parameter-site-mapping-template.md](docs/reference/parameter-site-mapping-template.md)

Safety boundary:

- Cases only keep abstract methodology and workflow.
- Real task directories stay local by default.
- Sensitive values must be sanitized before sharing.
- Git only tracks `_TEMPLATE` by default.

See:

- [docs/reference/case-safety-policy.md](docs/reference/case-safety-policy.md)
- [docs/reference/reverse-artifacts.md](docs/reference/reverse-artifacts.md)
- [docs/reference/env-patching.md](docs/reference/env-patching.md)

## 3-Minute Quick Start

### 1) Install and build

```bash
npm install
npm run build
```

Build entry:

```bash
build/src/index.js
```

### 2) Start with the simplest command

```bash
npm run start
```

### 3) Configure your MCP client

Minimal examples:

#### Claude Code

```bash
claude mcp add js-reverse node /ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js
```

#### Cursor

- Command: `node`
- Args: `[/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js]`

#### Codex

```toml
[mcp_servers.js-reverse]
command = "node"
args = ["/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js"]
```

If you need to attach to an already running browser, continue with:

- [docs/guides/browser-connection.md](docs/guides/browser-connection.md)
- [docs/guides/client-configuration.md](docs/guides/client-configuration.md)

## Documentation Entry Points

For reverse-engineering tasks, start with:

- [docs/reference/reverse-bootstrap.md](docs/reference/reverse-bootstrap.md)

That entry will further route you to:

- [docs/reference/case-safety-policy.md](docs/reference/case-safety-policy.md)
- [docs/reference/reverse-workflow.md](docs/reference/reverse-workflow.md)
- [docs/reference/pure-extraction.md](docs/reference/pure-extraction.md) when you are already in the post-`env-pass` stage

### Guides

- [docs/guides/getting-started.md](docs/guides/getting-started.md)
- [docs/guides/browser-connection.md](docs/guides/browser-connection.md)
- [docs/guides/client-configuration.md](docs/guides/client-configuration.md)
- [docs/reference/reverse-workflow.md](docs/reference/reverse-workflow.md)
- [docs/reference/env-patching.md](docs/reference/env-patching.md)

### Reference

- [docs/reference/reverse-bootstrap.md](docs/reference/reverse-bootstrap.md)
- [docs/reference/reverse-task-index.md](docs/reference/reverse-task-index.md)
- [docs/reference/tool-reference.md](docs/reference/tool-reference.md)
- [docs/reference/tool-io-contract.md](docs/reference/tool-io-contract.md)
- [docs/reference/reverse-artifacts.md](docs/reference/reverse-artifacts.md)

### Templates and Supporting Docs

- [docs/reference/reverse-update-prompt-template.md](docs/reference/reverse-update-prompt-template.md)
- [docs/reference/reverse-report-template.md](docs/reference/reverse-report-template.md)
- [docs/reference/algorithm-upgrade-template.md](docs/reference/algorithm-upgrade-template.md)
- [docs/reference/parameter-methodology-template.md](docs/reference/parameter-methodology-template.md)
- [docs/reference/parameter-site-mapping-template.md](docs/reference/parameter-site-mapping-template.md)

## Development and Test

```bash
npm run build
npm run test:unit
npm run test:property
npm run coverage:full
```

## Troubleshooting

See:

- [docs/guides/browser-connection.md](docs/guides/browser-connection.md)

## Upstream References

This project references the following upstream projects during design and implementation.
Actual licenses such as MIT should be checked in the corresponding upstream repositories.

- https://github.com/wuji66dde/jshook-skill
- https://github.com/zhizhuodemao/js-reverse-mcp

## License

Apache-2.0

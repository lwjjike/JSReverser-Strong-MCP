# JS Reverse Strong MCP

[English README](README.en.md)

一个把前端 JavaScript 逆向流程标准化的 MCP 服务。  
目标不是只做页面调试，而是把页面观察、运行时采样、本地复现、补环境和证据沉淀串成一套可复用工作流。

## 核心方法论

本项目默认遵循以下方法论：

- `Observe-first`
- `Hook-preferred`
- `Breakpoint-last`
- `Rebuild-oriented`
- `Evidence-first`
- `Pure-extraction-after-pass`

这意味着：

1. 先在浏览器里确认请求、脚本、函数和依赖来源
2. 再做最小化 Hook 采样
3. 再导出 local rebuild
4. 再在 Node 里逐项补环境
5. 每一步都沉淀为 task artifact，而不是只留在对话里

## 已沉淀链路

以下参数链路已有公开索引，可作为仓库内复用入口：

- 某东 `h5st` 参数
  - 索引：[scripts/cases/README.md](scripts/cases/README.md)
  - Case：[scripts/cases/jd-h5st-pure-node.mjs](scripts/cases/jd-h5st-pure-node.mjs)

- 某手 `falcon` 风控参数
  - 索引：[scripts/cases/README.md](scripts/cases/README.md)
  - Case：[scripts/cases/ks-hxfalcon-pure-node.mjs](scripts/cases/ks-hxfalcon-pure-node.mjs)

- 某音 `a-bogus` 参数
  - 索引：[scripts/cases/README.md](scripts/cases/README.md)
  - Case：[scripts/cases/douyin-a-bogus-pure-node.mjs](scripts/cases/douyin-a-bogus-pure-node.mjs)

说明：

- README 首页只展示脱敏后的参数类型和公开入口
- 真实 `artifacts/tasks/<task-id>/` 默认视为本地私有任务目录
- Git 默认只提交 `artifacts/tasks/_TEMPLATE/`

## 支持的能力

### 页面观察与脚本定位

先回答“页面里有哪些脚本、目标代码大概在哪”。

- `list_scripts`：列出当前页面已加载的脚本，先建立脚本范围。
- `get_script_source`：查看指定脚本源码，适合继续阅读具体实现。
- `find_in_script`：在单个脚本里定位字符串、变量名或特征片段。
- `search_in_scripts`：在已采集脚本缓存中批量搜索，适合缩小候选脚本范围。

### Hook 与运行时采样

先做最小侵入式观测，确认运行时到底调用了什么。

- `create_hook`：创建可复用的 hook 定义，用于后续注入页面。
- `inject_hook`：把已有 hook 注入当前页面，开始采样目标行为。
- `get_hook_data`：读取 hook 采集到的调用记录和摘要结果。
- `hook_function`：直接 hook 全局函数或对象方法，记录参数和返回值。
- `trace_function`：按源码函数名做调用追踪，适合跟调用链。

### 断点与调试控制

当 hook 不够时，再进入暂停式调试。

- `set_breakpoint`：按脚本 URL 和行号设置断点。
- `set_breakpoint_on_text`：按代码文本自动定位并设置断点。
- `resume`：继续执行到下一个断点或执行结束。
- `pause`：手动暂停当前页面的 JavaScript 执行。
- `step_over` / `step_into` / `step_out`：单步控制执行路径，分别对应跳过、进入、跳出函数。

### 请求链路与网络分析

定位目标请求，确认是谁发起、带了什么参数。

- `list_network_requests`：列出当前页面的网络请求，先找到目标请求。
- `get_network_request`：查看单个请求的详细内容，包括请求头、响应和载荷。
- `get_request_initiator`：追溯某个请求是谁触发的，帮助定位调用链。
- `break_on_xhr`：在目标请求发出时中断，适合抓参数生成前的现场。

### 页面状态与运行前检查

补看页面运行状态、控制台输出和本地状态依赖。

- `check_browser_health`：检查浏览器连接和当前页是否可控，适合作为起手验证。
- `list_console_messages`：查看当前页面 console 输出，适合回看 hook 和 trace 日志。
- `get_storage`：读取 cookie、`localStorage`、`sessionStorage`，确认状态依赖。
- `evaluate_script`：在当前选中 frame 内执行一段函数，做小范围运行时验证。
- `search_in_sources`：在所有已加载源码中搜索关键字，快速缩小可疑代码范围。

### WebSocket 观察与消息分组

处理长连接、直播流或二进制帧时，用这组工具先分流再细看。

- `list_websocket_connections`：列出当前页面的 WebSocket 连接，先拿到目标 `wsid`。
- `analyze_websocket_messages`：按帧特征做消息分组，适合先识别不同消息类型。
- `get_websocket_messages`：查看某个连接或某个分组下的消息摘要和内容。

### 本地复现与补环境

把页面证据带回本地，逐步补齐 Node 运行环境。

- `export_rebuild_bundle`：导出本地复现工程所需的入口、补环境和证据材料。
- `diff_env_requirements`：根据报错和观测能力比对当前缺失的环境能力。
- `record_reverse_evidence`：把关键观察结果写入 task artifact，避免证据只留在对话里。

### 页面自动化

做最小必要的页面操作，复现触发条件并辅助取证。

- `navigate_page`：跳转、回退、刷新当前页面。
- `query_dom`：查询页面元素，确认选择器和节点状态。
- `click_element`：按选择器触发点击，复现页面动作。
- `type_text`：向输入框写入文本，驱动表单交互。
- `take_screenshot`：截取页面当前状态，保留可视化证据。

### 深度分析

在拿到代码和运行时证据后，继续做结构理解与去混淆。

- `collect_code`：采集页面代码，支持按优先级或范围控制采样量。
- `understand_code`：结合静态分析和 AI 做代码结构、业务逻辑与风险理解。
- `deobfuscate_code`：对混淆代码做清理、还原和辅助分析。
- `risk_panel`：聚合代码分析、加密检测和 hook 信号，输出综合风险视图。

### 会话与登录态复用

- `save_session_state`：保存当前页面的 cookie 和存储状态到内存快照。
- `restore_session_state`：把快照恢复到当前页面，复用登录态和现场。
- `dump_session_state`：把会话快照导出为 JSON 文件，便于持久化。
- `load_session_state`：从已有 JSON 或字符串重新载入会话快照。

完整参数说明见 [docs/reference/tool-reference.md](docs/reference/tool-reference.md)。
按逆向流程选工具可继续看 [docs/reference/reverse-workflow.md](docs/reference/reverse-workflow.md)。


### 外部 AI 怎么配置

这个项目支持把外部 LLM 作为“分析增强层”接进来，当前支持：

- `openai`
- `anthropic`
- `gemini`

配置入口本质上是进程环境变量。  
通过 MCP 客户端启动时，优先在 MCP server 配置里的 `env` 传入；`.env` 只适合你直接本地运行 `node build/src/index.js` 或 `npm run start` 的场景。

推荐方式示例：

```toml
[mcp_servers.js-reverse]
command = "node"
args = ["/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js"]

[mcp_servers.js-reverse.env]
DEFAULT_LLM_PROVIDER = "anthropic"
ANTHROPIC_API_KEY = "your_key"
ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"
```

如果你是直接在项目目录本地启动，也可以使用 `.env`：

```bash
# 三选一：openai / anthropic / gemini
DEFAULT_LLM_PROVIDER=gemini

# OpenAI
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=

# Anthropic / Claude
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_BASE_URL=

# Gemini
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash-exp

# 如果不用 API，也可以走本地 CLI
GEMINI_CLI_PATH=gemini-cli
```

说明：

- `DEFAULT_LLM_PROVIDER` 决定默认走哪个 provider
- `gemini` 支持两种模式：有 `GEMINI_API_KEY` 时走 API；没有时会尝试走 `GEMINI_CLI_PATH`
- `openai` 和 `anthropic` 需要对应 API key
- 如果你配了多个 provider，实际使用哪个，仍由 `DEFAULT_LLM_PROVIDER` 决定

### 哪些功能依赖外部 AI

强依赖外部 AI 的功能：

- `understand_code`
  - 内部会调用 LLM 做代码语义理解、业务逻辑提取、安全风险补充

可选启用外部 AI 的功能：

- `detect_crypto`
  - 只有传 `useAI=true` 时才会额外调用 LLM；不传时主要依赖本地规则和 AST 分析
- `analyze_target`
  - 传 `useAI=true` 时会在一站式分析里启用更深的 AI 辅助分析
- `risk_panel`
  - 参数里有 `useAI`，但当前实现主体仍以本地分析结果聚合为主

有 AI 时效果更好，但不配也能运行的功能：

- `deobfuscate_code`
  - 本地规则、AST 优化、专项反混淆管线始终可用；配置外部 AI 后，复杂语义清理、VM 结构理解、部分编码型混淆降级分析会更完整

完全不依赖外部 AI 的功能：

- 浏览器接管
- Hook / 断点 / Console / Storage / Network / WebSocket
- `collect_code`
- `export_rebuild_bundle`
- `diff_env_requirements`
- `record_reverse_evidence`

如果没配外部 AI，典型影响是：

- `understand_code` 会直接报 provider 未配置
- `detect_crypto(useAI=true)` 会退回本地分析或忽略 AI 增强
- `deobfuscate_code` 仍可跑，但某些高难度混淆的解释和清理质量会下降

## 标准任务结构

任务目录统一使用：

- `artifacts/tasks/_TEMPLATE/`
- `artifacts/tasks/<task-id>/`

推荐目录结构：

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

职责边界：

- `env.js`
  - 基础宿主对象和最小 shim
- `polyfills.js`
  - 代理诊断层、`watch`、`safeFunction`、`makeFunction`
- `entry.js`
  - 运行入口、目标脚本加载、first divergence 输出

## 标准执行流程

推荐流程：

1. 页面观察
2. 运行时采样
3. 证据入库
4. local rebuild
5. 逐项补环境
6. first divergence 定位
7. `env-pass` 后再进入纯算法 / 风控逻辑提纯

默认原则：

- 不要跳过页面证据直接猜环境
- 不要一次性全量模拟浏览器
- 不要把真实任务目录直接提交 Git

## 参数沉淀与安全边界

参数链路沉淀遵循以下规则：

1. 先读本地 task artifact
- `artifacts/tasks/<task-id>/`

2. 本地没有时再读抽象 case
- `scripts/cases/*`

3. 仍不足时按模板新建
- `docs/reference/parameter-methodology-template.md`
- `docs/reference/parameter-site-mapping-template.md`

安全边界：

- case 只保留抽象方法和流程
- 真实任务目录默认本地保留
- 敏感值必须脱敏后才允许共享
- Git 默认只提交 `_TEMPLATE`

详见：

- [docs/reference/case-safety-policy.md](docs/reference/case-safety-policy.md)
- [docs/reference/reverse-artifacts.md](docs/reference/reverse-artifacts.md)
- [docs/reference/env-patching.md](docs/reference/env-patching.md)

## 3 分钟快速开始

### 1) 安装依赖并构建

```bash
npm install
npm run build
```

构建入口：

```bash
build/src/index.js
```

### 2) 最简单启动方式

```bash
npm run start
```

### 3) 配置客户端

最小配置示例：

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

如果你需要接管已经打开的浏览器，请继续看：

- [docs/guides/browser-connection.md](docs/guides/browser-connection.md)
- [docs/guides/client-configuration.md](docs/guides/client-configuration.md)

完整可直接复制的 MCP 配置实例，包括：

- `mcpServers` JSON 结构示例
- Codex `config.toml` 示例
- `--browserUrl` 接管浏览器示例
- Gemini / Claude / OpenAI 的 API `env` 示例

都放在 [docs/guides/client-configuration.md](docs/guides/client-configuration.md)。

## 文档入口

逆向相关任务开场先读：`docs/reference/reverse-bootstrap.md`。该入口会继续要求模型读取 `docs/reference/case-safety-policy.md`、`docs/reference/reverse-workflow.md`；若已进入 `env-pass` 后的提纯阶段，再读 `docs/reference/pure-extraction.md`。

### Guides

- 快速开始：[docs/guides/getting-started.md](docs/guides/getting-started.md)
- 浏览器连接：[docs/guides/browser-connection.md](docs/guides/browser-connection.md)
- 客户端配置：[docs/guides/client-configuration.md](docs/guides/client-configuration.md)
- 逆向工作流：[docs/reference/reverse-workflow.md](docs/reference/reverse-workflow.md)
- 补环境规范：[docs/reference/env-patching.md](docs/reference/env-patching.md)

### Reference

- 模型首读入口：[docs/reference/reverse-bootstrap.md](docs/reference/reverse-bootstrap.md)
- 逆向任务索引：[docs/reference/reverse-task-index.md](docs/reference/reverse-task-index.md)
- 工具参数总表：[docs/reference/tool-reference.md](docs/reference/tool-reference.md)
- 工具读写契约：[docs/reference/tool-io-contract.md](docs/reference/tool-io-contract.md)
- 任务产物说明：[docs/reference/reverse-artifacts.md](docs/reference/reverse-artifacts.md)

### Templates And Supporting Docs

- [docs/reference/reverse-update-prompt-template.md](docs/reference/reverse-update-prompt-template.md)
- [docs/reference/reverse-report-template.md](docs/reference/reverse-report-template.md)
- [docs/reference/algorithm-upgrade-template.md](docs/reference/algorithm-upgrade-template.md)
- [docs/reference/parameter-methodology-template.md](docs/reference/parameter-methodology-template.md)
- [docs/reference/parameter-site-mapping-template.md](docs/reference/parameter-site-mapping-template.md)

## 开发与测试

```bash
npm run build
npm run test:unit
npm run test:property
npm run coverage:full
```

## 故障排查

更多问题排查请看：

- [docs/guides/browser-connection.md](docs/guides/browser-connection.md)

## 参考项目

本项目在设计和实现过程中参考了以下项目，具体协议声明（如 MIT 等）以对应上游仓库为准：

- https://github.com/wuji66dde/jshook-skill
- https://github.com/zhizhuodemao/js-reverse-mcp

## Wasm 与 JSON Plugin

### Wasm 功能介绍

项目现在内置了一套面向 WebAssembly 逆向的工具链。

### Wasm API

#### `collect_wasm`

用途：从目标页面采集 Wasm 模块及运行时事件，并在需要时写入 reverse task artifacts。

主要参数：

- `url`: 目标页面 URL
- `timeout?`: 页面采集超时
- `waitAfterLoadMs?`: 页面加载后额外等待时间
- `includeRuntimeEvents?`: 是否返回运行时事件
- `includeImports?`: 是否在结果中展开 imports
- `includeExports?`: 是否在结果中展开 exports
- `maxModules?`: 最多保留的模块数
- `captureBase64?`: 是否在采样阶段保留 base64 载荷

#### `list_wasm_modules`

用途：列出当前会话已经捕获到的 Wasm 模块。

主要参数：

- `includeImports?`
- `includeExports?`

#### `analyze_wasm_module`

用途：对单个 Wasm 模块做静态结构分析。

输入三选一：

- `moduleId`
- `base64`
- `artifactPath`

可选分析参数：

- `includeFunctionSignatures?`
- `includeRawSectionMap?`
- `includeStringScan?`
- `maskSensitiveStrings?`
- `maxStringSlots?`
- `maxSummaryLines?`

#### `inspect_wasm_exports`

用途：结合运行时事件总结导出函数的使用情况，并给出高价值入口点候选。

主要参数：

- `moduleId`

#### `summarize_wasm_boundary`

用途：构建 `JS -> memory bridge -> Wasm export -> sink` 的候选链路，帮助定位 Wasm 参与签名、编码、压缩、加密的边界位置。

主要参数：

- `moduleId`
- `maxChains?`

#### `analyze_wasm_signature_diff`

用途：对比多个边界链路中的输入变化，识别更像签名材料的 header/query/body 字段。

主要参数：

- `moduleId`
- `exportName?`
- `maxChains?`

#### `decompile_wasm_module`

用途：使用 `wabt/wasm2wat` 将 Wasm 反汇编为 WAT，并输出函数级行为摘要。

输入三选一：

- `moduleId`
- `base64`
- `artifactPath`

可选参数：

- `maxWatChars?`
- `foldExprs?`
- `inlineExport?`

### JSON Hook Plugin 功能介绍

项目的 Hook 插件体系里已经加入了 `json` 类型插件，用来直接观察页面里的 `JSON.stringify` 和 `JSON.parse` 调用。这类点位通常正好位于“参数对象 -> 字符串请求体”和“响应文本 -> 对象”之间，适合拿来确认签名前后的结构变化、定位序列化入口、观察是否有额外字段注入。

当前实现特点：

- 同时 Hook `JSON.stringify` 和 `JSON.parse`
- 自动记录 `operation`、`callCount`、`timestamp`
- `JSON.stringify` 会记录 `valueType`、`valuePreview`、`hasReplacer`、`replacerType`、`spaceType`、`serializedLength`、`resultPreview`
- `JSON.parse` 会记录 `textPreview`、`textLength`、`hasReviver`、`reviverType`、`resultType`、`resultPreview`
- 如果开启栈采集，还会附带 `stack`
- 当前实现里，`action: "block"` 会直接阻断调用；未阻断时会保持原始逻辑执行并记录结果

## License

Apache-2.0

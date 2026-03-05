# JS Reverse MCP

一个面向 **JavaScript 逆向分析** 的 MCP 服务器。  
让 Claude/Codex/Cursor 等 AI 客户端直接调用浏览器调试能力，完成脚本定位、断点调试、Hook 采样、网络链路分析、混淆还原和风险评估。

## 这个项目解决什么问题

在传统逆向流程里，你通常要在 DevTools、脚本文件、抓包工具之间来回切换。  
`js-reverse-mcp` 把这些能力统一成 MCP 工具，让 AI 可以按步骤执行完整分析链路：

1. 打开页面并收集脚本
2. 搜索目标函数/关键字符串
3. 自动注入 Hook 并采样请求
4. 分析签名链路、加密算法、调用栈
5. 输出可执行的下一步动作（而不是只给概念）

## 核心能力

- 脚本与源码分析：`list_scripts`、`get_script_source`、`find_in_script`、`search_in_scripts`
- 断点与执行控制：`set_breakpoint`、`set_breakpoint_on_text`、`resume`、`pause`、`step_over/into/out`
- Hook 与运行时观测：`create_hook`、`inject_hook`、`get_hook_data`、`hook_function`、`trace_function`
- 页面早期注入：`inject_preload_script`，可在页面脚本执行前挂早期 hook、补环境脚本和首屏初始化采样
- 网络与请求链路：`list_network_requests`、`get_network_request`、`get_request_initiator`、`break_on_xhr`
- 一体化逆向工作流：`analyze_target`、`collect_code`、`understand_code`、`deobfuscate_code`、`risk_panel`
- 页面自动化与 DOM：`navigate_page`、`query_dom`、`click_element`、`type_text`、`take_screenshot`
- 登录态管理：`save_session_state`、`restore_session_state`、`list_session_states`、`dump_session_state`、`load_session_state`
- 反检测能力：`inject_stealth`、`list_stealth_presets`、`set_user_agent`

完整参数说明见 `docs/tool-reference.md`。

## 最近增强

- `--autoConnect`：优先探测本机常见 DevTools 端口并接管已经打开的 Chrome，适合手动登录后再让 AI 接管。
- `inject_preload_script`：在后续文档加载前执行脚本，适合首屏初始化、首次请求前参数生成、早期 hook 和补环境采样。
- 断点防卡死自动恢复：同一断点短时间高频命中时会自动执行 `resume` + `remove_breakpoint`，并在 `get_paused_info` 给出恢复提示，降低长时间无响应风险。
- response body 超时降级：读取大响应体或卡住的响应时会超时返回，不再把整条采样链路拖死。
- console 错误链展开：调试输出会展开 `Error.stack` 和 `cause` 链，便于从页面报错追到真实调用路径。

## 2.0 升级公告

`JSReverser-MCP 2.0` 现已正式发布（`v2.0.0`）。

本次升级聚焦三个方向：

- 稳定性：新增断点防卡死自动恢复，减少调试长时间无响应。
- 可操作性：调试工具输出补充恢复与降级建议（`resume` / `remove_breakpoint` / `hook_function` / `trace_function`）。
- 可靠性：完成 MCP 78 工具实例补测与回归验证，覆盖更完整、结论可追溯。

建议从 `v1.x` 升级到 `v2.0.0` 以获得更稳定的逆向调试体验。

## 快速开始（3 分钟）

### 1) 安装依赖并构建

```bash
npm install
npm run build
```

构建完成后入口文件为：`build/src/index.js`

### 2) 本地启动（可选）

```bash
npm run start
```

### 3) 配置 MCP 客户端

通用 MCP 客户端（如支持 JSON 的客户端）配置如下：

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js"]
    }
  }
}
```

请使用**绝对路径**，避免客户端工作目录变化导致找不到入口文件。

### 4) 连接“已开启”的 Chrome（远程调试）

如果你已经在本机开了一个 Chrome，并希望 MCP 直接接管它，请按下面做。

#### 4.1 启动 Chrome 并打开 remote debugging

Windows:

```bash
"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\tmp\\chrome-mcp"
```

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mcp
```

Linux:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mcp
```

#### 4.2 在 MCP 里连接这个浏览器（两种方式）

方式 A: 通过 `browserUrl`（最简单）

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js",
        "--browserUrl",
        "http://127.0.0.1:9222"
      ]
    }
  }
}
```

方式 B: 通过 `wsEndpoint`（更精确）

1. 先取 WS 地址：

```bash
curl http://127.0.0.1:9222/json/version
```

2. 读取返回里的 `webSocketDebuggerUrl`，再放进 MCP:

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js",
        "--wsEndpoint",
        "ws://127.0.0.1:9222/devtools/browser/<id>"
      ]
    }
  }
}
```

注意：

- `--browserUrl` 与 `--wsEndpoint` 二选一，不要同时配置
- 也可以直接加 `--autoConnect`，让服务优先探测本机常见 DevTools 端口并自动接管已打开的 Chrome
- 如果端口不是 `9222`，把所有示例里的端口替换成你的实际端口
- 已连接远程 Chrome 时，不要再强制本服务自行启动另一个浏览器实例

## 常见客户端接入

### Claude Code

```bash
claude mcp add js-reverse node /ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js
```

### Cursor

`Settings -> MCP -> New MCP Server`，填入：

- Command: `node`
- Args: `[/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js]`

### Codex

Codex 使用 `config.toml`，不是 JSON。可在 `~/.codex/config.toml` 中配置：

```toml
[mcp_servers.js-reverse]
command = "node"
args = ["/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js"]
```

如果你平时是先手动开好 Chrome 再让 MCP 接管，可以把参数改成：

```toml
[mcp_servers.js-reverse]
command = "node"
args = ["/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js", "--autoConnect"]
```

如需连接已开启的 Chrome，可在 `args` 里追加：

```toml
[mcp_servers.js-reverse]
command = "node"
args = [
  "/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js",
  "--browserUrl",
  "http://127.0.0.1:9222"
]
```

客户端接入说明统一维护在本 README，不再单独拆分到 `docs`。

## 安装逆向 Skill（可选）

本仓库内置了一个可复用技能：

- `skills/mcp-js-reverse-playbook`

用于规范化执行前端 JS 逆向流程（页面观察、task artifact 沉淀、local rebuild、本地补环境、VMP 插桩、AST 去混淆、证据化输出）。

配套模板：

- `docs/reverse-update-prompt-template.md`
- `docs/reverse-report-template.md`
- `docs/algorithm-upgrade-template.md`

### 本地安装（在仓库目录）

```bash
npx skills add ./skills --skill mcp-js-reverse-playbook --copy -y
```

### 从 GitHub 安装

```bash
npx skills add NoOne-hub/JSReverser-MCP --skill mcp-js-reverse-playbook --copy -y
```

说明：

- 建议使用 `--copy`，避免符号链接在不同环境下产生空目录问题。
- 安装后重启对应 AI 客户端，使新 Skill 生效。

## 环境变量配置

复制示例配置：

```bash
cp .env.example .env
```

### AI Provider（可选）

```bash
# openai | anthropic | gemini
DEFAULT_LLM_PROVIDER=gemini

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com  # optional, for proxy/custom endpoint
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Gemini
GEMINI_API_KEY=...
GEMINI_CLI_PATH=gemini-cli
GEMINI_MODEL=gemini-2.0-flash-exp
```

说明：

- 不配置 AI 也可使用非 AI 工具（调试/Hook/网络/页面控制）
- 配置 AI 后可用 `understand_code`、`deobfuscate_code`、`risk_panel` 等增强能力

### 浏览器与远程调试（可选）

```bash
BROWSER_HEADLESS=true
BROWSER_ISOLATED=true
BROWSER_EXECUTABLE_PATH=/path/to/chrome
BROWSER_CHANNEL=chrome
USE_STEALTH_SCRIPTS=false

REMOTE_DEBUGGING_URL=http://localhost:9222
REMOTE_DEBUGGING_PORT=9222
```

### 调试日志（可选）

```bash
DEBUG=mcp:*
```

## 推荐逆向工作流

### Observe-first / local rebuild 策略

> **重要：优先页面观察，随后最小化 Hook 采样，再进入 local rebuild。**
>
> 不要跳过页面证据直接猜 Node 环境。

推荐顺序：

1. 页面观察：`analyze_target`、`search_in_scripts`、`list_network_requests`、`get_request_initiator`
2. 运行时采样：`create_hook`、`inject_hook`、`get_hook_data`
3. 证据入库：`record_reverse_evidence`
4. 本地导出：`export_rebuild_bundle`
5. 本地补环境：`diff_env_requirements` + 逐步补 `env/entry.js`

每次任务建议都写入 `artifacts/tasks/<taskId>/` 形成 task artifact，便于 Codex / Claude / Gemini 续做。

相关文档：

- `docs/reverse-artifacts.md`
- `docs/codex-reverse-workflow.md`
- `docs/reverse-task-index.md`
> 本项目提供两套动态分析机制：**Hook（注入式）** 和 **Breakpoint（断点式）**。
> 对于 AI 客户端，Hook 方式更可靠，因为断点需要暂停/恢复执行的多步协调，容易因时序问题导致超时或状态异常。

| 对比项 | Hook 方式 | Breakpoint 方式 |
|--------|----------|----------------|
| **工具** | `create_hook` + `inject_hook` + `get_hook_data`，或 `hook_function` | `set_breakpoint` / `set_breakpoint_on_text` + `resume` + `evaluate_on_callframe` |
| **原理** | 注入 JS 包装原函数，持续记录调用 | Chrome Debugger 暂停执行，逐步检查 |
| **对执行的影响** | 不暂停，页面正常运行 | 暂停 JS 执行，需要手动 resume |
| **适合场景** | 监控函数出入参、采样请求、追踪调用链 | 需要查看局部变量、单步调试特定逻辑 |
| **AI 友好度** | ⭐⭐⭐ 高 — 单次注入，异步采集 | ⭐ 低 — 多步协调，时序敏感 |

**推荐决策路径：**

```
需要观察函数调用/参数/返回值？
  → hook_function 或 create_hook + inject_hook

需要拦截/监控网络请求？
  → create_hook(type: "fetch"/"xhr") + inject_hook

需要查看函数内部局部变量？
  → 先尝试 hook_function(logArgs + logResult + logStack)
  → 仍不够时才用 set_breakpoint + evaluate_on_callframe

断点多次失败（超时/状态异常）？
  → 立即切换为 hook 方式
```

### 工作流 A：快速定位签名逻辑

1. `new_page` 打开目标站点
2. `analyze_target` 一键执行采集+分析+关联
3. 查看 `priorityTargets` / `requestFingerprints`
4. 对高优先级函数调用 `search_in_scripts` + `understand_code`
5. 对可疑代码执行 `deobfuscate_code`

### 工作流 B：请求参数动态追踪（Hook 优先）

1. `create_hook(type: "fetch")` + `inject_hook` 注入网络请求监控
2. 在页面触发下单/登录等关键动作（`click_element`）
3. `get_hook_data(view: "summary")` 拉取记录并对比参数变化
4. 对目标函数 `hook_function(target: "window.sign", logStack: true)` 追踪调用链
5. 仍需深入时才用 `break_on_xhr` + `get_request_initiator` 看完整调用栈

### 工作流 C：风险评估与报告

1. `collect_code` 收集高优先级脚本
2. `risk_panel` 汇总安全风险与密码学风险
3. `export_session_report` 导出分析报告（JSON/Markdown）

### 工作流 D：登录态复用（登录一次，多次分析）

1. 手动登录目标网站后执行 `save_session_state`（建议指定 `sessionId`）
2. 用 `dump_session_state` 导出到文件（可放在你自己的安全目录）
3. 下次会话先 `load_session_state`（从文件或 JSON）
4. 执行 `restore_session_state` 回灌 cookies/storage
5. 用 `check_browser_health` 确认页面可控后继续 `analyze_target`

## 开发与测试

```bash
# 构建
npm run build

# 单元测试
npm run test:unit

# 属性测试
npm run test:property

# 覆盖率（当前默认口径：核心 jshook + services）
npm run coverqge

# 全量覆盖率口径
npm run coverage:full
```

## 文档索引

- 逆向任务索引（按目标查工具）：`docs/reverse-task-index.md`
- 工具参数总表：`docs/tool-reference.md`
- JSHook 使用示例：`docs/jshook-examples.md`
- 常见问题排查：`docs/jshook-troubleshooting.md`
- Gemini Provider 说明：`docs/gemini-provider-implementation.md`

## 故障排查

- `Cannot find module ... build/src/index.js`
  - 先执行 `npm run build`
  - 确认文件存在：`build/src/index.js`
- Node 版本不兼容
  - 本项目要求：`^20.19.0 || ^22.12.0 || >=23`
- 浏览器连接失败
  - 检查 Chrome 可用性和 `REMOTE_DEBUGGING_URL/PORT`
- AI 调用失败
  - 检查 `DEFAULT_LLM_PROVIDER` 与对应 API Key/CLI 路径

## 参考项目

- https://github.com/wuji66dde/jshook-skill
- https://github.com/zhizhuodemao/js-reverse-mcp

## License

Apache-2.0

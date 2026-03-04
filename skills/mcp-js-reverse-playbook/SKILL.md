---
name: mcp-js-reverse-playbook
description: 在使用 MCP 做前端 JavaScript 逆向时使用，适用于签名链路定位、页面观察取证、本地补环境复现、VMP 类插桩分析、AST 去混淆与证据化输出。
---

# MCP 前端 JS 逆向作业规范

## 核心原则

- `Observe-first`
- `Hook-preferred`
- `Breakpoint-last`
- `Rebuild-oriented`
- `Evidence-first`

先页面观察，再最小化采样，再做本地补环境，不要跳过取证直接猜环境。

## 目标场景

默认主场景是：

1. 定位接口签名、加密参数、关键请求字段
2. 在页面里确认哪个请求、哪个脚本、哪个函数参与参数生成
3. 导出本地复现材料
4. 在 Node 里逐步补环境跑通
5. 跑通后再做 AST 去混淆、VMP 插桩或逻辑提纯

## 五阶段工作流

### 1. Observe

目标：

- 先确认目标请求、相关脚本、候选函数，不猜环境。

默认入口：

- `references/automation-entry.md`
- `references/mcp-task-template.md`

必须产出：

- 目标请求
- initiator 线索
- 可疑脚本 URL / scriptId
- 初始 task artifact

### 2. Capture

目标：

- 对目标请求做最小侵入采样，拿到参数样例、调用顺序、运行时证据。

规则：

- 优先 fetch/xhr hook
- 命中后先看 summary，再按需看 raw
- Hook 不足时再考虑断点

### 3. Rebuild

目标：

- 把页面证据导出为本地可迭代的 Node 复现工程。

参考：

- `references/local-rebuild.md`
- `references/task-artifacts.md`

规则：

- 本地补环境必须以页面观测证据为依据
- 不允许空想式补 `window/document/navigator/crypto/storage`

### 4. Patch

目标：

- 逐项补环境，直到本地脚本能稳定跑出目标参数。

规则：

- 一次只补一个缺口
- 每次补丁后立即复测
- 每次补丁都写入 task artifact

### 5. DeepDive

目标：

- 本地跑通后，再做去混淆、VMP、控制流还原、业务逻辑提纯。

规则：

- 如果当前任务只是出签名，这一阶段可以降级
- 如果要长期复用算法链路，这一阶段必须做

## 执行要求

- 所有重要步骤都要写入本地 task artifact
- 如果无法解释为什么调用某个工具，就不要调用
- 输出必须满足 `references/output-contract.md`
- 失败时按照 `references/fallbacks.md` 回退
- 参数默认值按 `references/tool-defaults.md`

## 必读引用

- 自动化入口：`references/automation-entry.md`
- 参数默认值：`references/tool-defaults.md`
- 任务输入模板：`references/task-input-template.md`
- MCP 专用任务编排：`references/mcp-task-template.md`
- 任务产物：`references/task-artifacts.md`
- 本地复现：`references/local-rebuild.md`
- 补环境：`references/env-patching.md`、`references/node-env-rebuild.md`
- 插桩：`references/instrumentation.md`
- AST 去混淆：`references/ast-deobfuscation.md`
- 回退：`references/fallbacks.md`
- 输出契约：`references/output-contract.md`
- 案例库：`references/cases/`

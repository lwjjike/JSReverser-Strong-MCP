# Reverse Task Index

按逆向目标快速定位 MCP 工具，减少“该用哪个工具”的试错成本。

默认工作流：

1. 页面观察
2. 运行时采样
3. task artifact 记录
4. local rebuild
5. 本地补环境

读取优先级（强制）：

1. 先读 `artifacts/tasks/<task-id>/`（若存在）
2. 再读 `scripts/cases/*` 抽象 case
3. 最后按模板新建流程：
   - `docs/parameter-methodology-template.md`
   - `docs/parameter-site-mapping-template.md`

## 1) 快速摸清页面加载了什么脚本

- `list_scripts`
- `get_script_source`
- `search_in_scripts`

常用场景：先看主站脚本、动态加载脚本、webpack chunk 的体量和命名。

## 2) 在压缩/混淆代码里定位关键逻辑

- `find_in_script`
- `set_breakpoint_on_text`
- `understand_code`
- `deobfuscate_code`

常用关键词：`sign`、`token`、`nonce`、`encrypt`、`hmac`。

## 3) 追踪请求参数是怎么生成的

- `create_hook`
- `inject_hook`
- `get_hook_data`
- `break_on_xhr`
- `get_request_initiator`

推荐先 Hook `fetch/xhr/websocket`，触发业务动作后再抓记录。

同步记录：

- `record_reverse_evidence`

## 4) 一键分析目标站点（推荐入口）

- `analyze_target`

关键输出：

- `requestFingerprints`
- `priorityTargets`
- `signatureChain`
- `actionPlan`

适合第一次接触目标站，快速得到下一步可执行动作。

## 5) 导出本地补环境工程

- `export_rebuild_bundle`
- `diff_env_requirements`

适合在页面里确认请求链路后，导出 `env/entry.js`、`env/env.js`、`env/polyfills.js`、`env/capture.json` 做 local rebuild。

补环境原则请同时参考：`docs/env-patching-guide.md`

## 6) 评估风险和加密实现

- `detect_crypto`
- `risk_panel`
- `understand_code`

用于识别弱算法、可疑签名实现、安全风险点。

## 7) 页面交互自动化（配合采样）

- `navigate_page`
- `query_dom`
- `click_element`
- `type_text`
- `wait_for_element`
- `take_screenshot`

适合自动触发登录、下单、提交等关键动作后再采集数据。

## 8) 导出分析结果

- `export_session_report`
- `collection_diff`
- `record_reverse_evidence`

用于沉淀会话证据、对比两次采样差异，并把关键结论写入 task artifact。

## 9) 登录态复用（需登录站点建议）

- `save_session_state`
- `restore_session_state`
- `list_session_states`
- `dump_session_state`
- `load_session_state`
- `check_browser_health`

适合“必须登录后才能访问”的目标站，减少重复扫码/验证码成本。

## 10) 典型最小链路

1. `new_page`
2. `analyze_target`
3. 设定目标边界：`targetKeywords`、`targetUrlPatterns`、`targetFunctionNames`、`targetActionDescription`
4. `search_in_scripts`
5. `create_hook` + `inject_hook`
6. 触发页面动作
7. `get_hook_data`
8. `record_reverse_evidence`
9. `export_rebuild_bundle`
10. `diff_env_requirements`
11. `risk_panel`

## 11) 参数总表

完整参数与字段说明请查：`docs/tool-reference.md`

## 12) 参数复现模板复用（推荐）

遇到“某个参数可复现”任务时，先走模板而不是临时写脚本：

1. 先填站点无关模板：`docs/parameter-methodology-template.md`
2. 再填站点映射模板：`docs/parameter-site-mapping-template.md`
3. 按模板执行 Observe/Capture/Rebuild/Verify
4. 可执行代码与完整链路统一放 `artifacts/tasks/<task-id>/`

安全约束：`docs/case-safety-policy.md`

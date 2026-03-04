# JS Reverse MCP 专用任务模板

按固定阶段执行：

1. 页面观察
   - `check_browser_health`
   - `new_page` + 可选 `restore_session_state`
   - `analyze_target`
   - `search_in_scripts`
   - `list_network_requests` / `get_request_initiator`

2. 运行时采样
   - `create_hook(fetch/xhr)` + `inject_hook`
   - 触发动作
   - `get_hook_data(summary)`
   - 命中后 `get_hook_data(raw)` + `record_reverse_evidence`

3. 本地补环境
   - `export_rebuild_bundle`
   - 本地执行 `env/entry.js`
   - `diff_env_requirements`
   - 逐项补环境直到可复现

4. 深挖
   - `deobfuscate_code`
   - 必要时插桩 / VMP 分析

核心要求：

- 页面观察先于本地补环境
- 本地补环境先于深度去混淆
- 每一步都要写 task artifact

# 失败回退
- Hook 无数据：确认动作执行 -> 扩一档范围 -> 仍失败则停，不要直接猜 local rebuild。
- 数据过多：summary 去噪 -> raw 单条下钻。
- 本地补环境失败：先用 `diff_env_requirements` 对齐缺口，再回看页面证据。
- local rebuild 连续两轮无进展：回到页面观察，补 `record_reverse_evidence` 后再继续。
- 断点不稳：回退 Hook 路径。

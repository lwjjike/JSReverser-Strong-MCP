# Local Rebuild

本地复现的默认目标不是“完全模拟浏览器”，而是“先跑通目标参数链路”。

推荐导出文件：

- `env/entry.js`
- `env/env.js`
- `env/polyfills.js`
- `env/capture.json`

执行顺序：

1. 在页面里确认目标请求、脚本、函数
2. 导出本地复现包
3. 运行 `env/entry.js`
4. 根据报错调用 `diff_env_requirements`
5. 一次补一个环境项
6. 补丁写回 task artifact

优先补：

- `window`
- `document`
- `navigator`
- `location`
- `localStorage/sessionStorage`
- `crypto`
- `fetch/XMLHttpRequest`

不要在没有页面证据的情况下大量脑补环境。

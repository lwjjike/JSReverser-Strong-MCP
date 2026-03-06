# 补环境落地规范

这份文档约束本仓库里的本地 Node 补环境流程，目标不是“一次性模拟浏览器”，而是基于 MCP 页面证据，让目标参数链路先跑通，再逐项补缺口。

## 目标原则

- 先取证，再补环境
- 最小宿主，逐项回填
- 代理诊断优先，盲补禁止
- 每次补丁都要能追溯到页面证据或本地报错

## 固定阶段

### 1. MCP 页面取证

先从浏览器侧拿证据，不要直接在 Node 里猜。

优先记录到 `capture.json` 的内容：

- `page.url`
- `page.title`
- `cookies`
- `localStorage`
- `sessionStorage`
- 目标请求样本
- Hook 命中的函数名、参数摘要、返回值摘要
- 目标脚本源码或脚本定位信息

这些数据应来自 MCP 页面观察，不允许人工脑补敏感值或宿主状态。

### 2. 本地最小环境启动

`env.js` 只负责提供基础宿主对象和最小 shim，让目标脚本可以开始执行。

允许放在 `env.js` 的内容：

- `window/self/global`
- `document/location/navigator`
- `history/screen/canvas`
- `localStorage/sessionStorage`
- `atob/btoa`
- 最小 `crypto` 外壳

不允许在这里堆站点定制逻辑、访问日志或大段猜测式补丁。

### 3. 代理诊断层

`polyfills.js` 专门负责代理诊断层。

推荐能力：

- `watch`
- `safeFunction`
- `makeFunction`
- 对 `window/document/navigator/storage/location` 的代理包装
- 统一的 `[env:get]` / `[env:set]` / `[env:has]` / `[env:ownKeys]` / `[env:call]` 诊断日志

代理诊断层的职责是告诉你：

- 哪个对象路径被访问了
- 缺的是值、函数，还是返回对象
- first divergence 首次出现在什么位置

代理诊断层不是用来直接伪造完整浏览器的。

### 4. 按缺口逐项回填

回填时只允许补当前链路缺失的最小项。

补丁类型固定为三类：

- 缺基础值：直接补常量，如 `navigator.userAgent`
- 缺函数壳：用 `makeFunction("createElement")`
- 缺返回对象：补最小返回结构，如 `document.createElement()` 的返回对象

每次补丁都应该满足：

- 能指出来源于哪条页面证据或哪条本地错误
- 能说明为什么只补这一项
- 补完后立刻复测

## 文件职责边界

### `env/env.js`

职责：

- 提供基础宿主
- 提供最小 storage shim
- 提供最小编码/加密壳

禁止：

- 访问日志
- 大量站点定制分支
- 直接内联目标业务脚本

### `env/polyfills.js`

职责：

- 放代理诊断层
- 放可复用的函数伪装能力
- 放“缺函数壳”和“访问日志”的辅助逻辑

禁止：

- 大量业务值硬编码
- 直接替代 `env.js` 作为基础宿主

### `env/entry.js`

职责：

- 先加载 `env.js`
- 再加载 `polyfills.js`
- 读 `capture.json` 对应数据
- 加载目标脚本
- 输出 first divergence 和当前可调用状态

## 推荐判断顺序

1. 先看本地报错
2. 对照代理诊断日志定位缺口路径
3. 回到页面证据确认真实来源
4. 只补当前链路最小所需对象
5. 立即重跑 `env/entry.js`

## 禁止事项

- 不要猜环境
- 不要一次性全量模拟浏览器
- 不要没有页面证据就补 cookie / storage / header / UA
- 不要把补环境逻辑直接塞进 MCP 核心运行时

## 产物要求

每个任务目录至少应保持以下文件可复用：

- `env/env.js`
- `env/polyfills.js`
- `env/entry.js`
- `env/capture.json`

这四个文件共同构成最小 local rebuild 骨架。

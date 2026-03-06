# Env Patching Template Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将本地 Node 补环境流程固化为“先页面取证，再最小宿主，再代理诊断，再逐项回填”的模板与文档约定。

**Architecture:** 保持 MCP 核心工具不变，只增强 `artifacts/tasks/_TEMPLATE/env/*` 本地复现骨架，并新增一份仓库级补环境规范文档。测试通过文档契约断言来约束职责边界，避免后续回退到盲补环境。

**Tech Stack:** TypeScript tests, Node.js ESM env templates, Markdown docs

---

### Task 1: Add failing docs contract

**Files:**
- Modify: `tests/unit/docs/reverse-docs.test.ts`

**Step 1: Write the failing test**

在文档测试里新增断言，要求：
- 存在 `docs/env-patching-guide.md`
- `_TEMPLATE/env/env.js` 定义基础宿主
- `_TEMPLATE/env/polyfills.js` 定义 `watch` / `makeFunction`
- `_TEMPLATE/env/entry.js` 同时加载 `env.js` 与 `polyfills.js`

**Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/docs/reverse-docs.test.js`

Expected: FAIL with missing env patching guide or missing template assertions.

### Task 2: Add env patching guide

**Files:**
- Create: `docs/env-patching-guide.md`

**Step 1: Document the workflow**

写清 4 个阶段：
- MCP 页面取证
- 本地最小环境启动
- 代理诊断补环境
- 按缺口逐项回填

**Step 2: Document file boundaries**

明确：
- `env.js` 只放基础宿主
- `polyfills.js` 放代理诊断层
- `entry.js` 负责加载与 first divergence 输出

### Task 3: Replace template placeholders

**Files:**
- Modify: `artifacts/tasks/_TEMPLATE/env/env.js`
- Modify: `artifacts/tasks/_TEMPLATE/env/polyfills.js`
- Modify: `artifacts/tasks/_TEMPLATE/env/entry.js`

**Step 1: Implement minimal env host**

在 `env.js` 中提供 `window/document/navigator/location/history/screen/storage` 等最小壳。

**Step 2: Implement diagnostic proxy layer**

在 `polyfills.js` 中实现：
- `console_log`
- `safeFunction`
- `watch`
- `makeFunction`
- 对关键全局对象做代理包装

**Step 3: Implement replay entry**

在 `entry.js` 中：
- 加载 `env.js` 与 `polyfills.js`
- 读取 `capture`
- 运行目标脚本
- 输出 first divergence / target function diagnostics

### Task 4: Verify

**Files:**
- Test: `tests/unit/docs/reverse-docs.test.ts`

**Step 1: Run focused verification**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/docs/reverse-docs.test.js`

Expected: PASS

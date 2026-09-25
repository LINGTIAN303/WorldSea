# 第二棵树的 cordis 依赖（自 vendor）

## 来源

- `cordis/lib/index.js` ← `dsh/vendor/cordis/lib/index.js`
  （= deepseek-harness 仓 vendored 的 **`@deepseek-ai/cordis@4.0.4`**；上游 cordis，见其 README）
- `cosmokit/lib/index.js` ← `dsh/vendor/cosmokit/lib/index.js`（`@deepseek-ai/cosmokit`，自持、零外部依赖）
- 两者 **MIT**，`Copyright (c) 2021-present Shigma`（各自 `LICENSE` 原样保留）。

## 为什么自 vendor（而不是 npm 依赖）

npm 公开面 `cordis` 最新只到 `4.0.0-rc.10`（**无 4.0.4**），而 dsh 侧用的是 4.0.4；
且产品域**不依赖 `dsh/` 目录**（fork 纪律：对外契约必须是我们自己的）。裁定见
`docs/plans/2026-09-25-B-正式化第二棵树批计划.md` §一。

## 同步办法（上游更新时）

```bash
cp dsh/vendor/cordis/lib/index.js   apps/tauri/src/world/vendor/cordis/lib/index.js
cp dsh/vendor/cosmokit/lib/index.js apps/tauri/src/world/vendor/cosmokit/lib/index.js
```

搬完跑：`vue-tsc --noEmit` · `npx vitest run` · 工作台产物构建（`node node_modules/vite/bin/vite.js build --config workspace/vite.config.ts`）。
**只搬产物 JS**：不搬 `src/` 与 `.d.ts`（架构门禁会扫 `.ts`；我们只用其子集），类型面见 `cordis.d.ts`。

## 解析

别名（两处同口径）：`@deepseek-ai/cordis` / `@deepseek-ai/cosmokit` → 本目录产物
（`apps/tauri/vite.config.ts` 的 `aliases` + 根 `vitest.config.ts` 的 `resolve.alias`）。
cordis 产物内部只 import `@deepseek-ai/cosmokit` 一个外部包，别名覆盖后即自洽。

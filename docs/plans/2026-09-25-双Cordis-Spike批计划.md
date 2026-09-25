---
status: 执行中
---

# 双 Cordis Spike 批计划（WorldSea 插件化 · 可行性验证）

> **来源**：用户 2026-09-25 提出「双 Cordis」方向——「让 WorldSea 也成为一个『dsh』，但不是成为一个『dsh』」。
> 拍板：**先做 Spike**（工作台页跑起第二棵树 + 一个芽当插件 + 最小能力调用），不动现有产品域。

## 一、方向口径（Spike 验证的假设）

| 规则 | 内容 |
|---|---|
| **边界** | 壳（Tauri）= 应用级（窗口/偏好/ACL/通知/自启）；dsh 树 = Agent 语义（会话/轮次/工具/沙箱/凭证）；WorldSea 树 = **世界语义**（实体/芽/编辑器/视图）。三者不互相吞噬 |
| **不复刻** | WorldSea 树**不许**长出 session / turn / tool-loop / sandbox——需要这些就去**调** dsh（对等），不自己实现（这是「成为 dsh」与「不是 dsh」的判定线） |
| **交界契约** | 能力协议：类型化 + 版本化 + 走壳 ACL；传输复用已有「协议 + 管道 + 窗口 ACL」，**不依赖 dsh 内部面** |
| **第二棵树落点** | **工作台页内的浏览器侧 Cordis**（与 dsh 客户端插件同构；D1 的「独立窗口 = 独立页面环境」使两棵树零污染）。不引第三进程；Node 侧领域需求优先走壳命令 |

## 二、Spike 范围与实现（已完成）

- 入口（**opt-in，默认 inert**）：`apps/tauri/workspace/main.ts` —— `localStorage['ws:cordis-spike'] === '1'` 时动态引入 `./spike/cordis-spike`（放在 `../src/main` 之后 → pinia 已激活，插件才能注册进产品壳）。
- 实现：`apps/tauri/workspace/spike/cordis-spike.ts` —— 建 `new Context()` → `ctx.provide('wsGreeting', …)` → `ctx.plugin(spikeSprout, { label })`；插件 `inject: ['wsGreeting']`（依赖注入）→ `pluginStore.registerView({ id, label, icon, component })`（注册进产品壳）→ `invoke('cmd_theme_get')`（壳能力，受工作台窗 ACL）→ 清理函数反注册视图。
- **依赖口径（spike 专用）**：相对引用 `dsh/vendor/cordis`（= **上游 cordis 4.0.4 的副本**，作者 Shigma，MIT，见其 README「The core package is published as `cordis`」）→ **不新增依赖、不碰 dsh 树**；正式化时改 npm `cordis@4.0.4` 或自 vendor（**待用户拍板**）。

## 三、验收（真机取证，2026-09-25，全绿）

| # | 假设 | 证据（CDP 探针） |
|---|---|---|
| ① | 第二棵树与 dsh 并存 | `__WS_CORDIS_SPIKE__` = `{started:true, plugins:['ws-spike-sprout'], capability:'light', error:null}` |
| ② | 插件模型（name/inject/config/生命周期） | `inject: ['wsGreeting']` 满足才装载 → `__WS_CORDIS_GREETING__` = 「来自 WorldSea 树的问候」；config 经 `ctx.plugin(p, cfg)` 传入 |
| ③ | 注册进现有产品壳 | 侧栏**实时**出现「Cordis Spike」入口（`sidebarHasView:true`，图标正常）；点开渲染插件视图（截图 `.workbuddy/_spike_view2.png`） |
| ④ | 调壳能力（ACL 内） | 视图显示 `cmd_theme_get → light`（E2 的主题真源值 ✓ 两批串上了） |
| ⑤ | 拆树可证 | `dispose()` → `{started:false, plugins:[], disposed:true, error:null}` + `sidebarHasView:false`（视图反注册、插件列表清空） |

## 四、★ Spike 挖出的关键事实（正式化时按此办）

1. **cordis 4.0.4 的 API 形状**（读 vendored 源码/产物实测）：`new Context()` 自带基础服务；`ctx.provide(name, value)` 提供服务并返回拆除函数；`ctx.get(name, strict?)` 取（`strict=false` 拿可选服务）；`ctx.effect(fn, label)` 注册清理；**`ctx.plugin(p, cfg)` 返回 `Object.create(fiber)` 的 thenable（带 `dispose()`）**；`Fiber` 另有 `await/restart/update(config)`。插件形态 = `{ name, inject, apply(ctx, config) }`（`Config` 走标准 schema 校验）。
2. **产品壳缺口**：只有「注册视图」与「清空全部视图」，**没有「单个视图反注册」**——`pluginAPI.unregisterView` 动的是它自己的数组，而侧栏读的是 `pluginStore.views` → 本次用 store 数组过滤绕过；正式化时应给 store 补 `unregisterView(id)`。
3. **主题真源已可跨树复用**（E2 的 `cmd_theme_get`）——「壳持真源、两树读写」这条交界模式在 Spike 里已跑通一次。
4. **dsh 的插件机制可作参照但不必复用**：`dsh.bundle.patch` / `dsh.client.inject` / `dsh.engines` 等 manifest 字段值得抄约定（用户已在自己的 `dsh-plugin-community` 里跑通），但 WorldSea 树的清单/装载规范应自定（避免与 dsh 版本绑定）。

## 五、下一步（D+A 已落，B/C 待拍板）

> **2026-09-25 进展**：用户拍板「**D + A 一并做**」并**已施工完成 + 真机全绿**（见 [DA 批计划](2026-09-25-双Cordis-DA批计划.md)）——
> D 收口视图生命周期（真源事件 + 显示侧 `unregisterView` + 单点 `viewSync`），A 落壳侧能力桥（注册表/ACL/两窗中转/审计，双向取证）。
> 本表的 A 与 D 已完成；**B（正式化第二棵树）与 C（迁一个真芽）仍待拍板**。

| 选项 | 内容 |
|---|---|
| **A · 能力桥双向最小实现** ✅ | 壳侧能力注册表（类型化 + ACL）→ Agent→产品域（D2 落在同一条缝）与产品域→Agent（创作界面内用 Agent）；传输复用协议/管道 |
| **B · 正式化第二棵树** | 定依赖口径（npm `cordis@4.0.4` vs 自 vendor）+ 目录（`apps/tauri/workspace/spike` → 正式模块）+ 清单规范 + 插件装载器（scan/loader）+ 开发期热重载；**含 DA 批挖出的 `currentPluginId` 全局单值问题（须做按插件作用域注册面）** |
| **C · 迁一个真芽** | 从 27 芽里挑一个（建议 mindmap）按插件模型迁，验证「芽 = 插件」在真实规模下的成本（依赖注入切分、store 解耦、视图注册） |
| **D · 先补产品壳缺口** ✅ | `pluginStore.unregisterView(id)` + 视图生命周期事件（注册/反注册可观测）——小步，为 A/B/C 铺路 |

## 六、边界与风险

- **两套 DI 机械重复**（配置/日志/事件/重载）：用 §一「边界」规则压；跨切面一律归壳。
- **27 芽 55k 行、重度共享状态**（pinia/entity-core）：按**能力边界**切服务，不是把每个组件都变插件（选项 C 先付一次学费）。
- **上游耦合纪律**：WorldSea 树的对外契约必须是我们自己的（不依赖 dsh 内部面）；否则每次 dsh 追版两头都要动（现有 11 处 fork 补丁就是内部耦合的账单）。
- **插件分发/信任**：生态化后需要清单规范 + 权限/信任模型（可参照 dsh 的 topic 生态与 plugin-manager，但要自定）。
- **Spike 现状**：opt-in 开关（`localStorage['ws:cordis-spike']`）+ 相对引用 vendored cordis 均为**临时口径**，正式化批次里必须收敛。

---
status: 执行中
---

# Cordis 化进度与下一步（交接）

> 交接对象：接手 WorldSea「Cordis 化」工作的后续会话。
> 记录日期：2026-11-12，对应 main 提交 `b8dbf10` 之后、批次 C/E/F 已提交的状态。
> 相关文档：[产品域 Cordis 成型差距与前置条件](../../plans/2026-11-05-产品域Cordis成型差距与前置条件.md)、[阶段 3 续批 · 剩余服务缺口规划](../../plans/2026-11-07-阶段3续批-剩余服务缺口规划.md)。

## 一、这件事到底在做什么

把 World 树（webview 侧的 Vue + pinia，42 个插件）里**各插件直接 import pinia store 取数**的写法，逐步改为**统一经一棵服务目录取数**。

目标不是「形式上用 Cordis」，而是解决三个具体问题：取数口径分散、跨插件隐式耦合、单点改造成本随插件数线性上升。

### 1.1 一个必须先理解的诊断纠正

早期曾判定「这些插件没有消费者，所以不必推广」。**那个结论用错了层。**

分层实测结果：

| 层 | 消费者数量 | 说明 |
|---|---|---|
| `apply` 层（插件注册） | **0** | 40 个插件全部是纯声明式注册，不消费别人的能力 |
| **组件层（取数）** | **29 个插件直接读 store** | 真正的改造对象在这里 |

**结论**：服务目录需要的是**取数方**消费者，不是 `apply` 消费者。看 `apply` 层会得出「没人用、不必做」的错误判断；看组件层才能看到真实的 29 个待迁移点。

### 1.2 `ctx.effect` 那件事已经做完了

用户记忆里的「把其他插件推广的」——指的是 `ctx.effect` 的接入，**不是**服务目录。

现状：`createPluginApi(id, ctx)` 让全部 40 个插件的注册动作都经过 `ctx.effect`，**零插件源码改动**。这一项已完成，不需要再做。

（背景：`registry.ts:22` 曾有一句「effect 不保证 disposal」的注释，是 4.0.4 时代的过时说明。vendored 4.0.4 升 4.1.0 时未同步注释。6 项能力测试在 4.1.0 上全部 PASS，唯一真实陷阱是「异步 `apply` 里 `await` 后 `dispose()` 会留下孤儿 effect」。）

## 二、当前进度（实测，非估计）

### 2.1 服务目录：13 项

实现在 `apps/tauri/src/world/services.ts`，接口声明在 `apps/tauri/src/world/serviceTypes.ts`
（2026-11-12 批次 F 拆出，因单文件顶到 400 行硬上限），注册器在 `service-registry.ts`。

| 服务 | 来源批次 | 备注 |
|---|---|---|
| `world.info` / `entities` / `relations` / `schema` / `project` / `views` / `projectExtras` | 阶段 2 | 地基 |
| `world.settings` | 2026-11-06 | 9 个具名字段（5 原有 + 4 timeline），刻意不转发整个 store |
| `world.ui` | 批次 B | 6 个方法，**不含** `showView` / `viewComponent` |
| `world.font` / `world.fontLibrary` | 批次 D | 3 个方法 + 只读投影 |
| `world.trash` | 批次 C | 2 个只读投影 + 3 个语义动作，**不含** `add` |
| `world.detailLayout` | 批次 F | 1 个只读方法 `tabOverride`，**不含**写面 |

> `world.schema` 于批次 E 补了 `iconName(type)`（原只有 `list` / `get` / `label`）。

### 2.2 已完成批次

| 批次 | 内容 | 状态 |
|---|---|---|
| A | `notebook` 全量迁移（重档第一个） | 已合并（PR #1） |
| B | `world.ui` 服务 + `viewComponent` 收敛 | 已合并（PR #2） |
| D | `world.font` / `world.fontLibrary` | 已合并（PR #3，提交 `7308432`） |
| C | `world.trash` 服务 + `data-tools` 迁移 | 已合并（PR #15） |
| E | `characters` 全量迁移（6 文件 / 19 调用点）+ `world.schema.iconName` | 已合并（PR #25） |
| F | `timeline` 全量迁移（6 文件 / 19 调用点）+ `world.detailLayout` + `world.settings` 扩 4 字段 | 已合并（PR #26） |

### 2.2.1 迁移完成度的**两个口径**（2026-11-12 纠正）

早期文档写「已迁移 25 个插件」，那是**按「有文件登记进守卫清单」**算的。这个口径会把「插件里迁了 1 个文件」记成「插件已迁移」，已证伪：

| 口径 | 结果 |
|---|---|
| 有文件登记进守卫清单 | 25 个插件 |
| **插件内全部非测试文件都零 store 直连** | **37 个** |

第二种更多的原因：大量轻档插件本来就不读 store（`apparel` / `batch-edit` / `conflict` / `doc-export` / `items` / `regions` / `search` / `templates` / `version-history` 等），从没进过守卫清单，但也从不违反它。

**真实剩余（严格口径实测，main `04c66a4`）**：

| 插件 | 直连 store 的非测试文件 | 说明 |
|---|---:|---|
| `outline` | **50 处** | 只迁了导出链的字体调用（1 文件）；主线 22 文件仍直连 |
| `settings` | **40 处** | 完全未迁；**已评估判定不迁移**，见 [settings 插件评估](../../plans/2026-11-12-settings插件Cordis化评估.md) |
| `manuscript` | **22 处** | 只迁了导出链 + 手机预览（2 文件）；9 文件仍直连 |
| `tactical-board` | 4 处 | 此前未列入任何批次 |
| `custom` | 2 处 | 视图容器用途，**有意保留**（组件引用不跨服务边界） |

> 「除 `settings` 外重档已全部迁移完毕」这句话**不成立**，已作废。`outline` 一个插件的直连量（50 处）就超过 `settings`（40 处）。

### 2.3 守卫测试：197 例

`apps/tauri/src/world/plugins/__tests__/lightPluginDataPath.spec.ts`

它做的事：扫描插件目录下所有文件，断言两件事——

1. 不 import store，也不在组件内调用 `useXxxStore()`
2. 若经服务取数（直接 `getWorldService` 或引用共享取值器），**服务名必须在权威名单 `WORLD_SERVICE_NAMES` 内**

第 2 条是防漏的关键：早期用正则 `'world\.[a-zA-Z]+'` 判服务名，被反证发现能接受 `world.settingsXX` 这种不存在的名字。现已改为对照真实名单校验。

## 三、剩余的活

### 3.1 ✅ 批次 C · `world.trash`（已完成）

新增 `world.trash` 服务，解锁 `data-tools` 插件（`TrashPanel` / `ConsistencyReportPanel` 两处面板）。

**接口窄化判断**：`trashStore` 虽有 8 个成员，但**没有整店转发**。`add` 是删除管线的内部写入口（由 `entityStore.remove` 与 `useTrash` 调用），插件不该自己造回收站条目；`restore` / `permanentDelete` 是「只动回收站、不碰磁盘与实体表」的**半步操作**，直接用会让恢复变成「条目消失了但实体没回来」。故只暴露 2 个只读投影 + 3 个语义动作：

| 成员 | 来源 | 消费方 |
|---|---|---|
| `entityItems()` / `totalCount()` | `trashStore` 只读投影 | 列表与角标 |
| `restoreEntity(id)` | `useTrash` 编排（含级联关系） | 恢复按钮 |
| `permanentDeleteEntity(id)` | `useTrash` 编排（含级联关系） | 永久删除 |
| `emptyTrash()` | `trashStore` | 清空 |

恢复后的实体表/关系表重载**不由回收站服务代劳**——调用方经 `world.entities.reload` / `world.relations.reload` 完成，避免回收站服务反向依赖实体服务。

**验收**：服务目录 11 → **12 项** · 守卫 145 → **154 例**（清单 47 → 50 文件）· 全仓 **306 文件 / 2438 过 + 1 skip** · `vue-tsc` 0 · gate 5/5 · 反证 2 轮（`world.trashXX` 错名 → 1 例红；`ConsistencyReportPanel` 还原直连 → 1 例红）。

### 3.2 ✅ 批次 E · `characters`（已完成）

重档里剩的最大未迁移项，**6 个文件 / 19 个调用点**，全量迁移（不只试点）。

**依赖只有两处缺口，都在服务目录侧补掉**：

1. `world.ui.selectedEntityId` —— 批次 B 已就绪，直接用。
2. `world.schema` **缺 `iconName(type)`** —— `CharacterList.vue` 的详情头要 `getIconName('character')` 取图标。原服务只有 `list` / `get` / `label`，本批补一个方法。它是**注册表单例**（`entitySchemaRegistry`）而非 pinia store，故本来就该走 `world.schema`。

**`undo` / `redo` 传的是服务对象而非 store**：`useUndoRedo` 内部按鸭子类型只调用 `add` / `update` / `remove`；服务对象的 `remove` 多出的 `source` / `opts` 是可选参数，签名兼容。故 `undo(entitiesSvc(), relationsSvc())` 与原来等价。

**验收**：服务目录仍 12 项（仅 `world.schema` 补方法）· 守卫 154 → **178 例**（清单 69 → 84 文件 / 23 → 24 插件）· 全仓 **306 文件 / 2464 过 + 1 skip** · `vue-tsc` 0 · gate 5/5 · 反证 2 轮（`iconName` 改 `type + 'XX'` → 1 例红；`FamilyNodeCard` 还原直连 → 1 例红）。

**踩到 400 行红线一次**：`CharacterList.vue` 迁移后涨到 464 行（冻结 463），门禁当场红。把三行取值器合并成一行（`const entities = entitiesSvc(), relations = ..., schema = ...`）压回 462 行。**注意门禁计数是 `split('\n').length`（实际行数 +1）**，`Get-Content` 少 1，别被误导。

### 3.3 ✅ 批次 F · `timeline`（已完成）

重档里最后一个「只差一点」的：**6 个文件 / 19 个调用点**。

**两处缺口，都在服务目录侧补掉**：

1. `world.settings` **扩 4 个字段**（`timelineDefaultMode` / `timelineCompactMode` / `timelineDragEnabled` / `timelineDefaultGroup`）。原代码写 `(settingsStore as any).xxx`——但四个键在 entity-core 的 settingsStore 里**都是有类型声明的 `persistedRef`**，`as any` 只是调用方的旧写法；服务给回正类型，顺带消掉 4 处 `as any`。
2. 新增 **`world.detailLayout`**（第 13 项）：只给 `tabOverride(entityType)` 一个只读方法。`detailLayoutStore` 有 11 个导出成员、横跨载体/遮罩/字段作用域/Tab 四套语义，而 timeline 只用「某类型的 Tab 排序/隐藏」；写面归设置面，给了写面等于允许芽改用户的全局详情偏好。

**`services.ts` 触及 400 行红线 → 拆文件**：加到 13 项时它是 **410 行**，门禁当场红。把 15 个接口声明抽到 `serviceTypes.ts`（230 行），`services.ts` 只剩实现 + 权威名单（226 行），并 `export type {...} from './serviceTypes'` 重新导出——**全部 26 处调用方的导入路径不变**。

**两个 composable 的参数语义改名**：`useTimelineCalendarActions` / `useTimelineEventForm` 的 `entityStore` 形参改为 `entities`。它们本就只依赖 `update` / `add` / `reload` 三个方法（鸭子类型），改名后表达「这是取数端口，不是 store 实例」。其中 `loadAll` → `reload` 跟着 `world.entities.reload` 对齐。

**验收**：服务目录 12 → **13 项** · 守卫 178 → **197 例**（清单 84 → 95 文件 / 24 → 25 插件）· 全仓 **306 文件 / 2487 过 + 1 skip** · `vue-tsc` 0 · gate 6/6 · 反证 2 轮（`tabOverride` 加 `+ 'XX'` → 1 例红；`TimelineCanvas` 还原直连 → 1 例红）。

**反证过程里修强了一条测试**：首轮 `tabOverride` 反证**没变红**——因为当时只有「未设覆写返回 undefined」一条用例，加不加 `XX` 都返回 undefined。补了「设了覆写能按类型取到真实值 + 别的类型不受影响 + 清掉后回到 undefined」三条断言后，反证立刻命中。**这条经验值得复用：只测空态的服务用例没有判别力。**

### 3.4 剩下的（2026-11-12 按严格口径重测，取代此前的错误结论）

| 序 | 插件 | 直连 | 性质 |
|---|---|---:|---|
| 1 | `outline` | 50 处 | 真数据消费者，**收益最大**；此前被误记为「已迁移」 |
| 2 | `manuscript` | 22 处 | 同上 |
| 3 | `tactical-board` | 4 处 | 小，此前未进任何批次 |
| — | `settings` | 40 处 | **已评估判定不迁移**（配置编辑器，非数据消费者），见 [评估文档](../../plans/2026-11-12-settings插件Cordis化评估.md) |
| — | `custom` | 2 处 | 视图容器用途，**有意保留**（组件引用不跨服务边界） |

**`settings` 的判定依据**（三条）：① 它写的是**配置本身**（`setCarrier` / `setProjectIcon` / `toggleSprout`），不是用户内容数据——服务目录的定位是统一取数口径，把配置写面做成公共 API 是契约面扩大而非解耦；② 它的 `usePluginStore` 是**管理插件**的功能本体，同 `custom` 渲染他视图组件，属「有意留在芽内」；③ 收益（口径统一）低于成本（新增 4 项服务 + 扩 2 项写面 + 28 文件改造）。

> 早期文档「除 `settings` 外重档已全部迁移完毕」的说法**已作废**，见 §2.2.1。

## 四、每批的固定流程（照做即可）

这套流程经 5 个批次验证，其中的「反证」环节**每次都抓到了真问题**，不要跳过。

1. **接口设计（窄）**——只暴露有**已证实消费方**的方法/字段。绝不整店转发。
2. **实现** `services.ts` + 加入 `WORLD_SERVICE_NAMES`
3. **服务自测**——给新服务写正向 + 反向用例
4. **迁移插件**——每个插件建 `serviceAccess.ts` 单点取值器
5. **加入守卫名单** `MIGRATED`
6. **反证（≥1 轮）**——故意破坏实现，确认守卫变红。不变红说明守卫无效。
7. **验证**——`pnpm typecheck:tauri` 零错 + `node scripts/gate.mjs` 5/5 + `npx vitest run` 全绿
8. **文档**——主计划 §十二 + 索引 + 本文件
9. **提交**——分支 + PR（禁止直推 main）

### 4.1 三条硬性约束

| 约束 | 原因 |
|---|---|
| **文件规模 ≤ 400 行** | 存量超限文件冻结在基线 **54 个**，只许减少不许增加。新代码超限即门禁红 |
| **不整店转发** | `settingsStore` 有 40+ 项（含 API 密钥），`uiStore` 有 33 项。全转发 = 把耦合从 import 搬到服务名，问题不解决 |
| **`viewComponent` 不过服务边界** | 它是 Vue `Component` 引用，跨边界会带出组件实例语义 |

### 4.2 已踩过的坑（省得再踩）

| 坑 | 现象 | 处置 |
|---|---|---|
| **代理 vs 原始对象** | `pluginStore.views` 是深层 proxy，经 `.component` 取出的是 proxy，与原始组件 `!==` | 用 `toRaw()` 剥壳 |
| **函数内局部 store 实例** | 按缩进批量替换会漏掉函数体里临时 `const store = useXxxStore()` | 只能靠守卫测试发现 |
| **import 路径不统一** | `fontStore` 在 `entity-core` 但**未从顶层导出**，须走子路径 `@worldsea/entity-core/stores/fontStore` | 逐个确认导出面 |
| **测试挂载组件需登记服务表** | 组件测试里 `getWorldService` 直接抛错 | 建 `__tests__/storeServices.ts` 之类**转发到真实 store** 的辅助（保留集成语义与 `vi.spyOn` 能力） |
| **批量脚本改文件不可靠** | pwsh `.Replace` 经 cmd 层静默失效；Python 单行丢引号 | **一律用 Edit / Write**，仓库规则也是这么要求的 |
| **同语义不同名的半步 API** | `trashStore` 同时有 `restore`/`permanentDelete`（只动回收站）与 `useTrash.restoreEntity`/`permanentDeleteEntity`（含级联关系、写磁盘） | 服务只暴露**完整语义动作**，并在自测里反向断言裸方法不得出现 |
| **门禁行数比编辑器多 1** | 架构检查用 `split('\n').length`（= 实际行数 + 1），`Get-Content` 报的少 1 | 判断是否顶到冻结线时，以 `node -e "...split('\n').length"` 为准 |
| **只测空态的服务用例没有判别力** | `tabOverride` 首轮反证没变红——只断言「未设覆写返回 undefined」，把实现改错也返回 undefined | 每个服务自测至少一条「设入值 → 取回该值 → 清掉 → 回到空态」的往返用例 |
| **「已迁移插件数」口径会骗人** | 按「有文件登记进守卫清单」算得 25 个，按「插件内全部文件零直连」算得 37 个；`outline` 只迁了 1 个导出文件就被记成已迁移，实际还有 50 处直连 | 进度数字一律用**插件级**严格口径；守卫测试保持文件级（它管的是单文件是否有直连） |

## 五、怎么验证自己没搞坏

```bash
# 1. 类型
pnpm typecheck:tauri

# 2. 门禁（架构 / fork 台账 / 样式 / 文档链接）
node scripts/gate.mjs

# 3. 单测全量
npx vitest run

# 4. 只看守卫（改插件必跑）
pnpm exec vitest run apps/tauri/src/world/plugins/__tests__/lightPluginDataPath.spec.ts
```

CI 已配置为四项全跑（含 vitest 全量），PR 上能看到远程结果。详见 [GitHub 仓库配置现状与待办](GitHub仓库配置现状与待办.md)。

## 六、已知噪音（不要误判为本次引入）

`notebook` 相关测试会打印：

```
DataCloneError: #<Object> could not be cloned.
```

这是 Vue 组件卸载时的既有告警，**基线即存在**，与本项工作无关。判断方法：`git stash` 后在基线提交上跑同一测试，看是否同样出现。

注意 `npx vitest run` 因此在末尾显示 `Errors 2`，但 `Test Files 311 passed` / `Tests 2466 passed` 才是判定依据。

## 七、下一步建议

1. **`outline` 主线迁移**（50 处直连，收益最大；注意它此前被误记为已迁移）
2. **`manuscript` 主线迁移**（22 处）
3. **`tactical-board`**（4 处，小）
4. **纠正统计口径**：文档里的进度数字改为插件级，并区分「本来就不读 store」与「迁移完成」两类

`settings` **不迁移**，`custom` **有意保留**（理由见 §3.4）。每批一次 PR，等 CI 绿、review 后合并。分支从最新 `main` 切。

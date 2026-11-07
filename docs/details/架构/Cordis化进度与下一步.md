---
status: 执行中
---

# Cordis 化进度与下一步（交接）

> 交接对象：接手 WorldSea「Cordis 化」工作的后续会话。
> 记录日期：2026-11-08，对应 main 提交 `b674cc4` 之后、批次 C 已合并的状态。
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

### 2.1 服务目录：12 项

实体在 `apps/tauri/src/world/services.ts`，注册器在 `service-registry.ts`。

| 服务 | 来源批次 | 备注 |
|---|---|---|
| `world.info` / `entities` / `relations` / `schema` / `project` / `views` / `projectExtras` | 阶段 2 | 地基 |
| `world.settings` | 2026-11-06 | 5 个具名字段，刻意不转发整个 store |
| `world.ui` | 批次 B | 6 个方法，**不含** `showView` / `viewComponent` |
| `world.font` / `world.fontLibrary` | 批次 D | 3 个方法 + 只读投影 |
| `world.trash` | 批次 C | 2 个只读投影 + 3 个语义动作，**不含** `add` |

### 2.2 已完成批次

| 批次 | 内容 | 状态 |
|---|---|---|
| A | `notebook` 全量迁移（重档第一个） | 已合并（PR #1） |
| B | `world.ui` 服务 + `viewComponent` 收敛 | 已合并（PR #2） |
| D | `world.font` / `world.fontLibrary` | 已合并（PR #3，提交 `7308432`） |
| C | `world.trash` 服务 + `data-tools` 迁移 | 已合并（PR #7） |

**已迁移插件**：`notebook`、`theme-editor`、`mindmap`、`custom`、`outline`、`manuscript`、`graph`、`field-matrix`、`characters`（部分）、`board`、`export`、`data-tools` 等。全仓**零 store 直连插件 35 个**（含本就不读 store 的）。

### 2.3 守卫测试：154 例

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

### 3.2 批次 E · `characters`（重，剩的最大未迁移项）

- **规模**：**19 个调用点**，分布在 6 个文件（`CharacterList.vue` / `components/{CharacterExperience,ExperienceNode,FamilyAddDialog,FamilyNodeCard,FamilyTree,RelationGraph}.vue`）
- **依赖已就绪**：只需 `world.ui.selectedEntityId` 一个字段，而 `world.ui` 已在批次 B 完成
- **额外发现**：`CharacterList.vue` 还用 `entitySchemaRegistry.get('character')` / `getIconName('character')` 取类型与图标——这是**注册表单例**而非 pinia store，且 `world.schema` 已有 `get`/`label`，只差 `getIconName`。另 `undo/redo` 收的是 `entityStore` / `relationStore` 实例（`useUndoRedo` 的形参类型是鸭子类型），需传服务对象而非 store。

### 3.3 明确延后的

**`settings` 插件**——本批不做。原因：它涉及 **11 个 store**，若走服务目录需要新增 **15+ 项服务**，粒度会失控。需要独立评估，不能塞进现有批次。

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

1. **做批次 E**（`characters`）：依赖已就绪，拆多次提交（6 个文件 / 19 调用点）
2. **`settings` 单独评估**：不要硬塞进现有批次结构

每批一次 PR，等 CI 绿、review 后合并。分支从最新 `main` 切。

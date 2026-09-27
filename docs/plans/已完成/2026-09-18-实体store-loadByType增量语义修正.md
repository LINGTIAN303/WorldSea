---
status: 已完成
---

# 实体 store 按类型加载的语义修正（`loadByType` 增量语义）

- **状态**：已完成
- **日期**：2026-09-18
- **提交**：见仓库日志（`fix(entity-core): loadByType 改为增量语义`）
- **来源**：大纲白板施工分解 §十三 A-7 / §十四 质量体检登记的框架级缺陷

---

## 一、缺陷：一个「看起来像加载、实际是替换全局状态」的 API

### 1.1 表现

`entityStore.loadByType(type)` 的原实现：

```ts
setAll(sanitize(await storage.getEntitiesByType(type)))   // ← 整体替换
```

`setAll` 是 `entities` 浅数组的**整体赋值**，于是调用它的后果是：

> **store 里其它所有类型的实体，全部从内存中消失** —— 直到下一次 `loadAll()` 才恢复。

它不是「数据丢失」（磁盘完好、刷新即回），而是**内存态被挤掉**，因此症状是"别的芽突然空了"，而重新进入某个会 `loadAll` 的视图又"自己好了"。这类间歇性症状极难在开发时归因。

### 1.2 影响面（逐处核对过全仓）

| 芽 / 位置 | 调用点 |
| --- | --- |
| workflow | `usePipelineTemplates.ts:75`、`usePipeline.ts:72 / 104 / 137 / 144`（5 处） |
| characters | `CharacterList.vue:287 / 309`（2 处） |
| drawing | `useDrawingPersistence.ts:36`（1 处） |
| outline | `useOutlineTree.ts:79`（1 处，**已单独处理，见 §四**） |

另有**无调用点的同型隐患**，见 §五。

### 1.3 曾造成过真实损伤

大纲芽 09-17 质量体检记录：*「Agent 删一个节点 → 全库实体从内存消失」*。当时采取了**规避**（删掉大纲侧的调用 + 在 `useOutlineTree` 文件头写下「不得调用 `es.loadByType`」的硬约束），但**没有修根**——于是：

- 其它 3 个芽的 8 处调用仍在踩；
- 且该文件的「禁止」是**纪律**而非**机制**，而它自己就在同一个文件里违反了这条纪律（§四）。

---

## 二、决定性取证：调用方**有意**按类型轻量加载

改法有两类：**删掉 API**（调用方改读全量）或 **修副作用**。选哪个取决于「按类型加载」这个意图是否真实存在。

取证结论：**真实存在**。

1. 全仓 **20+ 个视图**在挂载时调用 `es.loadAll()`（全量加载是主流），而 `loadByType` 只出现在 4 个芽 → 这 4 处是**特例**；
2. `CharacterList.vue` 内部同时有 `loadByType('character')`（287/309）与 `relationStore.loadAll()`（321）—— **只加载角色实体、却加载全部关系**。这是刻意的取舍（角色视图不需要别的实体），不是误用。

⇒ 所以「按类型加载」是有效能力，**有问题的只是「顺带清掉别的类型」这个副作用**。据此选择**保留 API 名与全部调用点不变，只修副作用**（改动最小、风险最低、9 处调用点零改动自动受益）。

---

## 三、修正后的语义

```
loadByType(type)：
  · 该类型 → 以磁盘为准**整体替换**（磁盘上已删除的也会从内存移除，即"删除同步"）
  · 其它类型 → **原样保留**
  · 幂等，可重复调用
```

实现（`packages/entity-core/src/stores/entityStore.ts`）：

```ts
const fresh = sanitize(await storage.getEntitiesByType(type))
const kept = entities.value.filter(e => e.type !== type)   // 保留其它类型的内存态
setAll([...kept, ...fresh])
syncIndex()
```

**为什么仍用 `setAll` 而不是增量 push**：需要「删除同步」（磁盘删掉的要从内存移除），逐条 push 做不到；而「保留其它类型 + 该类型整体替换」用一次 `setAll` 最直白。

---

## 四、顺带修掉的自相矛盾（`useOutlineTree.ts:79`）

该文件头写着硬约束②：**「不得调用 `es.loadByType`」**（并把原因写清楚了），而它自己的 `addRootNode` 第 79 行**就在调用**：

```ts
await es.add({ ... })
await es.loadByType('outline_node')   // ← 与同文件约束矛盾；且写操作后本就无需刷新
```

这行是**多余且有害**的：`es.add` 已同步维护内存态。已删除，并把约束②的措辞从「不得调用该 API」改为「写操作后不要顺手刷新」——**因为约束的对象不是那个 API，而是「多此一举的刷新」这个习惯**。

> 附带结论：`addRootNode` 属已下线视图（`OutlineView`）的遗留路径（施工分解 §十三 C 类「待消化」），即这是一行**死代码路径里的定时炸弹**。

---

## 五、同型隐患：`relationStore.loadByEntity`

`relationStore.loadByEntity(entityId)` 是**完全相同的写法**：

```ts
setAll(await storage.getRelationsByEntity(entityId))   // 把"不涉及该实体"的关系全挤掉
```

当前**无调用点**（属预留 API），但同型隐患一并修掉——否则第一个使用者必然踩。已改为「涉及该实体的关系以磁盘为准替换，其它原样保留」。

---

## 六、测试护栏

新增 `packages/entity-core/src/stores/__tests__/entityStore.spec.ts`（**该包此前没有 entityStore 的 spec**），8 条用例钉住新语义：

| 用例 | 钉住什么 |
| --- | --- |
| 加载某类型不挤掉其它类型 | **本 spec 的核心护栏**（三种类型共存后加载其一，三类仍在） |
| 磁盘已删除的会从内存移除 | 删除同步（说明为何必须用 `setAll`） |
| 该类型新增会进来 | 磁盘为准 = 取最新 |
| 幂等 | 连续调用结果一致、不重复 |
| 加载不存在的类型 | 不抛错、不影响其它类型 |
| 无 `loadAll` 前置（store 为空）也能按类型加载 | 允许"只加载一类"的使用方式 |
| `typeCounts` 与 `entities` 一致 | 派生索引不被挤掉 |
| `loadAll` 仍是全量替换 | 不因本次改动而回归 |

**测试环境坑（已记录）**：`fake-indexeddb` 在同一个测试文件内是**共享**的，`beforeEach` 只重建 Pinia **不会清空磁盘** → 上个用例的实体累积到本用例，表现为「期望 1 个却得到 2 个」的**假失败**。故 `beforeEach` 里显式清空实体表。

---

## 七、遗留与原样保留

1. **`IEntityStore`（agent-runtime toolbus 接口）保留 `loadByType` 声明**，并补上语义注释。它是接口抽象、无调用点，删除它需确认 Agent 侧无外部实现依赖——收益低，本轮不动。
2. **「`entities` 可能不完整」是更大的问题**：只要允许按类型加载，就总有代码假设「store 里是全量实体」。本轮**不改变这个现状**（现状亦然），只是让它不再**破坏他人**。若将来要彻底解决，方向是「实体按需加载 + 消费方声明依赖」，属独立议题。
3. **写操作后不需要刷新**这个纪律仍成立（`es.add/update/remove` 都同步维护内存态与索引）——它现在写进了 `useOutlineTree` 的注释里。

---

## 八、验证

- 新增 spec **8/8 通过**；全量 vitest 与 vue-tsc 结果见当次提交记录。
- 影响面复核：改动的是共享包 `entity-core`，消费方为 4 个芽的 9 处调用 + 全部读 `es.entities` 的地方。因语义**只增不减**（不会少数据），故不存在"某处依赖收窄"的回归风险——已逐处核对 9 个调用点，无一依赖"其它类型消失"。

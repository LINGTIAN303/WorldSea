---
status: 执行中
---

# `settings` 插件是否该走服务目录 · 评估

> 评估日期：2026-11-12。承接 [Cordis 化进度与下一步](../details/架构/Cordis化进度与下一步.md) §3.4「唯一剩余项」。
> 结论先行：**不该整插件走服务目录**，但也不该按现状放着——真正的问题不在 `settings`，而在统计口径把「部分文件迁移」记成了「插件已迁移」。

## 一、评估前必须先纠正的两件事

### 1.1 「已迁移 25 个插件」是**按文件登记数**算的，不是插件整体

`lightPluginDataPath.spec.ts` 的 `MIGRATED` 清单登记的是**文件路径**，不是插件。
一个插件只要有一个文件进清单，统计时就可能被算作「已迁移」。实测两种口径差异很大：

| 口径 | 结果 |
|---|---|
| 有文件登记进守卫清单 | **25 个插件** |
| **插件内全部非测试文件都零 store 直连** | **37 个** |

第二种居然更多，原因是：大量**轻档插件本来就不读 store**（`apparel` / `batch-edit` / `conflict` / `doc-export` / `entity-tools` / `faith` / `items` / `regions` / `search` / `templates` / `version-history` 等），它们从没进过守卫清单，但也从不违反它。

**两种口径都不是错的，但混用会产生错误结论**——这正是「除 `settings` 外重档已全部迁移完毕」这句话的来源，而它并不成立。

### 1.2 真实剩余：5 个插件仍有 store 直连

按「插件内全部非测试文件都零直连」的严格口径实测（2026-11-12，main `04c66a4`）：

| 插件 | 直连 store 的非测试文件 | 实际迁移状态 |
|---|---:|---|
| `outline` | **50 处** | 只迁了导出链的字体调用（1 个文件）；主线 22 个文件仍直连 |
| `settings` | **40 处** | 完全未迁 |
| `manuscript` | **22 处** | 只迁了导出链 + 手机预览（2 个文件）；9 个文件仍直连 |
| `tactical-board` | 4 处 | 完全未迁（此前未列入任何批次） |
| `custom` | 2 处 | 视图容器用途，见 §3.2 |

`outline` 一个插件的直连量（50 处）就超过 `settings`（40 处）——而它此前被记为「已迁移」。

## 二、`settings` 插件的实测依赖面

28 个非测试文件，11 个 store，44 处 `useXxxStore()` 调用：

| store | 引用 | 服务现状 |
|---|---:|---|
| `Settings` | 11 | `world.settings`（9 字段，只读） |
| `IconAsset` | 8 | 无 |
| `Plugin` | 6 | `world.views`（部分） |
| `DetailLayout` | 4 | `world.detailLayout`（1 个只读方法） |
| `IconOverride` | 4 | 无 |
| `FieldOrder` | 3 | 无 |
| `Entity` | 2 | `world.entities` |
| `HomeProfile` | 2 | 无 |
| `UI` | 2 | `world.ui` |
| `Font` / `FontLibrary` | 各 1 | `world.font` / `world.fontLibrary` |

若要让它走服务目录，需新增 `iconAsset` / `iconOverride` / `fieldOrder` / `homeProfile` 四项服务，并把 `world.settings` / `world.detailLayout` 从只读扩成读写——这与既定口径直接冲突：

> **`world.detailLayout` 的注释里写着**：「写面（`setTabOverride` / `clearTabOverride`）刻意不给插件——那是设置面的事，插件读了照做即可；给了写面等于允许芽改用户的全局详情偏好。」

`settings` 恰恰就是这个「设置面」。给它写面，等于把当初刻意排除的东西通过服务目录又请回来。

## 三、判定：不整插件迁移，理由三条

### 3.1 它不是「数据消费者」，是「配置编辑器」

已迁移插件（`notebook` / `characters` / `timeline` / `data-tools`…）直连 store 是为了**读写用户内容数据**（实体、关系）。`settings` 读写的对象是**配置本身**：

- `DetailSettingsPanel`：`setCarrier` / `setBackdropOverride` —— 写详情布局的全局偏好
- `IconsPanel`：`setProjectIcon` / `applyToGlobal` / `clearGlobalIcons` —— 写图标映射
- `PluginsPanel`：`toggleSprout` / `syncExternalSprouts` —— 写插件启停状态
- `DetailTabsCard`：`setTabOverride` —— 写 Tab 排序

**服务目录的定位是「统一取数口径」**。把配置编辑器也接进来，得到的是「配置的写入也走服务」——它带来的不是解耦，而是**把配置的写契约钉成公共 API**。`settingsStore` 有 40+ 项（含 API 密钥），`uiStore` 33 项；整包设服务正是 `world.settings` 当初刻意拒绝的做法。

### 3.2 它不是「跨插件共享态的消费者」

`custom` 的 2 处是同类情形且**有意保留**：`custom` 是视图容器，职责就是渲染其他视图的组件（`getViewComp` 拿 `getView(id).component` 交给 `<component :is>`）。组件引用不跨服务边界，故该读取留在芽内——`serviceAccess.ts` 顶部已注明。

`settings` 的 `usePluginStore`（6 处）同理：它**管理插件**（启停/重载/看源码），这是它的功能本体，不是漏迁。

### 3.3 收益与成本倒挂

- 成本：新增 4 项服务 + 扩 2 项服务的写面 + 28 个文件改造 + 契约面扩大（配置写 API 成为公共契约）
- 收益：**取数口径统一**——但这些是配置读取，本来就在一个 store 里、没有跨插件隐式耦合问题

相比之下，`outline`（50 处）/ `manuscript`（22 处）是真正的数据消费者，改造收益明确，却还拖着。

## 四、建议的下一步（按收益排序）

| 序 | 事项 | 理由 |
|---|---|---|
| 1 | **`outline` 主线迁移** | 50 处直连，实打实的数据消费者，收益最大；且此前被误记为「已迁移」 |
| 2 | **`manuscript` 主线迁移** | 22 处，同上 |
| 3 | **`tactical-board`** | 4 处，小；此前未进任何批次 |
| 4 | 纠正统计口径 | 守卫清单按**插件**记迁移状态，或另建一份「插件级」台账，避免再次把部分迁移记成整体完成 |
| — | `settings` | **不迁移**（见 §三）；`custom` 保留（见 §3.2） |

## 五、需要用户拍板的

1. **接受「`settings` 不迁移」这个判定吗？** 若接受，是否要把它写成明确决策（避免以后又被当成「待办缺口」反复提出）？
2. **统计口径怎么改？** 建议守卫测试保留文件级（它管的是「这个文件有没有直连」），但**文档里的进度数字改为插件级**，并注明两类插件的区别（本来就不读 store 的 vs 迁移完成的）。
3. **接下来优先做 `outline` 还是 `manuscript`？** 两者都是重档，`outline` 量更大（50 vs 22）。

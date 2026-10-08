# AutoLink 系统测绘

> 状态：参考基线（2026-10-07 定稿；**① 批走查通过、② 批已落，见 §9 / §10**）｜用途：AutoLink 完善批（[立项](../../plans/2026-10-07-AutoLink成熟度审查与完善立项.md)）实施底稿 + 后续维护参照
> 口径：结论均出自 2026-10-07 HEAD 全仓检索 + 逐件精读；行号为该日快照。

## 0. 一句话定位

AutoLink = **从字段值发现实体间潜在关联 → 建议 → 确认后落成真实关系的被动式关联机制**。设计哲学（文件头自述 `AutoLinkEngine.ts:4-8`）：三层解耦——Trait（数据形状）→ SemanticHint（语义意图）→ 策略引擎（执行逻辑）。

## 1. 服务承诺（四件事）

| # | 能力 | 用户可见形态 | 现状 |
|---|------|--------------|------|
| ① | 关联建议 | 详情页「关联建议」面板（逐条确认 / 忽略 / 全部忽略） | 活 |
| ② | 保存智能链 | 保存实体时自动建关系，并提醒「建议编辑关系属性」 | 断电（设置桥恒 false） |
| ③ | 自动创建实体 | 「将创建〈类型〉实体「名称」并建立关系，确认？」弹窗 | 断电（双桥恒 false） |
| ④ | 字段映射记忆 | 自定义字段的推断预览 + 记住映射（仅时间线表单可达） | 半活 |

## 2. 构成地图

### 2.1 引擎（单文件五件）

`packages/entity-core/src/core/AutoLinkEngine.ts` —— 734 行 = arch 冻结基线（余量 0）；**① 批已减压抽出 `PotentialLinkIndex.ts`（89 行）→ 引擎现 655 行**

| 部件 | 位置 | 说明 |
|------|------|------|
| 潜在链接索引 `potentialLinkIndex` | `PotentialLinkIndex.ts`（① 批抽出） | 内存 Map + bySource 索引；条目含 id / source / target / hint / relationType / direction / confidence / score / resolved / decision |
| 决策 store `autoLinkDecisionStore` | `AutoLinkDecisions.ts`（① 批新增） | localStorage `worldsea_potential_link_decisions`；键 = 源:字段:目标:关系 + 源值/目标值 djb2 指纹；指纹变 → 自清重评 |
| 策略注册表 + 9 条默认策略 | :55-78 / :85-175 | hint→[策略]；9 条 = origin / creator / owner / location / date / appearance / material / birthDate / deathDate |
| SemanticHint 注册表 | :26-49 | hint→usedInTraits 元数据；**全仓无 register 调用、亦无消费（尸体）** |
| 用户映射 store | :183-253 | localStorage `worldsea_user_field_mappings`；key → {hint 或 targetType, relationType} |
| 三层推断 | :261-314 / :487-534 | 用户映射 → key 启发式（9 类语义词 :261-280 + 4 条直接目标 race / faction / weapon / mount :296-301）→ 盲匹配 |
| 三匹配器 + 打分 | :571-733 | matchAndIndex（策略）/ matchAndIndexDirect（显式 autoLink 直配）/ blindMatchAllEntities（盲匹配） |

打分口径：exact=1.0 / 包含=0.8 / bigram 重叠率（:719-733）；阈值 0.5（策略与直配，:598、:643）、0.8（盲匹配，:693）；盲匹配关系固定 `associated_with`。数据源 = storage 单例——正常配置为 FileStorageBackend 全量内存预载，零 IPC（见[刷新开销立项](../../plans/2026-10-04-AutoLink刷新开销立项.md) §五）。

### 2.2 语义标签声明面（活）

- `SemanticHintName` 11 值：`types/trait.ts:10-21`；`TraitField.semanticHint`：同文件 :52。
- 内置 13 原子 Trait 已给字段挂 hint：`core/traits/index.ts`（date / dateEnd :59-60、material / color :73-74、origin / creator :124-125、appearance :138、birthDate / deathDate :155-156、currentOwner :169、location :182）；facet `smith → creator`：`core/facets/index.ts:37`。
- 即：**声明面活着，策略面空**（§4）——准确口径为「声明有、策略空、执行无」。

### 2.3 字段级声明与消费

- `FieldSchema.autoLink`（配置型）：`packages/core-api-types/src/index.ts:190`。
- `FormFieldDef.autoLink`（boolean | 配置型，表单侧）：`plugin-sdk/src/components/types.ts:13`。
- 引擎消费点：trait hint 字段（:419-434）、ownFields 带 autoLink（:441-452）、无声明 ownFields 文本 + 运行时临时字段（:457-480 → 三层推断）。

### 2.4 UI 两面

- **建议面板** `AutoLinkSuggestions.vue`：挂 GEV 详情 `#info` 槽（`GenericEntityView.vue:111-116`，`v-if="entity && !editing"`——编辑态不挂载）；挂载 + properties deep watch 触发刷新（:105-106）。
- **映射 UI** `SmartFieldAdder.vue`（推断预览 :208-238、记住映射 :276）← `DynamicFieldsAdder.vue:45` ← **唯一使用点 `TimelineView.vue:84`**。

### 2.5 写入侧

- 表单保存：`entity/useEntityFormSave.ts:57-68`（收集 `_autoLinkFields`）→ `GenericEntityView.vue:619-643`（`processAutoLinks` + `indexPotentialLinks`）。
- 保存智能链：`useSmartFieldLink.ts`（设置门 :21；processAutoLinks :39-80；判重 checkRelationExists :82-88）。
- 自动创建：`useAutoCreateEntity.ts`（设置门 :20；confirm :40）；消费者三处——useSmartFieldLink :67、`detail/EntityRefControl.vue:111-119`、`EntityRelationSelector.vue:210-224`。
- 标准关系写管线：`useBidirectional.ts:13-64`（inverse 对 / pairId / 撤销事务 / `relation:create` 事件）；关系 store 写入口：`stores/relationStore.ts:40-55`。
- 行内保存触发：`composables/useEntityEdit.ts:87-91`。

### 2.6 桥与设置

- 桥定义：`core/serviceProvider.ts`（noop :63-70；register/get :78-124）——未注册时 settings 恒 false、confirm 恒 false。
- 设置真源：`stores/settingsStore.ts:247-250`（autoCreateEntityEnabled 默认 true + selector / entityRef / graph 三子开关）；设置面板 `ui-kit .../settings/panels/RelationsPanel.vue:6-11`（v-model 直写 store）。
- 装配现状（② 批后）：`apps/tauri/src/shell/autoLinkWiring.ts` 装配 settings / confirm 两桥 + 撤销 provider + 策略注册（`main.ts` initializeBackend 调用）；Validation 桥仍旧（`main.ts:38`）；**EventBus / Toast / Dialog 三桥仍空**（AutoLink 家族未用）。

### 2.7 注册与类型面（引擎的数据前提）

- `registerEntityV2` 双写 V2 + legacy + fieldRegistry（`core/PluginAPI.ts:104-120`）；旧入口 `registerEntityType` 自动归一（同文件 :81-91）。
- 芽内 V2 直注册 21 处：buildings / characters / concepts / combat_stats / conflict / culture / drawing / items / languages / magic / manuscript（book + manuscript 两 schema）/ organizations / notebook / plants / outline（outline_node + outline_board 两 schema）/ inspiration / species / regions / timeline（均在 `apps/tauri/src/world/plugins/*/index.ts`）；tactical-board、orchestration 走旧入口归一；weapons、apparel 无独立实体类型（Item + Facet 视图：`weapons/index.ts:12-19`、`apparel/index.ts:12-19`）。
- 类型面**无 `creature`、无 `race`**——相关映射见 §5-③。

## 3. 运作：四条流水线

**① 被动索引线（活）**：触发三处——详情挂载与属性变化（`AutoLinkSuggestions.vue:105-106`）、行内保存（`useEntityEdit.ts:87-91`）、表单保存（`GenericEntityView.vue:637-643`）→ `indexPotentialLinks` 清旧条目重建，顺序为：trait 带 hint 字段 → 策略（空转）→ ownFields 带 autoLink → 直配 → ownFields 文本与临时字段 → 用户映射 → 启发式 → 盲匹配 → 面板渲染（只显示未 resolved）。

**② 确认线（活，有伤）**：确认 → `storage.putRelation` 直写 → 标记 resolved；无判重、未走 store / 反向对 / 撤销 / 事件（见 §5-①②）。

**③ 保存智能线（断电）**：`_autoLinkFields` → `processAutoLinks`；首道门 `settingsApi.autoCreateEntityEnabled`（空桥恒 false）→ 恒 no-op。

**④ 自动创建线（双断电）**：`promptAndCreate`（设置门恒 false → 恒 null；即便开门，confirm 桥也为 noop）。

## 4. 现状三态表（★）

| 态 | 件 | 证据 |
|----|----|------|
| **活** | 盲匹配（阈值 0.8 → `associated_with`） | `AutoLinkEngine.ts:671-716` |
| **活** | 关键名直接目标映射（race / faction / weapon / mount） | :296-314（目标类型不存在时静默空转） |
| **活** | 用户映射（direct 分支）+ SmartFieldAdder 记录 | :253、:495-499；`SmartFieldAdder.vue:276` |
| **活** | 显式 autoLink 直配（characters race→species / affiliation→organization） | `characters/index.ts:28/:30` |
| **活** | 建议面板 + 确认落盘 | `AutoLinkSuggestions.vue:66-106`（有伤，§5） |
| **休眠** | 策略层：9 条默认策略零注册 → `getByHint` 恒 [] | `AutoLinkEngine.ts:85-175` 全仓零调用 |
| **休眠** | semanticHint 注册表 | :26-49（无注册、无消费） |
| **休眠** | settings 桥 → 保存智能链 / 自动创建三入口 / useHighlight 同根 | `serviceProvider.ts:63-124`；`apps/tauri/src/main.ts:38` |
| **休眠** | confirm 桥 → `deleteWithConfirm` 静默「不删对」、`promptAndCreate` 恒 null | 同上 |
| **休眠** | `refreshLinksForTarget`（目标变更重索引） | `AutoLinkEngine.ts:540-568` 全仓零调用 |
| **幽灵** | selector / entityRef / graph 三子开关：设置面板可勾，零消费者；graph 触发面从未实现 | `settingsStore.ts:248-250` + `RelationsPanel.vue:8-10` |

> **② 批（2026-10-07）已把上表「休眠」各行接线落地**（策略注册 / settings 桥 / confirm 桥 / 撤销上限；`refreshLinksForTarget` 已于 ① 批接线）；「幽灵」行：selector（`EntityRelationSelector`）与 entityRef（`EntityRefControl`）两枚已接门控，**graph 面已撤（③ 批）**——详见 §10 / §11。

## 5. 活路径上的确认异常（**① 批已逐条修复，处置见 §9**）

1. **建议复活 → 重复建关系**：索引每 pass `clearBySource` + 重建，`resolved / decision` 只在内存且随重建丢失 → 忽略的切走再回（「全部忽略」仅当次）；已确认的再现，再点确认以新 UUID 再写一次（建议侧无判重；`useSmartFieldLink.ts:82-88` 有判重可对照）。
2. **确认绕写管线**：关系已落盘（`FileStorageBackend.putRelation :579`）但 `relationStore` 不更新 → 关系 Tab / 面板延迟可见；无反向对（`belongs_to` 在 `relations/index.ts:48` 已声明 `has_member` 反向而建议确认不建）、无撤销记录、无 `relation:create` 事件。
3. **陈旧目标**：`characterConfig.ts:8` `race → 'race'`（无此类型；V2 侧 `characters/index.ts:28` 已是 `species`——表单侧与 schema 侧双源不一致，`CharacterList.vue:6/:133` 仍喂该表单）；`FIELD_KEY_TARGET_MAP` 的 `mount → 'creature'`（无此类型）。
4. **目标改名卡旧值**：`refreshLinksForTarget` 未接线 → 目标实体改名 / 变更不会刷新他方建议的 `targetFieldValue`（直到源实体自身被重索引）。
5. **删除实体不清索引**：`clearBySource` 仅有引擎内部调用（:416），删除链未接（单一挂点为 `entityStore.remove :207`，批量删除已经它 `useBatchDelete :56`）。
6. **relationDirection 未消费** → **③ 批已消费落地**（`PotentialLink.direction`；`target` 策略确认时反向建）。
7. **覆盖面与底座**：建议面板仅在 GEV 系视图（GEV 直用 + SchemaRenderer 系 ≈15 芽）；timeline / tactical-board / outline 等自定义视图无面板；全家族**零测试**；`AutoLinkEngine.ts` 734 行 = 冻结基线（改动前先减压）。

## 6. 设计意图 vs 现实（理解这把「钥匙」）

文件头注释（:4-8）自述：「只实现被动索引与建议确认两种模式，**暂缓自动创建**」。现实恰好倒置——**自动创建**全链已建（三入口、双向、确认弹窗）却被空设置桥断电；**策略引擎**（设计的核心）只有骨架。整体是**分期施工的半成品**：数据层（Trait / hint / autoLink 声明）基本完备、意图层（策略）空经、执行层（匹配 / 索引 / 创建）完整但一半被拔电。这也是「在它完善的前提下测开销」测不出问题的原因——当时走的正是活着的盲匹配路径。

## 7. 边界与接缝（做「完整且独立」时的接口面）

- **两条「字段 → 关系」管线并存**：entityRef（值即 id、精确、保存 diff 可删，`useEntityFormSave.ts:74-111`）vs AutoLink（文本模糊、只增）。
- **两个 autoLink 声明源**：表单侧 `FormFieldDef.autoLink` vs schema 侧 `FieldSchema.autoLink`，互不同步（race 双源即此）。
- 邻接系统：`useBidirectional`（标准写管路）、`deduplicateEdges`（图谱展示层去重，characters RelationGraph / FamilyTree 使用）。

## 8. 附录：全仓触点清单

（按层；「直命中」= 2026-10-07 `auto[-_]?link` / `autoCreateEntity` 检索命中）

- **引擎与运行时（entity-core/core）**：`AutoLinkEngine.ts`（直命中）· `TraitRuntime.ts`（schema 编译）· `traits/index.ts` + `facets/index.ts`（hint 声明）· `PluginAPI.ts`（注册口）· `types/trait.ts`（直命中）。
- **类型声明**：`core-api-types/src/index.ts`（直命中 :190）· `plugin-sdk/src/components/types.ts`（直命中 :13）。
- **组合式（entity-core/composables）**：`useSmartFieldLink.ts`（直命中）· `useAutoCreateEntity.ts`（直命中）· `useBidirectional.ts`。
- **状态与存储**：`stores/relationStore.ts` · `stores/settingsStore.ts`（直命中 :247-250）· `core/FileStorageBackend.ts`（putRelation :579）。
- **桥**：`core/serviceProvider.ts`（直命中）· `apps/tauri/src/main.ts`（:38）。
- **UI（plugin-sdk）**：`AutoLinkSuggestions.vue`（直命中）· `SmartFieldAdder.vue`（直命中）· `DynamicFieldsAdder.vue`（直命中）· `GenericEntityView.vue`（直命中）· `entity/useEntityFormSave.ts`（直命中）· `entity/useFieldPresets.ts`（直命中）· `composables/useEntityEdit.ts`（直命中）· `SchemaRenderer.vue`（直命中）· `EntityFormModal.vue`（直命中）· `detail/EntityRefControl.vue` · `EntityRelationSelector.vue` · `UniversalRelationPanel.vue` · `components/index.ts`（导出面）。
- **设置面板（ui-kit）**：`settings/panels/RelationsPanel.vue`（直命中）。
- **消费方（apps）**：`world/plugins/characters/index.ts` + `characterConfig.ts`（直命中）· `CharacterList.vue` · `timeline/TimelineView.vue`。

## 9. ① 批变更记录（2026-10-07）

- **决策持久化**：`AutoLinkDecisions.ts`（新增）；引擎重建收尾应用决策（`applyPersistedDecisions`）。忽略 / 确认 / 全部忽略均落决策；指纹变化（改名、改值）自动失效重评。
- **确认线归一**：`AutoLinkSuggestions.confirmLink` 判重（type + 双向）→ `useBidirectional.createBidirectional`（成对 / 撤销 / 事件 / store 即时可见）→ 决策落盘。
- **生命周期接线**：`entityStore` 单点三钩子——add → 索引源侧；update → 源侧重索引 + `refreshLinksForTarget`；remove → `clearBySource` + 决策清理；GEV / useEntityEdit 两处散装调用移除。
- **stale 目标**：`characterConfig.ts` race→species；引擎 `FIELD_KEY_TARGET_MAP` 删 mount→creature 条目（挂账：待生物类型立项再加）。
- **减压**：`PotentialLinkIndex.ts` 抽出（引擎 re-export，导出面零变化）；734 → 655 行。
- **测试**：4 spec / 14 例；变异反证五处（详见立项 §三）。
- **仍未动（② 批）**：策略注册（`registerDefaultStrategies`）、设置桥（`registerSettingsApi`）、自定义视图覆盖面、`relationDirection` 消费。

## 10. ② 批变更记录（2026-10-07）

- **装配件**：`apps/tauri/src/shell/autoLinkWiring.ts`（`main.ts` initializeBackend 调用一次，幂等守卫）——策略注册（9 条）/ 设置桥（getter 活读 settingsStore；`SettingsApi` 增补 `autoCreateSelectorEnabled`）/ 确认桥（ui-kit `useConfirm` 全局弹窗适配，宿主 `WsConfirmDialog` 由 Shell 全局挂载）/ `setUndoHistoryProvider`（撤销上限从此生效）。
- **子开关门控**：`EntityRefControl`（entityRef 开关）、`EntityRelationSelector`（selector 开关）——关闭时「+ 创建」入口隐藏；graph 面挂账。
- **激活的效果**：语义标签路径产出建议 + SmartFieldAdder 推断分支复活；保存智能链（自动建关系 + 提醒）与自动建实体弹窗（三入口）随桥生效；删对确认（`useBidirectional`）恢复询问；高亮 dimming 生效（默认开）。
- **顺带清理**：plugin-sdk 既有 typecheck 5 条红（carrier CSS 侧效导入）补 `shims-css.d.ts` 清零；`EntityRelationSelector.vue` 行内判定减压（596 ≤ 597 基线）。
- **测试**：2 spec / 10 例（装配级 8 + 门控 2）；变异四轮（详见立项 §三）。

## 11. ③ 批变更记录（2026-10-07，挂账收尾）

- **撤回「图谱视图中触发」空开关**：GlobalGraph 为纯展示/点选面（无创建交互可挂）——设置面板删行 + `settingsStore` 字段退役；设置面口径「三子开关」→ 两枚。
- **时间线接入**：`TimelineView` `#info` 槽顶部挂 `AutoLinkSuggestions`（编辑态隐藏；同 GEV 序位）。
- **relationDirection 消费**：`PotentialLink.direction`（必填）；策略路径取 `strategy.relationDirection`，直配/盲匹配显式 `'source'`；确认链按方向反向建。
- **守卫教训**：挂载类守卫必须断言**调用形状正则**——首版裸串断言被同文件 `EntityRelationSelector` 的同串旁证满足（假绿，变异轮抓到）。
- **登记**：映射 UI 入口维持现状；graph 面此后若出创建类交互另行立项。
- **覆盖面评估（2026-10-07 续）**：战术棋盘 dock 与大纲 Inspector 均评估为**不接**——棋盘 `WasmBattleUnit` 无实体锚点；大纲节点无自由文本面，且徽章仅认三条 curated 关系类型（引擎产出不会入徽章，需定制映射属独立功能）。另记：大纲「用户侧建实体关联」缺口（现仅 Agent `link_entity`）为独立候选。

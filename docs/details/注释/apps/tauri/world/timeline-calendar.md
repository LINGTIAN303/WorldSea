# 时间线 · 时间体系与双态视图（注释层）

> 代码入口：`apps/tauri/src/world/plugins/timeline/`。本文件讲 **为什么这样组织 / 怎么协作**；单行「这段做什么」留在代码内。
> 计划与施工记录：[时间线芽 · 时间体系与双态交互重构批计划](../../../../../plans/已完成/2026-10-23-时间线芽-时间体系与双态交互重构批计划.md)。

## 1. 一句话口径

日期在数据层是「**单位链取值向量 + 可比较标量**」：持久化只存规范文本，运行时解析成 `TimePoint`，排序 / 缩放 / 冲突 / 拖拽全部只消费 `toScalar()` 的结果。显示文本是格式化的产物，不是计算依据。

## 2. 模块地图

| 层 | 文件 | 职责 |
|---|---|---|
| 历法内核 | `calendar/types` `defaults` `math` `parse` `format` `numeral` `fuzzy` `recurrence` `validate` | 纯函数：单位链 ↔ 标量、解析/格式化、模糊区间、周期展开、校验 |
| 历法存储 | `calendar/store` `migrate` `legacy` `projectExtras` | 项目库 KV + localStorage 回退；旧日期迁移；随项目导出/导入 |
| 数据层 | `composables/useTimelinePoints` | 事件 → 标量区间 / 其他历法 / 未定时间；期段与顶层单位色带 |
| 派生层 | `useTimelineSort` `useTimelineFilters` `useTimelineGroups` `timelineGroups` `useConflictDetection` `useSwimlaneLayout` | 排序、筛选、分组、冲突、泳道行分配 |
| 画布 | `composables/useTimelineScale` `timelineSnap` `useTimelineCanvasDrag` `useTimelineOccurrences` | 标尺与刻度、吸附、指针交互、周期 occurrence |
| 视图 | `TimelineChart`（壳）/ `TimelineCanvas` / `TimelineChronicle` | 两态渲染与控件显隐 |
| 交互接线 | `composables/useTimelineKeyboard` | 快捷键注册/注销、方向键焦点 |

## 3. 关键设计决策

### 3.1 规范文本为真源

不给实体字段系统引入对象类型：`date` / `dateEnd` 存「按所属历法格式化后的文本」，`calendarId` / `dateCertainty` / `recurrence` 是普通属性。解析失败**保留原文**并进入「未定时间」桶，任何视图都不静默丢弃（画布右上角有计数提示）。

### 3.2 标量是唯一可比较量

`calendar/math.ts` 的 `createCalendarRuntime(calendar)` 提供 `toScalar / fromScalar / spanOf / shift / lengthInBase / unitStartScalar / weekday`。
变长月份、命名纪元、闰规则都在换算时按实例求值；**不做常量近似**。`era * 10000 + year` 这类硬编码已退场，并由 `__tests__/timelineGuards.spec.ts` 守卫。

### 3.3 单位链 = 缩放层级

`useTimelineScale` 的 `zoomLevel` 是单位链下标；主刻度取该级边界。两个实测教训：

1. 只按缩放级找边界，会在「视口落在单个纪元内部」时**一条刻度都没有** → 标注层级需向更细单位下探，并按像素间隔抽稀。
2. 顶层单位名不能只靠刻度：`TimelineAxis` 把顶层色带的名称直接画色带左上，切到年/月刻度后仍能读到纪元。

### 3.4 两态共享数据、分开展示

`useTimelineGroups` 产出两套分组：画布剔除其他历法事件（不能上当前轴），编年史保留「其他历法 / 未定时间」尾组。控件按态显隐：排序/紧凑/展开只在竖态，缩放/适配只在横态，分页只在竖态时序表。

### 3.5 多历法一次只激活一套

`useTimelinePoints` 按事件 `calendarId` 找历法；找不到时回落当前历法。`foreign` 的事件不参与当前轴：画布只给计数提示，列表单列尾组。跨历法同轴需要显式锚点，本期明确不做。

### 3.6 模糊日期不混入精确冲突

`calendar/fuzzy.ts` 的 `scalarRange` 负责区间；`useConflictDetection` 给每条冲突打 `fuzzy` 标，精确冲突排前、模糊冲突排后并单独标注。冲突面板是**弹窗**（TuiModal lg）：头部展示检测范围（角色数 / 可比较事件数）与精确/模糊计数，空态说明「只比较角色关联事件」的口径；点击条目或实体 chip 可定位。

### 3.7 期段取最深包含区间

`timelineGroups.periodOf` 只把事件归到最深一层期段；父段没有直属事件时不产生空组。筛选按期段包含关系（父段筛选包含子段内事件）。

## 4. 交互模型（T4）

- **创建**：空白单击 → 单点事件；空白拖拽 → 区间事件。落点按 `labelLevel` 吸附，表单通过 `EntityFormModal` 的 `preset` 预填。
- **移动/拉伸**：仅 `timelineDragEnabled` 开启时；条两端 6px 内为拉伸，其余为移动；点事件只能移动。拖拽中显示吸附日期气泡，拖到左右边缘自动横向滚动，hover 时两端出现拉伸手柄。
- **平移**：Alt / 中键拖拽、时间轴拖拽、缩略图点击/拖拽、`Shift + 滚轮` 横向平移；普通左键空白拖拽已被创建占用。
- **未上轴清单**：轴右上角「N 个事件时间无法解析 / N 个其他历法事件」是可点击角标，弹窗逐条列出并可直接选中修正。
- **批量**：批量态空白拖拽 = 框选；事件条点击 = 切换选中。
- **键盘**：方向键移动 DOM 焦点（元素自带 Enter 打开），`+/-` 缩放，`Home` 适配，Esc 关闭详情/退出批量。
- **筛选反馈**：筛选条显示「显示 N · 已隐藏 M」并提供「清除筛选」，避免筛掉事件后无从察觉。
- **撤销**：拖拽写回走 `entityStore.update`，天然进撤销栈。

## 5. 持久化与项目迁移

项目库 `project_settings` 键：`timeline_calendar_index` / `timeline_calendar_<id>` / `timeline_active_calendar` / `timeline_migrated_v1`；localStorage 同键名兜底。

随项目迁移通过 `calendar/projectExtras.ts` 注册两个扩展点（核心只搬运，不认识历法结构）：

- `ProjectExtraProvider` → 目录导出/导入写出 `settings/timeline.json`；
- `PackSerializer`（`id: 'timeline'`）→ WorldSeaPack 增加 `timeline` 分区。

导入策略：`merge` 只补缺失 id，`overwrite` 覆盖同 id；激活 id 仅在目标历法存在时写回。切项目时画布回到「适配全部」，避免停在旧项目的缩放位置。

## 6. 踩坑与约束

- **properties 整体替换**：表单/拖拽保存必须合并旧属性，否则 `era` 等历史字段会被抹掉。
- **拖拽后的 click**：拖拽结束会补发 click，必须吞掉，否则误开详情（`clickSuppressed`）。
- **周期 occurrence 是派生标记**：不落库、不可拖拽；点击打开基础事件。
- **只读枚举必须映射 options 标签**：`FieldControl` 只读态直接把内部值（如 `exact`）抛出来会是原始枚举；`optionDisplayText` 统一映射，空值显示「—」。
- **周期规则只读走摘要**：详情不展示 JSON 原文，`formatRecurrenceSummary` 输出「每 2 年，至 …」。
- **泳道宽度**：标尺与缩略图必须扣除 160px 泳道栏，否则与泳道内容错位。
- **滚轮**：普通滚轮归还纵向滚动，只有 Ctrl/⌘ + 滚轮才缩放。
- **尺寸基线**：`TimelineView` / `TimelineChart` 曾冻结；新逻辑一律外移，新文件 ≤ 400 行。

## 7. 守卫与测试

- `calendar/__tests__/calendar.spec.ts`：内核往返、闰、命名纪元、周期、迁移、持久化与导入快照。
- `composables/__tests__/timelineViews.spec.ts`：解析/foreign/未定时间、分组、筛选、冲突、标尺层级、吸附往返、排序。
- `__tests__/timelineGuards.spec.ts`：禁止硬编码纪元数学与直读 `properties.era`（迁移层豁免）；「拖拽改时间」必须有消费方；导出/导入两条链接线不得掉。

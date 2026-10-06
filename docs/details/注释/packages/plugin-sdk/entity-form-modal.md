# EntityFormModal 组件拆分说明（plugin-sdk）

> 2026-08-06 重构：`packages/plugin-sdk/src/components/EntityFormModal.vue` 的 `<script setup>` 由混杂五类逻辑（实体引用搜索 / 动态表单 / 字段与预设 / 自动链接 / 保存）拆为「模板 + 编排 + 4 个 composable」。
> 纯结构性重构：UI 渲染、事件流、props/emits 签名、业务行为均不变。

## 组件职责（EntityFormModal.vue）

- **模板**：128 行，未改动。
- **编排**：按序调用 4 个 composable 并串联状态；`watch(() => props.modelValue)` 打开弹窗时执行 `initFormData()` + 恢复 `activePreset`；`close()` 清空错误并 emit；`defineExpose({ syncEntityRefAfterCreate })`。
- **Smart Fill（智能填充）：2026-09-27 E6 已整体退场**——✨ 建议 / ghost 续写 / 空字段提示 / 焦点触发 / 预览面板 / 底栏「AI 智能填充」及其事件桥一并删除（旧 Agent 面残留）；`useDynamicForm` 不再有 ghost 依赖注入。（原注：本逻辑曾保留在组件、未拆出；其 10 个基础 ref 的声明位置提前以配合 `useDynamicForm.onFieldInput`。）

## Composables 职责边界与依赖

### 1. useFieldPresets.ts（src/components/entity/useFieldPresets.ts）

字段与预设：
- `SYSTEM_KEYS` + `fieldRegistry` 合并生成 `sortedFields`（`void fieldRegistry.version.value` 保持 registry 版本响应式追踪；
  2026-10-05 起 `SYSTEM_KEYS` 纳入 `title`——V2 trait 方言中 identifiable 的 title 即实体名，
  翻译真源与抽屉侧 `detail/fieldAccessor.TOP_LEVEL_FIELD` 同源，旧 schema 自带 name 字段的芽不受影响）
- **`MODAL_EXCLUDED_KEYS = {coverImage}`**（2026-10-05）：封面图升级为详情「封面」Tab
  （`components/EntityCoverPanel.vue` 即时持久化顶层字段），弹窗不再渲染、不落 properties；
  save 的 `_coverPosition/_coverZoom` 管线保留（值来自实体顶层回填，往返无害）
- `resolvedEntityType`、`activePreset`、`presetOptions`、`isFullWidth`
- 拖拽排序（`onDragStart/onDragOver/onDragLeave/onDrop` → `fieldRegistry.setOrder`）
- 预设**只留切换**：`watch(activePreset)` → `fieldOrderStore.loadPreset`（2026-10-03 起，
  增删改搬到设置「实体详情」Tab 的「命名预设」卡；同一份数据不留两个 CRUD 面）
- 添加/删除字段（`confirmAddField/cancelAddField/removeField`）

依赖注入：`fields/entityType/entity` 用 getter 闭包（保持 props 响应式）；`fieldOrderStore` 实例由组件传入（`dialog` 随预设 CRUD 一起摘掉）。

**关键设计——惰性 getFormData**：`confirmAddField`/`removeField` 需要写 `formData`，而 `useDynamicForm`（产出 `formData`）依赖 `sortedFields`（本 composable 产出），存在调用环。解法：调用顺序 presets → form，`formData` 通过 `getFormData: () => form.formData` 闭包**延迟求值**（仅在用户点击时执行，此时 `form` 已初始化），运行时无 TDZ 问题。

### 2. useDynamicForm.ts（src/components/entity/useDynamicForm.ts）

动态表单：
- `formData` / `nameError` / `prevFieldValues`
- `initFormData()`：从 `props.entity` 回填 name/title（V2 方言：两者都读实体顶层 `name`，绝不读 `properties.title` 死值）/description/tags/properties + `_coverPosition`/`_coverZoom`
- `onFieldInput()`：name/title 字段发 `name:input` 事件总线消息；Smart Fill 字段发 ghost 接续预览请求（500ms 防抖，`_ghostDebounceTimer` 为 composable 闭包内私有变量，每实例独立）
- 深度 watch `formData`：textarea/richtext 字段按增量发 `text:input` 事件总线消息

依赖注入：`entity` getter、`sortedFields`、`resolvedEntityType`、`isSmartFillField` 函数、`ghostVisible` ref（后两者来自组件的 Smart Fill 基础状态）。

### 3. useEntityRefSearch.ts（src/components/entity/useEntityRefSearch.ts）

实体引用搜索：`activeEntityRef` / `entityRefResults` / `openEntityRef` / `onEntityRefSearch` / `searchEntityRef` / `selectEntityRef`。
依赖：`formData` ref（读/写字段值）、`entityStore` 实例；`entitySchemaRegistry` 模块内 import。

### 4. useEntityFormSave.ts（src/components/entity/useEntityFormSave.ts）

保存：
- `save()`：name/title 必填校验（name 优先 title 兜底，写 `nameError`；2026-10-05 起修复 V2 芽无 name 字段导致的「空名静默失败」）→ 收集 properties（排除 name/title/description/tags）→ tags 逗号解析 → entityRef 字段收集 → 调用 `syncEntityRefRelations` → autoLink 字段收集 → 封面参数 → `emit('save', ...)`
- `syncEntityRefRelations()`：按 entityRef 字段的 relationType 比对目标实体，增删关系（幂等：已有关系跳过，目标消失则删除）
- `syncEntityRefAfterCreate()`：创建后补同步关系（组件 `defineExpose` 暴露给外部调用）

**设计决策——autoLink 逻辑合并于此**：任务建议独立 `useAutoLink.ts`，但组件内 autoLink 相关逻辑仅 `save()` 中一行过滤 `sortedFields.filter(f => f.autoLink)`（无独立状态），单独建文件属过度拆分，故并入本 composable（文件头注释已说明）。

## 依赖关系总览

```
useFieldPresets ──(getFormData 惰性)──┐
useDynamicForm  ──(formData 注入)─────┤
useEntityRefSearch ──(formData)────────┤── EntityFormModal 编排
useEntityFormSave ──(formData/nameError/sortedFields/entity/emit)
```

所有跨 composable 状态均通过参数/返回值显式传递，无共享可变全局状态（`fieldRegistry`/`entityStore` 等为既有模块级单例，行为与拆分前一致）。

# 模型选择器改造 + 右栏调整 · 实施计划

> 计划日期：2026-08-29 · 状态：已完成（2026-08-29 浏览器走查通过）
> 涉及：输入栏模型选择器（ModelSwitcher）｜右栏（AgentSpace 右侧面板）
> 前提决策（用户已拍板）：① 执行 tab 宫格 = 宫格首页 + 加号新增式多面板；② AutoModel 本次只保留入口 UI（自动选型逻辑放下）；③ 思考档位数据按矩阵文档修正 3 处不一致。

---

## 一、背景与范围

延续 Agent 空间走查后的视觉/交互收尾。本计划聚焦两处 UI：

1. **输入栏模型选择器**（[ModelSwitcher.vue](file:///d:/本地化AI/DeepSeek_Home/worldsmith/apps/tauri/src/space/chat/ModelSwitcher.vue)）：下拉高度、分组标题、入口胶囊、供应商 Logo、思考档位悬停浮窗、AutoModel 入口图标。
2. **右栏**（[AgentSpace.vue](file:///d:/本地化AI/DeepSeek_Home/worldsmith/apps/tauri/src/space/AgentSpace.vue) + [ExecPanel.vue](file:///d:/本地化AI/DeepSeek_Home/worldsmith/apps/tauri/src/space/panels/ExecPanel.vue)）：执行 tab 11 区改宫格、配置 tab 档案占位、创作 tab 图标 + 视图切换改浮窗菜单。

数据修正涉及 [model-registry.ts](file:///d:/本地化AI/DeepSeek_Home/worldsmith/packages/agent-runtime/src/providers/model-registry.ts) 的 `thinkingModes` 三处（用户已确认）。

---

## 二、任务一：模型选择器改造（ModelSwitcher.vue）

### ① 下拉面板高度降低至原 60%
- 现状：`.model-dropdown { max-height: 70vh }`（ModelSwitcher.vue L430）。
- 改：`max-height: 42vh`（= 70vh × 0.6）。保留 `overflow-y: auto`。

### ② 列表去掉供应商分组标题，仅保留模型（仍按供应商排列）
- 现状：`.model-group-label` 渲染 `{{ group.group }}`（L53）。
- 改：删除分组标题渲染，保留 `v-for` 分组结构（模型仍按供应商顺序排列），可加更克制的分隔（如组间 `margin-top` 4px 细分隔线）替代标题。保留 `aria-label` 中的供应商信息（无障碍不丢）。
- 关联：`dropdownGroups` 结构不变，仅改模板 + 样式。

### ③ 选择器入口 UI 去掉胶囊
- 现状：`.model-pill` 有 `border-radius: var(--radius-3xl)` + `border: 1px solid` + 背景（胶囊形态，L369-383）。
- 改：去掉胶囊形态 → 扁平化入口：无边框、透明背景、圆角 `radius-sm`、hover 时浅色背景 + 主色字。仅保留「供应商 Logo + 模型名 + chevron」。
- 说明：这是「呈现层」改动（配色/圆角），不改操作路径，按用户规则可自主执行。

### ④ 模型条目右侧思考档位（本次实现，按模型自身档位）
- 现状：`getThinkingLevels(modelId)`（model-registry.ts L259）已按 `thinkingModes` 返回每模型档位；`updateThinkingLevel` 已存在于 useAgentRust（L2173）；`thinkingLevel` ref 已由 `useAgent()` 暴露（L2413）。
- 实现（在悬停浮窗内，见 ⑥）：
  - 浮窗列出 `getThinkingLevels(m.id)` 各档位（关闭/极简/低/中/高/极高…），当前生效档位高亮（`thinkingLevel.value`）。
  - 点击档位 → `updateThinkingLevel(level)` + 写 `localStorage('agent_thinking_level')`。
  - 若悬停的是非当前模型：点击档位 = 切换该模型 + 应用该档位（`selectModel` 后接 `updateThinkingLevel`）。
  - 切换模型后校验：新模型 `getThinkingLevels` 不含当前档位时，重置为 `'off'` 并同步（对齐 SpaceAgentSettingsPanel L223-227 既有逻辑）。

### ⑤ 模型名左侧加供应商 Logo 图标
- 现状：`getProviderIconUrl(provider)` 已 import（ModelSwitcher L98），providerIcons.ts 已有全量本地 SVG。
- 实现：模型条目（`.model-option-name` 左侧）加 `<img :src="getProviderIconUrl(m.provider)" class="model-option-icon" />`（16×16，object-fit: contain）。保留左侧状态位（check）在前，Logo 紧随模型名前。

### ⑥ 思考档位入口 UI 移除，改为鼠标悬停弹出浮窗
- 现状：每条目右侧 `.think-btn`（brain 图标，点击弹浮窗，L69/L536），浮窗为静态占位（L76-86）。
- 改：
  - 删除 `.think-btn` 按钮（入口 UI 移除）。
  - 模型条目右侧保留一个极克制的思考档位指示（如当前档位简写或「思考」小字），悬停该指示区（或整行右侧）弹出浮窗。
  - 浮窗 Teleport 到 body、定位跟随条目右侧；列出该模型 `getThinkingLevels` 档位（可点击选择，见 ④）；非当前模型时显示该模型档位（信息 + 可直接点选）。
  - 交互：`@mouseenter` 打开 / `@mouseleave`（含浮窗自身）关闭，浮窗与触发区之间无间隙防抖；保留 Escape / 外部点击关闭。
  - 删除原 `think-overlay` 静态骨架，复用下拉的 Transition。

### ⑦ AutoModel 条目：本次只做入口 UI（自动选型逻辑放下）
- 用户决策：自动选型逻辑「先放下」。
- 本次仅：AutoModel 条目（下拉内已有，L42-51）左侧加 **WorldSmith 品牌 Logo** 作图标（复用 `WorldSmithLogo` 组件，tone=auto 自适应主题，size=16）。
- 保留现有「自动」tag + 选中态标记；`selectAutoModel` 维持占位（不真正切换）。已在代码标注 TODO 留待下轮。
- 位置：WorldSmithLogo 组件 [WorldSmithLogo.vue](file:///d:/本地化AI/DeepSeek_Home/worldsmith/apps/tauri/src/components/brand/WorldSmithLogo.vue)（源图 `src-tauri/icons/WorldSmith.svg`，442KB base64 内嵌，组件按主题切换黑白形）。

---

## 三、任务二：右栏调整

### ① 执行 tab：11 区改为四列宫格 + 加号新增式多面板
- **交互模式（用户拍板）**：宫格首页 + 加号菜单；点加号是**新增**不是切换；已打开的区从加号菜单中消失。
- 现状：
  - `ExecPanel.vue` 顶部 11 个 `exec-tab` 按钮（L4-81），`tab` 由会话级 `execTab` 驱动（AgentSpace L207）。
  - `ExecTab` 类型 11 个值（space-store.ts L16）。
- 改：
  - **栏**：执行 tab 顶部栏仅保留一个「+」按钮（去掉 11 个 tab 按钮）。
  - **宫格首页**：无任何区打开时，右栏内容区中心显示 11 区四列宫格（图标 + 名称），点选 = 打开该区（追加）。
  - **加号菜单**：点「+」弹出浮窗菜单（同四列宫格样式），列出「未打开」的区；点击追加打开。已打开的区不再出现。
  - **多面板展示**：已打开区以「卡片堆叠」形式在内容区纵向排列（每卡片含标题栏：图标 + 名称 + 关闭 × + 内容区）。关闭某卡片即从列表移除；全关回到宫格首页。
  - **数据**：新增 `openExecSections: ExecTab[]` 状态。放 ExecPanel 内部（ref）还是会话级（useSessionViewState）？→ 建议**会话级**（对齐现有 `execTab` 按会话隔离的约定），在 useSessionViewState 增加 `openExecSections` + `addExecSection/removeExecSection`。
  - **终端/子Agent/工作区**等原有「撑满面板」样式适配卡片容器。
  - **兼容**：AgentSpace 现有 `execTab` watch（生成任务→activity、有 plan→plan）需改为往 `openExecSections` 追加对应区。
- 关联组件：
  - `ExecPanel.vue`（模板重构：删 tab 按钮、加宫格首页 + 卡片堆叠 + 加号菜单）
  - `space-store.ts` / `useSessionViewState.ts`（openExecSections 状态）
  - `AgentSpace.vue`（L79 传参、L284-300 watch 调整）

### ② 配置 tab 增加「档案」占位
- 现状：配置 tab 子切换「记忆 / 人格」（AgentSpace L80-84，`ConfigSubTab` 两值）。
- 改：`ConfigSubTab` 增加 `'profile'`；子切换栏加「档案」按钮（点击后内容区渲染占位文案「档案（占位，待实现）」）；持久化沿用 `spaceStore.configSubTab`。
- 明确：**不做功能**，仅占位。

### ③ 创作 tab 图标修复 + 视图切换弹窗改浮窗菜单
- **图标缺失根因**：AgentSpace `PANEL_META` 创作 tab 用 `icon: 'layout'`，而 WsIcon 图标集**不存在** `layout`（只有 `cat-layout` / `dashboard`），渲染为空 → 图标缺失。
- 改：`PANEL_META` 创作 tab `icon` 改 `'palette'`（图标集已有，action.ts L22）或 `'brush'`。
- **视图切换弹窗改浮窗菜单**：CreationPanel.vue 当前 `picker-overlay` 居中 Dialog（L26-42），改为锚定「切换视图」按钮的浮窗菜单（沿用 AgentSpace `add-menu` 浮窗样式 + Teleport + Transition + 外部点击/Escape 关闭）。保留图标 + 名称列表，空状态「暂无可用创作视图」保留。

---

## 四、数据修正：思考档位（model-registry.ts，用户已确认按矩阵文档修正）

| 模型 | 矩阵文档依据 | 注册表现状 | 改为 |
|------|-------------|-----------|------|
| glm-5.3 | 思考**强制开启**（low/high/max，不可关闭） | `['off','low','medium','high']` | `['low','high','max']` |
| qwen3.8-max | 思考默认 xhigh（low/high/xhigh） | `['off','low','medium','high']` | `['low','high','xhigh']` |
| hy3 | 支持思考（low/high，默认常规） | `supportsThinking: false` | `supportsThinking: true` + `thinkingModes: ['off','low','high']` |

**配套（支持 'max' 档）**：
- TS `ThinkingLevel` 类型（bridge-types.ts L269）加 `'max'`。
- `getThinkingLevels`（model-registry.ts L262-269）levels 数组加 `{ value:'max', label:'最大', desc:'全力思考' }`（xhigh 已有，max 为新增顶档）。
- Rust `ThinkingLevel` 枚举（agent-kernel/backend.rs L188）加 `Max` 变体（serde lowercase → `"max"`）。
- Rust `thinking_level_to_str`（agent-commands/mock_backend.rs L83-90）加 `ThinkingLevel::Max => "max"`。
- 前端 `useAgentRust` import 的 `ThinkingLevel` 类型（来自 agent-runtime re-export）自动同步。

> 说明：其余模型（DeepSeek flash/pro 含 max、doubao-seed-evolving 含 xhigh+max 等）注册表现有 thinkingModes 与矩阵文档一致，本次不动。

---

## 五、风险点（需用户知晓，不自动处理）

1. **思考档位粒度未传导到模型请求（既有缺口，非本次引入）**：Rust [genai_backend.rs](file:///d:/本地化AI/DeepSeek_Home/worldsmith/crates/agent-kernel/src/llm/genai_backend.rs) L277-279 目前仅 `thinking_mode == true` → 固定 `ReasoningEffort::Medium`；`thinking_level` 只存 config/state 未映射到 reasoning_effort。**本次实现的是选择器 UI + 存储链路**，档位暂不真正影响模型请求强度。若要让档位生效（如 low→Low、max→XMax），需另开后端任务（genai_backend 按 level 映射 + 各供应商 reasoning_effort 语义核对）。
2. **多面板堆叠的宽度/高度适配**：终端/子Agent/工作区面板原本「撑满面板」，改卡片堆叠后需给卡片设合理高度（如每卡片 `max-height: 45%` 内部滚动），避免 11 区全开时过度挤压。此为落地质量细节，执行时按实测量调。
3. **'max' 档位下游兼容**：若个别供应商请求层遇到未知 reasoning_effort 值，可能被忽略或报错——需验证 DeepSeek/GLM 对 `max` 的接受度（矩阵文档已列 max 为其档位，风险低）。

---

## 六、验证清单（交付前自检）

- [x] ① 下拉高度 ≈ 42vh（实测 301px @ ~717px 视口，视觉验证）
- [x] ② 列表无分组标题，模型仍按供应商顺序；aria-label 保留供应商信息（DOM 实测 groupLabels=0）
- [x] ③ 入口无胶囊形态（实测 border-radius=0/透明/无边框）
- [x] ④⑤⑥ 悬停条目弹出该模型档位浮窗（DeepSeek V4 Flash 关闭/低/中/高/最大）；Logo 全条目显示；选档写 localStorage + `update_thinking_level`；当前档位高亮
- [x] ⑦ AutoModel 条目左侧 WorldSmith Logo；点选仍为占位不切换
- [x] 右栏 ① 执行 tab：宫格首页 11 区四列；点选追加卡片；「+」菜单 10 项不含已开区；关闭卡片回首页；生成任务/有 plan 自动打开已接入（addExecSection）
- [x] 右栏 ② 配置 tab 档案占位可点、内容为占位文案、状态持久
- [x] 右栏 ③ 创作 tab 图标可见（palette）；切换视图为锚定浮窗菜单（Escape/外点关闭）
- [x] 回归：模型切换 / 发送消息 / 思考档位原设置面板不受影响（typecheck + cargo check 通过）
- [x] TypeScript 编译无错；Rust `cargo check` 通过

**走查备注（2026-08-29）**：
- `max` 档位在前端链路正确（selectThinkLevel → update_thinking_level 'max'），但当前运行中的 HTTP 桥（8787）为旧二进制（无 `Max` 枚举变体），会拒绝 `max` → 档位不落库；`high` 等旧档正常。Rust 代码已加 `Max` 且 cargo check 通过，**重启桥后 `max` 生效**。

---

## 七、执行顺序建议

1. 数据修正（thinkingModes + ThinkingLevel 类型 + Rust 枚举）→ 一次性完成，后续 UI 依赖其正确性。
2. ModelSwitcher 改造（①→⑦ 顺序）。
3. 右栏调整（① 宫格 → ② 档案 → ③ 创作）。
4. 编译 + 浏览器验证（vite 5175 / 桥 8787）。

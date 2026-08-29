# Agent 设置面板整合计划

> status: 已完成
>
> 创建于 2026-08-23，执行完成于同日。目标：把主设置中 Agent 配置面板重构成
> 「一级平铺 + 二级弹窗 + 三级平移」交互，迁移用量、工具，补齐 Skills/MCP 分类栏，
> 开启权限分级。全部里程碑（A/B/C/D/E + CONTRACT）已交付，前端 typecheck 与后端 cargo check 通过。

## 相关文件（现状锚点）

- 主设置入口：`apps/tauri/src/ui/settings/SettingsDialog.vue`（Tab 栏 + 左列 rail）
- 内嵌封装：`apps/tauri/src/space/panels/SpaceAgentSettingsPanel.vue`
- Agent 面板主体：`apps/tauri/src/agent/AgentSettingsPanel.vue`
- 模型子面板：`apps/tauri/src/agent/panels/ModelPanel.vue`、`ProviderPanel.vue`
- Agent 右栏：`apps/tauri/src/space/AgentSpace.vue`、`apps/tauri/src/space/stores/space-store.ts`（PANEL_META / rightTab）
- 主对话输入栏：`apps/tauri/src/space/chat/ChatInput.vue`（工具栏 `input-toolbar`）
- 后端安全级别：`crates/agent-commands/src/lib.rs`（SecurityLevel: Off/DangerousOnly/ModerateAndDangerous）、`crates/agent-runtime/src/confirmation.rs`（Safe/Moderate/Dangerous）
- 后端模型配置：`RuntimeProviderConfig`（temperature/max_tokens/context；**TopP/TopK/思考模式未贯穿**）

---

## 里程碑 A — 模型卡片重构（最高优先，独立验证）

### T-A1: 模型卡片收缩为「供应商类型 + 可用模型」平铺
- **goal**: 模型卡片仅保留三类型平铺 + 可用模型分类（全模态/文本/图像/视频/语音），去掉原所有参数行；点击类型或模型进入二级弹窗。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`（embedded 模型卡片区）、`apps/tauri/src/agent/panels/ModelPanel.vue`
- **acceptance**: 模型卡片只显示"供应商类型(云API/本地/自定义) + 可用模型(带分类栏)"；不渲染温度/输出/上下文/人格预设；两类入口均能打开二级弹窗。
- **spec**: 见用户任务描述 一（原第3点）

### T-A2: 二级弹窗——云端 API 面板（供应商列表 + 分类：官方API/聚合Plan/应用API）
- **goal**: 二级弹窗内罗列供应商并带分类栏；点击供应商平移出三级面板。
- **files**: 新增 `apps/tauri/src/agent/panels/CloudApiPanel.vue`（二级）、`AgentSettingsPanel.vue`
- **acceptance**: 供应商按 官方API/聚合Plan/应用API 三类展示；点击任一供应商触发三级面板。

### T-A3: 三级弹窗——云端供应商配置
- **goal**: 三级面板含 配置方式/模型/API Key/会话窗口（上下文长度、输出、温度、Top P、Top K、是否输入图片）；保存后测试连接。
- **files**: 新增 `apps/tauri/src/agent/panels/CloudProviderDetail.vue`、相关 store 扩展
- **acceptance**: 表单字段齐全且可填写；保存触发测试连接并反馈结果；字段落 local 持久化。
- **spec**: 会话窗口参数含 TopP/TopK/图片输入 —— 见下"跨栈参数契约"约束

### T-A4: 二级弹窗——本地模型面板（增加模型 → 三级）
- **goal**: 本地面板有"增加模型"入口；点击平移出三级（Base URL、API 类型、模型名称、模型 ID、模型类型、会话窗口+思考模式）；添加后测试连接，连通留驻二级并下移一行。
- **files**: 新增 `apps/tauri/src/agent/panels/LocalModelPanel.vue`（二级）与 `LocalModelDetail.vue`（三级）
- **acceptance**: 三级表单字段齐全；连通后本地模型列表新增一行、增加按钮下移；保存持久化。

### T-A5: 二级弹窗——第三方自定义面板
- **goal**: 与本地相似，但含 API Key；增加供应商模型后连通下移一行；三级含 API 格式、Base URL、模型名称、模型 ID、模型类型、API Key、会话窗口+思考模式。
- **files**: 新增 `apps/tauri/src/agent/panels/CustomProviderPanel.vue`（二级）与 `CustomProviderDetail.vue`（三级）
- **acceptance**: 表单齐全；连通后供应商列表下移一行；保存持久化。

### T-A6: 移除 AI 人格预设
- **goal**: 删除云 API 三级与主卡片的"AI 人格预设"项。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`、`apps/tauri/src/agent/panels/ModelPanel.vue`
- **acceptance**: UI 无"人格预设"；相关持久化字段不再写入。

---

## 里程碑 B — 用量迁移

### T-B1: 用量迁入 Agent 右栏面板
- **goal**: 把 `UsagePanel` 放入 Agent 空间右栏（`AgentSpace.vue` 右面板之一，如配置子页或新增 tab），数据绑定保持不变。
- **files**: `apps/tauri/src/space/AgentSpace.vue`、`apps/tauri/src/space/stores/space-store.ts`、`apps/tauri/src/agent/panels/UsagePanel.vue`
- **acceptance**: 右栏可见并展示用量/成本/缓存；数据来源仍为 `totalUsage` 等 props。
- **spec**: 用户任务 二（移入 Agent 空间右栏面板内）

### T-B2: 主设置移除用量卡片
- **goal**: 从 `AgentSettingsPanel.vue` 删除用量卡片及其子面板渲染。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`
- **acceptance**: 主设置模型卡片区不再有"用量"卡片。

---

## 里程碑 C — 能力与工具迁移

### T-C1: 搜索/视觉分析/图像生成/视频生成为工具并入 Skills
- **goal**: 把这四项作为工具（skill）纳入 Skills 体系与渲染，带开关。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`、Skills 相关（`SkillsStorePanel.vue`、skills-registry）
- **acceptance**: 四项工具出现在 Skills 中且可启停；视觉/图像/视频对应现有 VisionPanel 能力。
- **spec**: 用户任务 三-1（作为工具移入 Skills，已确认归 Skills）

### T-C2: 终端移除
- **goal**: 删除终端面板入口与渲染。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`、`apps/tauri/src/agent/panels/TerminalPanel.vue`
- **acceptance**: 无终端入口/渲染；相关事件订阅移除。

### T-C3: 移除"能力与工具"卡片
- **goal**: 删整张卡片。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`
- **acceptance**: 主设置无"能力与工具"卡片。

---

## 里程碑 D — 分类栏

### T-D1: Skills 增加分类栏
- **goal**: Skills 卡片顶部加分类栏（按技能类别分组展示）。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`、skills 数据源
- **acceptance**: 分类栏出现且按类分组 Skills 列表。

### T-D2: MCP 增加分类栏
- **goal**: MCP 卡片顶部加分类栏（按 server 类别/状态分组）。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`、`McpPanel.vue`
- **acceptance**: 分类栏出现且按类分组 MCP 列表。

---

## 里程碑 E — 边界与个性

### T-E1: 危险操作改为权限分级选择器并移入主对话输入栏
- **goal**: 在主对话输入栏（`ChatInput.vue` 工具栏）加入权限分级选择器（off / dangerous_only / moderate_and_dangerous），对接现有 `setSecurityLevel`。
- **files**: `apps/tauri/src/space/chat/ChatInput.vue`、`apps/tauri/src/agent/AgentSettingsPanel.vue`、settings store
- **acceptance**: 输入栏出现权限分级选择器，切换后调用后端安全级别接口并生效。
- **spec**: 用户任务 六-1（已确认移入主对话输入栏）

### T-E2: 移除思考级别
- **goal**: 删除边缘与个性卡片的"思考级别"及"边界与个性"卡片清理。
- **files**: `apps/tauri/src/agent/AgentSettingsPanel.vue`
- **acceptance**: 无思考级别 UI。

---

## 里程碑 F — 整体审计与回归

### T-F1: 全链路回归 + 7 点检查 + 文档/索引同步
- **goal**: 验证主设置各 Agent 卡片、右栏用量、输入栏权限分级正常；同步 `docs/`（图表/注释）与文档索引，避免读到过期摘要。
- **files**: 涉及全部改动文件、`docs/index/`、相关 `docs/details/注释/*`
- **acceptance**: typecheck（`pnpm -C apps/tauri typecheck`）+ cargo check 通过；浏览器/桌面端手工过一遍交互主路径无断裂；索引条目更新。
- **spec**: 全局交付质量规范

---

## 跨栈参数契约约束（里程碑 A 依赖，已确认真实传导）

> **决策（2026-08-23）**：Top P / Top K / 思考模式**真实传导到模型调用**，扩展后端完整链路。

- 会话窗口新增：`Top P`、`Top K`、是否输入图片、思考模式。
- **完整传导链路（待新增字段处理点）**：
  - `crates/agent-runtime/src/llm/config.rs` → `ProviderConfig` enum：在 `Cloud`/`Custom` 等变体补 `top_p`、`top_k`、`thinking`（Option），serde default。
  - `crates/agent-runtime/src/llm/genai_backend.rs` → `build_chat_request`（L210）：据 options 追加 top_p/top_k（`with_top_p`/对应项）与思考模式（结合 `manifest.rs` 的 `thinking_detector`/`ThinkingFormat`）。
  - `crates/agent-runtime/src/llm/manifest.rs`：已有 per-provider thinking 检测，可复用作为"思考模式"开关依据。
  - `crates/agent-commands/src/lib.rs` → `set_provider_config`（L1900）接受完整 `RuntimeProviderConfig`（含新字段）。
  - `apps/tauri/src-tauri/src/commands.rs` + `http_bridge/rpc.rs`：命令入参透传新字段。
  - 前端：settings store / 类型定义（TypeScript）与三级弹窗表单绑定。
- **"是否输入图片"**：本质是模型能力（supportsVision / manifest 视觉标记），上传开关与 `supportsVision` 联动，作为模型预设落前端。
- **"思考模式" vs 既有"思考级别"**：思考模式是 per-model 推理开关（传给模型）；既有"思考级别"（thinking_level）在里程碑 E 移除——两者语义分层，注意不全删后端思考支持，仅删主设置 UI 入口。

---

## 推进方式

- T-A1/A6（模型卡片收缩 + 移除人格预设）为同批先落地，验证交互骨架。
- A → B → C → D → E 依次推进，F 收尾。
- 保留优先级 `[parallel]` 标注仅当共享契约/状态完全封闭（当前无明确可并行项，均串行以保 AgentSettingsPanel 稳定）。
- 每批完成即时按 7 点清单自检；命中需用户决策项（如跨栈参数契约）列出风险点，不自动处理。

## 变更记录

- **2026-08-23**：创建本计划（6 里程碑，对应一次整合任务方向）
- **2026-08-23（执行完成）**：
  - A：模型卡片收缩（供应商类型平铺 + 可用模型分类）；云/本地/自定义 三套二级三级弹窗；人格预设移除
  - CONTRACT：top_p/top_k/思考模式 真实传导到模型调用（config/genai_backend/commands/rpc/前端类型 全链路）
  - B：用量迁入 Agent 右栏「用量」tab；主设置移除用量卡片
  - C：搜索/视觉/图像/视频作为工具并入 Skills；终端移除；能力与工具卡片删除
  - D：Skills（领域/操作/人格）与 MCP（已连接/连接中/异常/已禁用）分类栏
  - E：权限分级选择器（宽松/推荐/严格）移入主对话输入栏；思考级别移除；边界与个性卡片删除
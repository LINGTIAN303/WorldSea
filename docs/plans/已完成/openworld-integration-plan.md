# OpenWorld → WorldSmith 可取点融入规划

> status: 已完成（主体冻结归档 · 2026-08-30 核对）
>
> **归档注记（2026-08-30 实况核对）**：已完成 15 项均在代码中实证（scenario/tool_hook/confirmation/router_decider/frontend_tool_bridge/search_commands/plan_commands/secure_store 等，落点已随 2026-08-25 crate 重组迁至 agent-kernel/agent-commands，文内 `crates/agent-runtime` 路径锚点过期）。剩余 A8 配额/A9 可观测/B4 沙盒/C3 sqlite-vec/D2/D3 均为低价值待评估项，随 OpenWorld 转本地开发（2026-07-11）动机弱化，**冻结不再推进**；另 OpenWorld 目录（D:\本地化AI\OpenWorld）实际未删除，文档「删除前提」不成立。本文仅作决策史记录。
>
> 创建于 2026-08-12。本文件是 OpenWorld（已放弃）项目精华融入 WorldSmith 的**唯一权威决策记录**。
> 目标：在 OpenWorld 彻底删除前，把其可圈可取点正确迁移/借鉴进 WorldSmith，并把每一次决策落盘，
> 避免因任务推进、上下文压缩而丢失决策信息。
>
> 维护规则：
> - 本文件是"活文档"，每次启动相关任务前先读它；每次做出取舍决策后追加到「决策记录」章节
> - 「盘点表」每项含状态；状态流转：待评估 → 已采纳 → 实施中 → 已完成 / 已否决
> - 完成的任务移至「已完成」并保留决策理由
> - 与已有 `docs/plans/ROADMAP.md` 通过「衔接」章节对齐，避免重复建任务

---

## 一、背景

- **OpenWorld**（`D:\本地化AI\OpenWorld`）：基于 Rust Axum + SQLite + Vue3 的 **Web 多用户** Agent 平台，
  从「文学创作助手」演化为通用 Agent 平台（区域编排 UI、符号系统、多场景、Plan-Exec、HITL、Hook、可观测性、Marketplace、工作区）。
  项目已放弃，待精华融入 WorldSmith 后彻底删除。
- **WorldSmith**（本仓库）：基于 **Tauri 2 桌面 + Rust 后端 + WASM + 13 个 TS packages** 的本地优先世界构建与 Agent 工作台，
  单用户、per-project 隔离数据库、实体/图谱/文稿/笔记本为核心，已有长任务、Skills 商城、记忆库、Rust 编排等成熟能力。

**关键判断（决策 001）**：两项目技术栈同为 Rust+Vue，但架构范式不同（Web 多用户 C/S vs 桌面本地单用户）。
因此 OpenWorld 的可取点主要迁移其**设计理念、工程实践、Agent 能力**；Web 专有物（JWT 多租户、WebSocket 长连接、
Nginx 部署、Marketplace 仓库同步、工作区多租户）不适用，不迁移。

**（决策 002）**：用户确认纳入全部四类：工程实践类、场景化插件类、产物与知识类、前端交互类。

---

## 二、OpenWorld 可取点盘点（来源：2026-08-12 全项目探查）

> 价值：A 高 / B 中 / C 低。可行性：高=可直接借鉴实现，中=需适配桌面端，低=需重构。
> 落点指 WorldSmith 对应模块（`packages/*`、`crates/*`、`apps/tauri/src/*`），不适用标「—」。

### A. 工程实践类

| # | 可取点 | OpenWorld 形态 | 价值 | 可行性 | WorldSmith 现状 | 落点 | 决策 |
|---|--------|---------------|------|--------|----------------|------|------|
| A1 | 全链路事件流可观测 | AgentStart→RoutingStart→PipelineStart→PlanStepStart→…→AgentEnd 经 EventBus 广播，前端订阅还原全过程 | A | 高 | TS/Rust 已有 AgentEvent，但事件链未统一为「一次对话一条可追踪链」 | `packages/agent-runtime`、`packages/agent-core/bus` | 已完成 |
| A2 | 统一 Provider 解析链 | `请求>会话>工作空间>用户>全局` 四级降级 + 17 家 base_url 预设 + 多 Provider Key 隔离 | A | 高 | WorldSmith 桌面端单用户，已有 ProviderPanel/ModelPanel、providerIcons | `crates/agent-runtime/llm`、`packages/agent-runtime` | 已完成 |
| A3 | Routing 意图分类 + 四管线 | IntentClassifier（LLM 3s 超时降级关键词）+ Query/Research/Experiment/Compose 四管线 + force_pipeline Chip 强制 | A | 中 | Rust 有 orchestrator/router，但无「语义四管线」与「前端 force_pipeline 强制」 | `crates/agent-runtime/router`、`apps/tauri/src/space/chat` | 已完成 |
| A4 | Plan-Exec + Replanner + Checkpoint 回放 | 计划生成→持久化→逐步执行→重规划→checkpoint 时间旅行（分支回放） | A | 中 | Rust 有 PlanPanel、orchestrator、长任务 checkpoint；回放分支能力待对齐 | `crates/agent-runtime`、`apps/tauri/src/agent/panels/PlanPanel.vue` | 已完成（工具闭环+持久化+重规划；Checkpoint 回放暂缓，决策 016） |
| A5 | HITL 权限确认 / 提问 | 工具调用前权限守卫弹窗 + ask_user 提问，oneshot 跨连接等待，超时可配 | A | 高 | 已有 PermissionGuard（packages/agent-core/guard）、WsConfirmDialog | `packages/agent-core/guard`、`apps/tauri` | 已完成（MVP） |
| A6 | Hook 工具生命周期护栏 | PreToolUse/PostToolUse/OnError 拦截，可 allow/deny/modify args | B | 中 | 无 | `packages/agent-core/execution` | 已完成（Rust 三阶段 hook 机制，决策 020） |
| A7 | 权限分级守卫 + 沙盒策略 | Dangerous/Moderate/Safe + 危险命令识别 + SandboxPolicy | B | 高 | 已有 guard，分级细节待对齐 | `packages/agent-core/guard` | 已完成（Rust 三分级 + 前端安全级别开关，决策 019） |
| A8 | 配额/用量计量 | CostMeter 按 token 用量扣减，进对话前校验 | B | 中 | 已有 UsagePanel | `packages/governor-core`、`apps/tauri` | 待评估 |
| A9 | 可观测性（审计+metrics） | agent_runs/tool_executions/llm_calls 审计 + metrics + Web Vitals | C | 中 | 已有 ActivityLog、perf-kit | 待定 | 待评估 |

### B. 场景化插件类

| # | 可取点 | OpenWorld 形态 | 价值 | 可行性 | WorldSmith 现状 | 落点 | 决策 |
|---|--------|---------------|------|--------|----------------|------|------|
| B1 | 多场景插件体系 | ScenarioPlugin trait：身份 prompt + 工具集 + builtin_skills，8 场景（写作/科研3/杂项4） | A | 高 | 有 entity 插件体系；Agent 侧无「场景」抽象层 | `packages/agent-core`、`crates/agent-runtime` | 待评估 |
| B2 | 场景工具过滤 | 只暴露当前场景工具 + 通用工具（tool_owner 映射） | B | 高 | 无 | `packages/agent-runtime/toolbus` | 已完成 |
| B3 | 搜索 Provider 抽象 + 降级链 | Exa/Firecrawl/Tavily/DuckDuckGo/Google CSE/Jina/SearXNG/Linkup 多 provider + 降级 | A | 中 | 有 MCP（Firecrawl 默认），无搜索 provider 抽象层 | `packages/agent-runtime/mcp`、`packages/agent-runtime/tools/web-fetch` | 已完成 |
| B4 | fs/network 沙盒 | landlock 子进程权限隔离 + 网络白名单 | B | 低 | 桌面端本地运行，沙盒价值低于 Web 多租户 | 待定 | 待评估 |

### C. 产物与知识类

| # | 可取点 | OpenWorld 形态 | 价值 | 可行性 | WorldSmith 现状 | 落点 | 决策 |
|---|--------|---------------|------|--------|----------------|------|------|
| C1 | Artifacts 多版本控制 + 回滚 | 产物（文档/图表/代码）多版本 + revert | A | 中 | entity-core 有版本/回收站，Artifact 概念待引入 | `packages/entity-core/core/io`、`apps/tauri/src/ui/data/TrashPanel.vue` | 已完成 |
| C2 | @ 引用 Chip + 归属安全校验 | 引用文档/角色/记忆，后端 object 归属校验防止越权读取 | A | 中 | 有实体链接/AutoLink，但无「引用归属校验」安全层 | `packages/agent-runtime/tools`、`crates/agent-runtime` | 已完成 |
| C3 | 长期记忆向量混合排序 | sqlite-vec 向量检索 + importance 混合排序 | B | 高 | 有 memory-archive + embedding | `packages/memory-archive` | 待评估 |

### D. 前端交互类

| # | 可取点 | OpenWorld 形态 | 价值 | 可行性 | WorldSmith 现状 | 落点 | 决策 |
|---|--------|---------------|------|--------|----------------|------|------|
| D1 | 统一符号召唤分层 | `#`面板 / `~`资产 / `！`创作区 / `/`指令+技能 / `@`引用，区域命令后端动态生成 | A | 高 | 已有 SummonMenu + summon-registry，符号分层待对齐 | `apps/tauri/src/space/chat/SummonMenu.vue`、`summon-registry.ts` | 已完成 |
| D2 | 输入框三态演化 | center→floating→docked（手动 DOM 迁移规避 Teleport bug） | B | 中 | 已有 ChatInput；三态演化待对齐 | `apps/tauri/src/space/chat/ChatInput.vue` | 待评估 |
| D3 | 区域动态编排理念 | PanelTree 布局引擎 + 拖拽分割 + tab | C | 低 | Shell/AppMenu 架构不同，仅借鉴理念 | `apps/tauri/src/ui/layout` | 待评估 |

### 不迁移（Web 专有）
- JWT 多租户认证、WebSocket 长连接、Nginx 反向代理、Marketplace 仓库同步、工作区多租户隔离、批量用户/配额管理。

---

## 三、纳入范围（用户确认）

全量纳入四类中的高价值项，实施优先级如下：

**P0（高价值·快赢·独立性强，优先做）**
- A5 HITL 权限确认/提问（补齐桌面端权限交互）
- B1 多场景插件体系（Agent 侧场景抽象层，价值最高）
- D1 统一符号召唤分层（前端交互价值高，改动集中）
- C2 @ 引用归属安全校验（安全补丁，低风险高收益）

**P1（能力增强，需一定程度适配桌面端）**
- A2 Provider 解析链 + 多 Key 隔离
- A3 Routing 四管线 + force_pipeline 强制
- C1 Artifacts 多版本 + 回滚
- B3 搜索 Provider 抽象 + 降级链

**P2（长期/借鉴，价值或成本折衷）**
- A4 Plan-Exec + Checkpoint 回放（与现有长任务 checkpoint 对齐）
- A1 全链路事件流可观测
- A6 Hook 护栏 / A7 权限分级细化 / A8 配额
- C3 记忆混合排序增强
- B2 场景工具过滤（随 B1 一起）
- B4 fs/network 沙盒（桌面端价值低，仅评估）
- A9 可观测性 / D2 输入框三态 / D3 区域理念（借鉴）

> 注：P0/P1/P2 为**建议排序**，具体每个任务是否执行、是否采纳，由用户在「决策记录」逐项拍板，
> 未拍板前保持「待评估」，不擅自大改现有架构。

---

## 四、决策记录（活文档，每次取舍追加）

> 格式：`### 决策 NNN｜标题` + 日期 + 背景 + 结论 + 理由 + 影响。

### 决策 001｜迁移范式判定（2026-08-12）
- **背景**：OpenWorld（Web 多用户）与 WorldSmith（桌面本地单用户）技术范式不同。
- **结论**：只迁移设计理念/工程实践/Agent 能力；Web 专有物不迁移。
- **理由**：避免把「多租户/C/S」这套与桌面端无益的复杂度搬进本地单用户架构。
- **影响**：盘点表「不迁移」清单即出自此决策。

### 决策 002｜纳入范围（2026-08-12）
- **背景**：向用户确认融入类别。
- **结论**：四类全纳入（工程实践 / 场景化插件 / 产物与知识 / 前端交互）。
- **理由**：用户选择。
- **影响**：第三节纳入范围为最终执行范围。

### 决策 003｜文档组织（2026-08-12）
- **背景**：融入计划文档去向。
- **结论**：新建本独立文档 `docs/plans/openworld-integration-plan.md`，并在 `docs/plans/ROADMAP.md` 加索引。
- **理由**：用户选择"新建独立 plan 文档"，便于独立跟踪不丢失。
- **影响**：本文件成为唯一权威决策记录。

### 决策 004｜B1 多场景插件体系 · 落点调研结论（2026-08-12）
- **背景**：对 B1（多场景插件体系）做详细落点调研，比对 OpenWorld `ScenarioPlugin` trait 与 WorldSmith 现有 Agent 架构。
- **结论**：B1 落点在 **Rust `crates/agent-runtime`**（新增 `scenario` 模块），而非 TS 侧。理由详见「七、B1 详细落点调研」。
- **理由**：WorldSmith 主 Agent 后端已收敛到 Rust（TS `agent-runtime` 冻结为适配器宿主，`createWorldSmithAgent` 为 stub）；Rust `AgentLoop` 是实际 ReAct 执行循环，且已具备 B1 需要的两个挂载点。
- **影响**：B1 实施范围 = Rust trait + AgentLoop 接入 + 命令层 + 前端场景选择器。具体待用户确认范围后再实施。

### 决策 005｜B1 MVP 实施（2026-08-12）
- **背景**：用户确认「按 MVP 方案执行，用 WhitelistToolBus，只跑通 worldbuilding 场景」。
- **结论**：按 7.4 决策点 1=方案 B（MVP）、2=WhitelistToolBus、3=首发仅 worldbuilding 实施；B1 已实现（Rust 核心 + 命令层 + 前端调用层），详见「七、B1 详细落点调研」7.5。
- **理由**：MVP 聚焦打通场景链路；默认 `worldbuilding`，向前兼容（无场景时行为不变）。
- **影响**：B1 盘点表状态由「待评估」→「实施中」（MVP 核心完成，UI 场景选择器待接入）。

### 决策 006｜D1 统一符号召唤分层（2026-08-12）
- **背景**：将 WorldSmith 召唤系统对齐 OpenWorld 五符号分层设计。
- **结论**：五符号分层 = `#`应用层面板（运行/配置/会话列表）/ `~`Agent 资产（知识墙/记忆架）/ `！`创作区（插件视图，动态生成）/ `/`指令+技能（模式/帮助 + 技能 Chip）/ `@`引用（实体，沿用）。`#`原「命令」职责并入 `/` 指令。
- **理由**：符号职责语义化分离——面板、资产、创作区、指令、引用五类各司其职；`！`创作区从插件视图注册表动态生成，避免硬编码。
- **影响**：`summon-registry.ts` 重构为 `buildSummonItems(creationViews)` 动态构建 + 分层常量（`APP_PANELS`/`AGENT_ASSETS`/`COMMAND_ITEMS`/`SKILL_ITEMS`）；`ChatInput.vue` 接入 `~` 符号、创作区视图切换（`pluginStore`+`uiStore`）。D1 盘点表状态 →「已完成」。

### 决策 007｜C2 引用有效性校验（2026-08-12）
- **背景**：C2 原为 OpenWorld「object 归属校验」——针对多用户 Web 防止越权读取。WorldSmith 是桌面本地单用户，无越权威胁模型。
- **结论**：适配为「引用有效性校验」——`entity_get` 工具支持可选 `expected_type`，读取前校验引用 id **存在**（防悬空）且**类型匹配**（防引用错配导致 LLM 用错上下文）；前端 `SpaceChat` 引用块明确指示 LLM 传 `expected_type`。
- **理由**：用户确认此适配方向；本地单用户下「归属」无意义，真正有害的是悬空引用与类型错配。
- **影响**：`entity_get` 工具增强 + 单元测试；`SpaceChat.vue` 引用块结构化。C2 盘点表状态 →「已完成」。

### 决策 008｜A2 多 Key 池 + 降级（2026-08-12）
- **背景**：A2 原为「四级降级链 + 多 Provider Key 隔离」，针对多用户 Web。WorldSmith 桌面单用户无「工作空间/用户」层级。
- **结论**：用户确认做「多 Key 池 + 降级」——`GenaiBackend` 增加备用 key 池，主 key 请求命中可重试错误（认证/限流/网络）时逐把降级重试。四级配置覆盖（会话/项目/全局）留待后续。
- **理由**：桌面单用户下真正有价值的是多 Key 容灾（key 失效/限流自动切换），而非多级配置覆盖。
- **影响**：`backend.rs` trait 增 `set_api_key_pool` default 方法；`GenaiBackend` 增 `key_pool` 字段 + `exec_stream_once`/`finish_prompt` 重构 + `set_config_api_key`/`is_retryable_error` 辅助；命令层 `set_api_key_pool` 服务 + Tauri 命令 + 前端 `useAgentRust.setApiKeyPool`。agent-runtime 测试 204/204 通过（含 4 个新增 A2 测试）。A2 盘点表状态 →「已完成」。

### 决策 009｜A3 四管线路由（2026-08-13）
- **背景**：A3 原为「IntentClassifier（LLM 3s 超时降级关键词）+ Query/Research/Experiment/Compose 四管线 + force_pipeline Chip 强制」。落点范围先确认=「后端能力 + 前端 Chip」，随后追加接入 AgentLoop 发送链路。
- **结论**：
  - 在 `crates/agent-runtime/router.rs` 落地四管线语义——`Pipeline` 枚举（Query/Research/Experiment/Compose，含 `target_id`/`label`/`directive`/`max_tool_rounds`=3/10/10/5）、`pipeline_targets()` 四路由目标、`extract_force_pipeline()`（首 token `/管线` 前缀 + 显式管线名，优先级 Compose>Research>Experiment>Query）、`PipelineRoutingStrategy`（force_pipeline 优先 → LLM 3s 超时 → 降级关键词，超时未命中由 RouterNode.fallback 兜底）、`RouterNode::decide()`（发送链路专用，无 NodeContext 副作用）。
  - **接入 AgentLoop 发送链路**：`AgentLoop` 增 `router: Option<Arc<RouterNode>>` + `with_router()`；`run()` 在推入 user 消息前调用 `decide`，广播 `RouterDecisionMade` 事件，并把 `Pipeline::directive()` 写入 `pipeline_context`，由 `build_prompt_options` 追加到 system prompt 末尾。命令层 `create_agent` 为每个会话注入 `with_pipeline_strategy` 路由节点。
  - 前端 `summon-registry.ts` 增 `PIPELINE_ITEMS`（kind=pipeline，payload=`/查询 `/`/调研 `/`/分析 `/`/写作 `），`ChatInput.vue` 在 `buildFullText` 将管线前缀置于消息首 token。
- **理由**：用户确认「把 RouterNode 接入 AgentLoop 发送链路」；四管线语义落地为可复用策略后，发送时刻实际的意图分类/强制路由让 force_pipeline Chip 真正生效，并通过事件+system prompt 指引作用于每轮任务。
- **影响**：router.rs 新增 `Pipeline`/`pipeline_targets`/`extract_force_pipeline`/`PipelineRoutingStrategy`/`RouterNode::decide`（均已导出 `lib.rs`）；`AgentLoop` 增 `with_router` + `pipeline_context` 注入 + **会话级开关** `set_router_enabled`/`router_enabled`（`run()` 据此跳过路由并清空指引）；`agent-commands` create_agent 注入路由节点 + `set_session_router_enabled` 服务；Tauri 命令 `set_session_router_enabled`；前端 `useAgentRust.setRouterEnabled` + `currentSessionRouterEnabled` + ChatInput 输入栏 `workflow` 图标开关。**持久化（已落地）**：`sessions` 表增 `router_enabled` 列（迁移 `ALTER ... DEFAULT 1`），`SessionRecord`/`SessionInfo` 增 `router_enabled` 字段，toggle 写穿 store，`restore_sessions` 重建 AgentLoop 时应用持久值，前端切换会话读持久值同步开关。router 单测 24/24、agent-runtime 全量 191/191、agent-commands lib 66/66（含 router_enabled 持久化 roundtrip 测试）通过。**风险点已解决**：非强制消息发送不再无条件多一次 LLM 意图分类——会话级开关默认开启、可逐会话关闭并持久化（重启保留）。A3 盘点表状态 →「已完成」。

### 决策 010｜C1 Artifacts 多版本 + 回滚（2026-08-13）
- **背景**：C1 原为 OpenWorld「Artifacts 多版本 + revert」。用户确认 MVP 范围 =「A 核心多版本+回滚」，存储位置 =「entity-core Dexie（推荐）」。
- **结论**：在 `packages/entity-core` 落地 Artifact 概念——`WorldDatabase` v9 迁移新增 `artifacts` + `artifact_versions` 两表；`types/artifact.ts` 定义 `Artifact`/`ArtifactVersion`；`stores/artifactStore.ts`（Pinia）直接读写当前项目 Dexie，`create` 写 version=1 快照、`update` 内容变化自动追加版本、`rollback` 写回目标版本内容并追加新版本（完整历史保留）、`remove` 级联删版本；`composables/useArtifacts.ts` 封装列表/选中/版本/回滚；`ArtifactsPanel.vue` 模态（列表+预览+版本抽屉+新建+回滚+删除）接入 Shell（`ws-open-artifacts` 全局事件）+ AppMenu「产物」入口。
- **理由**：用户明确选「entity-core Dexie」而非走 StorageBackend（后者面向实体的 Tauri/File 多后端，扩进 Rust/Tauri 命令成本高、超出 MVP）；产物为 Agent 生成快照，版本化语义简单，Dexie 直接落库最贴合。
- **影响**：`database.ts` v9 迁移（`artifacts: 'id, title, artifact_type, project_id, version, updatedAt'`、`artifact_versions: 'id, artifact_id, version, createdAt, [artifact_id+version]'`）；`artifactStore` 追加 5 个单测（create/update 自动版本/无内容变更不增版本/rollback/remove 级联）全部通过；entity-core typecheck、tauri typecheck 通过。**风险点（用户知悉）**：产物存于 Dexie（IndexedDB），未走 FileStorageBackend 文件系统，桌面端「绑定项目目录」模式下产物不随目录导出；后续如需随目录持久化，再把 artifact 仓储桥接到 StorageBackend。C1 盘点表状态 →「已完成」。

### 决策 011｜B3 搜索 Provider 抽象 + 降级链（2026-08-13）
- **背景**：B3 原为 OpenWorld「Exa/Firecrawl/Tavily/DuckDuckGo/Google CSE/Jina/SearXNG/Linkup 多 provider + 降级」。WorldSmith TS 侧 `web-search.ts` 已有 Tavily/SerpAPI/Bing + DuckDuckGo 降级，但主 Agent 后端已收敛到 Rust，原生 `web_search` 工具缺失（仅 `deep_phases.rs` 按名字引用）。
- **结论**：在 Tauri 层新增 `search_commands.rs` 落地「搜索 Provider 抽象 + 降级链」——`SearchProvider` trait（统一 `search(query,max,key)` 同步阻塞接口）；内置 Provider：Tavily（POST）/Bing（GET 头鉴权）/SerpAPI（GET 参数）需 API Key + DuckDuckGo（免 Key 兜底）；`SearchProviderChain` 按「有 Key 优先 → 免 Key 兜底」顺序逐个尝试，任一 Provider 出错（认证/限流/网络）或返回空结果即降级到下一个，全部失败返回末位错误；`WebSearchTool` 实现 `agent-runtime::tool::Tool`（`execute` 用 `spawn_blocking` 隔离阻塞网络），经 `with_extra_tools` 注册进每个会话 ToolBus，并加入 worldbuilding 场景 `tool_ids()` 白名单；`set_search_config` Tauri 命令运行时注入 API Key（global 管理 `SearchProviderChain`）。
- **理由**：沿用 A2「适配桌面单用户」思路——真正价值是多 Provider 容灾（一个 Provider 失效自动切换），而非堆砌 provider 数量；DuckDuckGo 免 Key 兜底保证开箱即用。HTTP 复用 tauri 已有 `ureq`（开启 `json` feature），无需新增 crate。
- **影响**：新增 `ureq = { version = "2", features = ["json"] }` + `tokio = { version = "1", features = ["rt"] }`（tauri Cargo.toml）；`search_commands.rs` 10 个单测（降级链首命中/错误降级/空结果降级/全失败末位错误/配置读写/DDG HTML 解析/urlencode 往返/工具缺参报错）全部通过；`cargo check --lib` + `cargo test --lib`（13 passed,1 ignored e2e）通过；agent-runtime scenario 4 测试通过。**风险点（用户知悉）**：搜索 API Key 仅存内存（`SearchProviderChain`），未持久化，重启后回到仅 DuckDuckGo；后续如需持久化可存 settings 表 + 前端设置面板。B3 盘点表状态 →「已完成」。

### 决策 012｜B2 场景工具过滤（2026-08-13）
- **背景**：B2 原为 OpenWorld「只暴露当前场景工具 + 通用工具（tool_owner 映射）」。B1 已用 `WhitelistToolBus` 做工具**可见性**过滤（`build_prompt_options` 的 list_all），但注释明确「仅影响 LLM 可见，执行（call_tool）仍走原 tool_bus 不拦截」——非白名单工具仍可被直接调用，场景工具约束可被绕过。
- **结论**：把工具过滤从「仅可见性」升级为「可见性 + 执行双门控」。新增 `AgentLoop::effective_tool_bus(config)`：启用场景时返回 `WhitelistToolBus`（白名单 = 系统基础工具 ∪ 场景 tool_ids），无场景返回原总线。`build_prompt_options`、`execute_tool_with_retry`（串行）、`execute_tool_calls_parallel`（并行）三处统一改走 `effective_tool_bus`——非白名单工具 `call_tool` 返回 `ToolError::NotFound` 被拦截，与可见性一致。
- **理由**：B2 语义是「只暴露场景工具 + 通用工具」，仅隐藏不拦截是半成品，LLM 幻觉/投毒可绕过；桌面本地单用户虽无越权威胁，但工具集收敛能降低 LLM 误用隐藏工具（如 shell_session_* 细节管理工具）的风险。
- **影响**：`agent/memory.rs` 新增 `effective_tool_bus`（`SYSTEM_BASE_TOOLS` 上移供复用）；`agent/tools.rs` 串行/并行执行统一门控；新增 B2 单测 `scenario_filters_visible_and_executable_tools_b2`（可见性 filter + 执行 NotFound 拦截）通过；agent-runtime lib 全量 187 passed（原 186+1）；agent-commands cargo check 通过。B2 盘点表状态 →「已完成」。

### 决策 013｜A4 Plan-Exec · MVP 范围（2026-08-13）
- **背景**：A4 完整形态是「计划生成→持久化→逐步执行→重规划→checkpoint 时间旅行（分支回放）」，范围大。Rust 已有 PlanPanel、orchestrator、长任务 checkpoint，但回放分支能力待对齐。
- **结论**：本次 MVP 只做「**计划工具闭环**」：`plan_create` / `plan_update` 两个原生工具注册进 ToolBus（并加入 `SYSTEM_BASE_TOOLS` 全场景可用），LLM 生成计划 → 前端 `usePlanStore` 承接 → PlanPanel 展示 → LLM 逐步 `plan_update` 推进状态 → UI 实时反映。计划**持久化 / checkpoint 回放 / 重规划**属后续范围。
- **理由**：先把「计划生成 → 逐步执行 → 进度可视化」这一条可闭环、可验证的核心链路打通，避免一次性引入 Replanner 与时间旅行的高复杂度；长任务 checkpoint 已另成体系，回放分支单独评估。
- **影响**：新增 `apps/tauri/src-tauri/src/plan_commands.rs`（`PlanCreateTool`/`PlanUpdateTool`，无状态规范化器，含 6 项单测全通过）；`agent/memory.rs` `SYSTEM_BASE_TOOLS` 加入 `plan_create`/`plan_update`；`lib.rs` 注册 `plan_tools()`。事件双通道：①工具结果路径 `tool_execution_end` → `useAgentEvents` 解析写入 `usePlanStore`（主路径）；②Orchestrator 事件 `PlanCreated`/`PlanStepUpdate` → `commands.rs` 转发 `agent:event:plan_created/plan_update:{session_id}` → `useAgentRust` 监听更新 `usePlanStore`（预留 plan-and-execute 编排流）。`usePlanStore.PlanItem.status` 类型拓宽补 `'failed'`。A4 盘点表状态 →「已完成（MVP：计划工具闭环）」。

### 决策 014｜A4 Plan-Exec · 计划持久化 + 按会话隔离（2026-08-13）
- **背景**：决策 013 的 MVP 计划状态完全在前端 `usePlanStore`（全局单例），后端不持有——重启丢失、切换会话计划不跟随。持久化需先解决「计划状态归属」与「按会话隔离」。
- **结论**：计划状态下沉 Rust（复用闲置的 `AgentState.plan`），随会话 SQLite 持久化，按会话隔离。前端 `usePlanStore` 由后端恢复数据驱动。
- **影响**：`agent-runtime`：`AgentState`/`AgentStateSnapshot` 加 `plan` 字段；`AgentLoop` 加 `get_plan`/`set_plan` + `apply_plan_result`（工具结果 hook，接串行/并行工具执行后——`plan_create` 写入 `state.plan` 并广播 `PlanCreated`，`plan_update` 更新对应项并广播 `PlanStepUpdate`）。`agent-commands`：`SessionRepository` 加 `save_plan`/`load_plan`（`sessions` 表 `plan` TEXT 列，空数组归一 `None`）；`persist_messages` 顺带写穿 plan、`restore_sessions` 恢复 plan 到 AgentLoop。前端 `useAgentRust`：`switchSession` 经 `get_state` 恢复该会话 plan 到 `usePlanStore`（无计划则清空）、`newSession` 清空。新增单测：agent-runtime `apply_plan_result`×2、agent-commands plan 持久化×2。验证：agent-runtime 189 passed、agent-commands 68 passed、tauri `cargo check` + `vue-tsc typecheck` 通过。

### 决策 015｜A4 Plan-Exec · Replanner（计划失败重规划，2026-08-13）
- **背景**：A4 第三个递进项。计划执行中某步失败（`plan_update` 设 `failed`）后，ReAct 循环里 LLM 虽可自行调整，但缺少结构化重规划原语——用 `plan_create` 全量重建会丢失已完成进度。
- **结论**：**工具驱动 + 局部替换**。新增 `plan_replan` 工具：LLM 检测到失败后调用，传入 `failed_item_id` + `new_steps`，框架保留失败步骤及其之前的已完成进度，仅替换其后的待执行步骤并重新编号。
- **影响**：`plan_commands.rs` 新增 `PlanReplanTool`（校验 + 规范化，3 单测）；`SYSTEM_BASE_TOOLS` 加 `plan_replan`；`event.rs` 新增 `PlanReplanned { items }`；`apply_plan_result` 加 `plan_replan` 分支（保留 `[0..=fail_idx]`，丢弃后续 pending，追加新步骤并重排 order）；`commands.rs` 转发 `agent:event:plan_replanned:{session_id}`；前端监听整体刷新 `usePlanStore`。新增单测：agent-runtime `apply_plan_result` replay ×2（保留/替换 + 未命中忽略）。验证：agent-runtime 191 passed、tauri 22 passed、`cargo check` + `vue-tsc typecheck` 通过。<checkpoint 回放为 A4 最后一项，另作评估>。

### 决策 016｜A4 Checkpoint 回放 · 评估暂缓（2026-08-13）
- **背景**：A4 最后一项「Checkpoint 回放（时间旅行/分支回放）」。评估发现现有长任务 checkpoint（`LongTaskManager`/`LongTaskCheckpoint`）是**单点断点续跑**（保存单条最新 `agent_messages`，重启线性续跑），并非 A4 所需的多 checkpoint 历史 + 回放点选择 + 分支派生 + 前端时间线 UI。
- **结论**：**暂缓**，不纳入本轮。三项主链路（计划工具闭环 → 计划持久化 → Replanner）已闭环，时间旅行/分支回放作为后续独立项拆出。
- **理由**：①语义差异大——需新增 checkpoint 时间线数据模型（每 session 多条）、回放命令 + 分支状态管理、前端时间线 UI，复杂度高；②与现有长任务 checkpoint 存在集成边界（断点恢复 vs 时间旅行，语义不同）；③对桌面单用户创作工具价值中等，核心创作链路已覆盖；④若未来确需，最小可行版为**计划级回退**（`plan_revert`：回退到某已完成步骤，恢复该步 messages + plan，复用现有持久化，不做分支）。
- **影响**：A4 标记为「已完成（MVP + 持久化 + 重规划）」，Checkpoint 回放移出本轮。可复用底料：`get_state`/`restore_state`、`AgentState.plan` 持久化、messages 持久化。

### 决策 017｜A1 全链路事件流可观测（2026-08-13）
- **背景**：A1 原为 OpenWorld「AgentStart→RoutingStart→PipelineStart→PlanStepStart→…→AgentEnd 经 EventBus 广播，前端订阅还原全过程」。WorldSmith 已有分散事件通道（deep_phase / a2ui / subagent / stream / plan / confirm），但彼此独立、无统一序号，无法还原「一次对话一条可追踪链」。
- **结论**：新增统一 trace 事件通道 `agent:event:trace:{session_id}`，把非高频阶段事件按 `seq` 序号转发，前端按序写入 ActivityLog，还原 AgentStart → … → AgentEnd 完整事件链。保留原分散通道（互不冲突）。
- **理由**：沿用 OpenWorld「一次对话一条可追踪链」理念，用最小侵入补齐全链路可观测——只加一个聚合通道，前端复用既有 ActivityLog UI，不新增面板。
- **影响**：`commands.rs` `TauriAgentEventEmitter` 加 `trace_seq: AtomicU64` + `trace_summary`（17 类事件映射，过滤高频 `StreamDelta`）+ `emit_trace`（payload `{seq,type,summary}`）；前端 `useActivityLog.ts` `ActivityLogEntry` 加 `traceType`、`addLog` 加可选第 4 参；`useAgentRust.ts` 新增 `setupTraceListener`/`teardownTraceListener`（按 trace 类型映射活动日志类目 error/tool/info），接入 newSession/switchSession/deleteSession/dispose 生命周期。验证：`cargo check` + tauri 22 tests + `vue-tsc --noEmit` 通过。A1 盘点表状态 →「已完成」。

### 决策 018｜C3 长期记忆加权融合排序（2026-08-13）
- **背景**：C3 原为 OpenWorld「sqlite-vec 向量检索 + importance 混合排序」。探查发现 `@worldsmith/memory-archive` 框架**未接入实际运行**（仅设计文档引用，`RecallEngine` 改了不生效）；真正被 Agent 使用的是 `packages/agent-runtime` 的 `tools/memory.ts`（localStorage 长期记忆，`PiBackendMemoryAccessor` → `recallMemory`）。现有 hybrid 混合逻辑是**取最高分**（`Math.max(关键词分, 语义分×5)`），importance 未参与检索排序。
- **结论**：只做「加权融合排序（含 importance）」，**不引入 sqlite-vec**（记忆规模小——长期记忆上限 200 条，纯内存余弦扫描已够，sqlite-vec 属过度工程）。用户确认：importance 由**框架按 key 推断**（零侵入），融合公式用**归一化加权**。
- **理由**：真正有价值的是提升检索质量——把「关键词命中 / 语义相关 / importance」三信号加权融合，`importance` 让「偏好/规则/决策」等高价值记忆在弱匹配时也能浮出；sqlite-vec 留待记忆量涨大再说。
- **影响**：`tools/memory-internal.ts`：`MemoryEntry` 加 `importance` 字段 + `inferImportance(key)`（高价值词 0.8 / 中价值 0.65 / 默认 0.5）+ `loadMemory` 兼容旧数据（缺省 0.5）。`tools/memory.ts`：`memory_store` 存储时自动推断 importance、可选 `importance`(0-1) 显式覆盖；`recallMemory` 改归一化加权融合 `final = 0.45×词分归一 + 0.35×语义分 + 0.20×importance`（词分归一 = score/(score+3)；语义阈值从 0.25 放宽到 0，交综合分裁决；keyword/semantic 单模式分支不变）。`kb/kb-extractor.ts`、`orchestrator/pi-backend-memory-accessor.ts` 补齐 importance。验证：agent-runtime `vue-tsc --noEmit` 通过。C3 盘点表状态 →「已完成（加权融合排序；sqlite-vec 暂缓）」。
- **风险点（用户知悉）**：语义阈值放宽到 0 后，弱语义信号可能带噪音；若实测偏高，可对语义分加下限过滤（如 <0.2 视作 0）。

### 决策 019｜A7 权限分级守卫（三分级 + 前端安全级别开关，2026-08-13）
- **背景**：A7 原为 OpenWorld「危险命令识别 + 权限分级守卫 + SandboxPolicy」。A5 已实现 `ConfirmationPolicy`（`dangerous_only`，仅二元「危险/非危险」确认）；TS 侧 `PermissionGuard` 已有 safe/moderate/dangerous 三分级，但 Rust 侧 `Tool` trait 无权限等级，`needs_confirmation` 靠工具名/命令子串、无 Moderate 层。桌面端本地单用户，进程级 SandboxPolicy（landlock，对应 B4 也评估过）无价值，故**不引入沙盒进程隔离**，聚焦「权限分级 + 确认」。
- **结论**：Rust 侧建立三分级并暴露前端开关（off / dangerous_only / moderate_and_dangerous），运行时切换确认策略。用户确认按三分级方案执行。
- **理由**：把 A5 二元确认升级为 Safe/Moderate/Dangerous 分级——Dangerous 无条件确认、Moderate 按策略开关、Safe 放行；`moderate_and_dangerous` 严格档让写操作/命令一律确认，补上「仅危险确认」过于宽松的盲区。全程复用 A5 确认链路，零新依赖，行为向后兼容。
- **影响**：`confirmation.rs`：新增 `ToolPermission` 枚举 + `tool_permission()` 集中映射表（Dangerous=委派/删除，Moderate=命令执行，Safe=plan/entity_get/web_search 等只读，未登记默认 Moderate）+ `ConfirmationPolicy.confirm_moderate` 字段 + `moderate_and_dangerous()` 工厂 + `needs_confirmation` 三分级裁决（测试 4/4）。`agent/mod.rs`：`set_confirmation_policy()` 动态写 config（运行时生效）。`agent-commands`：`SecurityLevel` 枚举（Off/DangerousOnly/ModerateAndDangerous）+ `set_security_level` 服务。Tauri：`cmd_agent_set_security_level` 命令 + `parse_security_level`。前端：`useAgentRust.setSecurityLevel`、`AgentSettingsPanel` 安全面板新增「工具安全级别」三档下拉、`SpaceAgentSettingsPanel` 转发、`settingsStore.agentSecurityLevel`（localStorage 持久化）。验证：`cargo check`（三 crate）+ 前端 `vue-tsc` 通过。A7 盘点表状态 →「已完成」。
- **风险点（用户知悉）**：默认仍 `dangerous_only`；`moderate_and_dangerous` 为需用户主动选择的严格模式。

### 决策 020｜A6 Hook 工具生命周期护栏（PreToolUse/PostToolUse/OnError，2026-08-13）
- **背景**：A6 原为 OpenWorld「PreToolUse/PostToolUse/OnError 三处拦截，可 allow/deny/modify args」。WorldSmith Rust 侧无工具生命周期 hook（仅 A5/A7 的确认机制）。TS 侧 `agent-core` 也仅有权限元数据，无 hook 拦截实现。
- **结论**：在 Rust `AgentLoop` 采**三阶段 hook 机制**（新 `tool_hook.rs` + `ToolLifecycleHook` trait + `ToolHookAction`），接入默认串行工具执行链。用户确认：pre hook 改 args 直接返回 `Allow(new_args)`，`on_error` 只记录不阻断流程。
- **理由**：与 A5/A7 确认（阻断危险）互补，A6 是**可编程护栏**——pre 可改写参数/拒绝，post/on_error 供审计观测；机制解耦、零新依赖，注册若干 hook 即可扩展策略（内置 `AuditLifecycleHook` 作示例）。
- **影响**：新增 `crates/agent-runtime/src/tool_hook.rs`（`ToolHookAction::{Allow(Value),Deny(String)}` + `ToolLifecycleHook::{on_pre_use,on_post_use,on_error}` + `AuditLifecycleHook`，2 单测）；`lib.rs` 导出；`AgentLoop` 加 `tool_hooks` 字段 + `with_tool_hook` builder（复用 A5 注入模式）；`execute_tool_with_retry` 接入——pre（循环跑、后一个 `Allow` 覆盖前一个；`Deny` 转 `ToolError::Execution` 并跑全部 on_error 后返回）→ `call_tool(effective_args)` → 成功 `on_post_use` → 最终失败 `on_error`。验证：`cargo test tool_hook` 4/4（2 单元 + 2 集成 `tool_hook_modifies_args_before_execution`/`tool_hook_denies_tool_execution`，实测改 args 生效、deny 进入 toolResult）+ 三 crate `cargo check` 通过。A6 盘点表状态 →「已完成」。
- **风险点（用户知悉）**：并行执行路径（`parallel_tool_calls=true`，默认关闭）不套 hook，与 A5 确认一致；如需并行生效需单独接入。

### 决策 021｜FrontendToolBridge：Rust→前端 TS 工具双向执行桥（2026-08-19）
- **背景**：B1 worldbuilding 场景 `WorldbuildingScenario::tool_ids()` 声明了 `entity_create/update/delete`、`entity_get_context`、`relation_list/create`、`content_search`、`memory_recall/store` 等工具，但 Rust ToolBus 经 7.7 工具桥只原生实现了 `entity_list/entity_get` 两个只读工具，其余工具对 LLM 可见（经 WhitelistToolBus 白名单）却在执行时报 `ToolError::NotFound`，场景工具能力被裁半——B1 闭环的最大短板。而这些工具的**前端 TS 实现完备**（`ALL_TOOLS_MAP`，依赖 `IToolContext` 的 Dexie entity/relation/file store）。
- **结论**：新增 TS↔Rust **双向执行桥**，机制与 A5 `ConfirmationBroker` 同构（oneshot 等待）：
  1. Rust `FrontendBridgeTool::execute` 生成唯一 `call_id` → 经 `AppHandle` 广播**全局事件** `agent:tool_call`（payload: `{ callId, toolName, args }`）→ `await oneshot`（120s 超时）
  2. 前端全局监听 `agent:tool_call` → `ALL_TOOLS_MAP.get(toolName)` 找到 TS 工具实现，以 **`IToolContext`（复用 entity-core stores）** 执行 → `invoke('cmd_agent_tool_result', { callId, ok, result })` 回传
  3. Rust `cmd_agent_tool_result` 按 `call_id` 找到等待方 `resolve` 唤醒返回给 LLM
  - **关键简化**：用「全局事件通道 + call_id 唯一匹配」而非 per-session 通道——桥工具 `execute` 时无 session 上下文，工具目标是**项目级 stores**（跨会话共享），无需像 HITL 确认那样按会话弹窗；跨会话并行靠唯一 call_id 天然区分安全。
  - **实施分层**（用户确认：Tauri 层桥 + 首批跑通 3 个核心）：
    - Rust：`apps/tauri/src-tauri/src/frontend_tool_bridge.rs`（`FrontendToolBridge` pending-map + `FrontendBridgeTool` 实现 `Tool` trait + `bridge_tools()` 工厂）；命令层 `commands.rs::cmd_agent_tool_result`；`lib.rs` setup 构造 bridge 并 manage、`bridge_tools()` 并入 `extra_tools` 注入每会话
    - 前端：`useAgentRust.ts` 加 `buildBridgeContext()`（复用 entity-core stores 构造 `IToolContext`，与 useGroupChat 同构）+ `handleToolCall()` + `setup/teardownToolBridgeListener()`（幂等全局监听），接入 newSession/switchSession/dispose 生命周期；桥工具返回的 JSON 字符串经 `parseMaybeJson` 反序列化为结构化值回传
  - **首批桥接 3 工具**：`entity_create` / `entity_update` / `content_search`（工具定义 description/parameters 与前端口径完全对齐）
- **理由**：把 B1 场景从「只读实体查询」扩展到「CRUD + 内容检索」，让 worldbuilding 场景 LLM 能真正创作/修改世界设定，而非只能查；机制复用 A5 成熟的 oneshot 跨进程等待模式，零新依赖，符合「桌面本地单用户 + 前端持有 TS store」的现实架构——TS 工具执行器本就有且随前端 store 一致，重复在 Rust 原生实现会双端维护成本高、且丢失前端口径。
- **影响**：worldbuilding 场景声明但 Rust 未实现的工具，经桥完成「LLM 可见 → 前端执行 → 结果回填」全链路；`entity_get/entity_list` 仍走 Rust 原生（数据源全局 `EntityDb` SQLite，与前端 Dexie 项目库存在数据源差异——桥工具走前端 Dexie 项目库，后续若需统一可再评估）。验证：`cargo check`（worldsmith-tauri-app）干净、`cargo test --lib` 23 passed（含桥模块 1 单测）、前端 `vue-tsc --noEmit` typecheck 通过、dev server HMR 正常。
- **风险点（用户知悉）**：① 端到端真实链路需 Tauri 桌面端运行验证（浏览器 preview 模式 `cmd_agent_tool_result` 在 mockInvoke 兜底返回空对象，不发真实 IPC）；② 桥工具结果回传依赖前端全局监听器已就绪（首次建会话时注册），若未注册会超时 120s；③ `entity_list/get`（Rust SQLite 兜底库）与桥工具（前端 Dexie 项目库）数据源不一致，同一会话混用时可能出现「Rust 读到 SQLite 旧实体、前端读到 Dexie 新实体」的视图分叉，需用户知悉并决定后续是否统一数据源。
- **后续可扩展**：其余场景声明工具（`relation_create/memory_store/kb_*` 等）只需在 `bridge_tools()` 增加对应 `FrontendBridgeTool`（description/parameters 对齐前端）+ 前端确保该工具已注册进 `ALL_TOOLS_MAP` 即可；若需覆盖更多场景可参考决策 7.7 的完整 FrontendToolBridge 设想扩展。

### 决策 021 补充｜端到端排障记录（2026-08-19，Tauri 桌面端实测）
> 背景：决策 021 后到 Tauri 桌面端实测「创建角色 → entity_create 经桥落库」闭环，连续暴露 **3 个既有的非桥 bug** 阻塞链路，逐一修复后才真正跑通。这 3 个 bug 均与「API Key 注入 / 深度消息渲染 / Key 持久化」相关，是 OpenWorld 融入（A 类工程实践）在 Tauri 桌面端落地时的隐蔽断点，特此记录备查。

**排障 1：API Key 缺失（UpdateModelParams 缺 camelCase）**
- **现象**：`send_message` 报 `LLM 后端错误: 认证失败: API Key 缺失: provider=deepseek`，即便前端确定已配置 key。
- **根因**：`crates/agent-commands/src/lib.rs` 的 `UpdateModelParams` **漏了 `#[serde(rename_all = "camelCase")]`**。其字段是 `session_id/model_id/api_key`，而前端 `updateModel` 传 `sessionId/modelId/apiKey`（camelCase）→ Tauri 反序列化失败 `invalid args ... missing field 'session_id'`（此错误被 `ensureModelKey` 捕获静默）。**key 从未注入进 Rust 的 `GenaiBackend`**，发送时后端空 key →「API Key 缺失」。对照：`SendMessageParams` 一直有 camelCase 标注（故 `send_message` 只报 key 缺失而非参错）。
- **修复**：给 `UpdateModelParams` 补 `#[serde(rename_all = "camelCase")]`（[lib.rs](crates/agent-commands/src/lib.rs)，与 `SendMessageParams` 对齐）。
- **辅助**：前端 `useAgentRust.ts` 新增 `ensureModelKey()` 幂等兜底——发送（`prompt`）前从 `settingsStore`（`@worldsmith/entity-core`）读权威 provider/model（cloud/local/custom 三模式），经 `loadApiKey(provider)` 读 key，`update_model` 注入该会话；`modelKeyInjectedSessions` Set 记忆避免每轮重复。同时在发送失败时把诊断（session/mode/provider/model/key 注入态）拼进错误信息，便于 UI 直接定位。
- **经验**：Tauri v2 命令嵌套结构体参数必须显式 `serde(rename_all = "camelCase")`，否则前后端契约静默断裂。排查 API 注入类问题，先核对命令参数结构的 serde 声明。

**排障 2：useAgentUiDeps 未注入（深度消息渲染崩溃）**
- **现象**：key 修好后，Agent 正常回复但渲染时崩 `[useAgentUiDeps] 未注入 AgentUiDeps` + `TypeError: instance.update is not a function`。
- **根因**：深度模式消息气泡 `DeepMessageArea` / `useMarkdownRender` 依赖 `useAgentUiDeps()`（契约在 `packages/shared-composables/src/agent/deps.ts`），但 **Tauri 端从未调用 `provideAgentUiDeps(...)`**——Web→Tauri 迁移遗漏。此前因 API Key 缺失 Agent 从未走到回复渲染，故未暴露。
- **修复**：`apps/tauri/src/App.vue`（恒挂载，AgentSpace/Shell 平级）setup 里 `provideAgentUiDeps` 补齐全部 7 字段：`fontFamily`（fontStore `prefs.agent`）、`fontPrefs`（同）、`persona` + `enterAnimation`（persona-font-store `activeProfile`）、`activityLogs`（useActivityLog `logs`）、`replaceFontSpans`（暂 passthrough，后续可接 fontSpanParser）、`AvatarBadge`（ui/AvatarBadge.vue）。
- **经验**：共享层 `provide` 契约若在某个端（Web/Tauri）漏调，会在**首次渲染消费方**时才崩溃，且常被更前端的故障掩盖。迁移后应逐端验证共享注入点。

**排障 3：cmd_secure_store not found（Keyring 命令未实现）**
- **现象**：每次 `loadApiKey` 打 `[key-store] Keyring 检测失败，降级到 localStorage 加密存储: Command cmd_secure_store not found` 警告。
- **根因**：前端 `key-store.ts`（`packages/agent-runtime/src/providers`)在 Tauri 环境优先调 `cmd_secure_store/load/delete` 三个命令，但 **Rust 端从未注册** → invoke not found → 每次降级浏览器 localStorage（且加密，不影响功能，但 key 不落系统数据目录）。
- **修复**：新增 `apps/tauri/src-tauri/src/secure_store.rs`——`SecureStore`（SQLite `secure_store.db`，key→value）+ `cmd_secure_store/load/delete` 三命令；lib.rs 声明模块 + 注册 invoke_handler + setup 里 manage 实例（复用已有 app_data_dir + sqlx 建库模式）。4 单测通过、`cargo check` 干净。key 现落应用数据目录，跨重启持久。
- **经验**：前端针对 Tauri 的「优先 Keyring」分支依赖一组同名命令，若 Rust 端只实现部分或漏实现，会静默降级。功能正常但伴随警告 + 安全/持久档位下降，属「无告警缺口」，应补齐并单元测试覆盖。

**收尾验证**：三项修复后，Tauri 桌面端「创建一个名叫艾琳的女性角色」实测**正常回复、无 API Key 缺失、无 useAgentUiDeps 崩溃、无 cmd_secure_store 警告**。角色创建桥（key → LLM → entity_create 经 frontend_tool_bridge 转发前端 → 落前端 Dexie 库）链路具备，最终实体落库待用户实际请求创建实体时确认。

---

## 五、衔接（与已有计划对齐）

- 本文件与 `docs/plans/ROADMAP.md`、`docs/plans/agent-orchestration-roadmap.md`、`docs/plans/agent-e2e-closure-plan.md` 有交集
  （长任务 checkpoint、Router、Skills Store）。**新增任务前先查这些文档，避免重复建任务**。
- 采纳某可取点后，在对应既有文档与本文件同步登记任务编号。

---

## 六、已完成

| 项 | 状态 | 决策/说明 |
|----|------|-----------|
| B1 多场景插件体系 | 已完成 | 决策 005；Rust 场景核心 + WhitelistToolBus 裁剪 + UI 选择器 + 上下文注入 + 工具桥（原生只读 MVP）。详见 7.5/7.6/7.7 |
| A5 HITL 权限确认 | 已完成（MVP） | Rust 侧确认集 + 仅危险操作确认；详见八 |
| D1 符号召唤分层 | 已完成 | 决策 006；五符号分层 + 动态构建 + `~` 资产 + `！`创作区视图切换 |
| C2 引用有效性校验 | 已完成 | 决策 007；`entity_get` 存在性/类型校验 + 前端引用块结构化 |
| A2 多 Key 池 + 降级 | 已完成 | 决策 008；`GenaiBackend` 备用 key 池 + 可重试错误降级 + 命令/前端链路 |
| A3 Routing 四管线 | 已完成 | 决策 009；`router.rs` 四管线语义 + LLM 3s 超时降级关键词 + force_pipeline Chip + 已接入 AgentLoop 发送链路（事件广播 + system prompt 指引） |
| C1 Artifacts 多版本 + 回滚 | 已完成 | 决策 010；entity-core Dexie：`Database.v9` artifacts+artifact_versions 表 + `artifactStore`（create 快照/update 自动版本/rollback 保历史/remove 级联）+ `useArtifacts` + `ArtifactsPanel`（列表/预览/版本抽屉）接入 Shell/AppMenu |
| B3 搜索 Provider 抽象 + 降级链 | 已完成 | 决策 011；`search_commands.rs`：`SearchProvider` trait + Tavily/Bing/SerpAPI（Key）+ DuckDuckGo（免 Key 兜底）降级链 + `WebSearchTool`（spawn_blocking 隔离）+ `set_search_config` 命令 + worldbuilding 白名单 |
| B2 场景工具过滤 | 已完成 | 决策 012；`effective_tool_bus` 把 WhitelistToolBus 门控从「可见性」升级为「可见性 + 执行双门控」，串行/并行工具执行统一走白名单，非白名单返回 NotFound |
| A4 Plan-Exec + Replanner | 已完成（工具闭环 + 持久化 + 重规划） | 决策 013/014/015/016；`plan_create`/`plan_update`/`plan_replan` 原生工具 + 全场景注册 + 事件双通道驱动 `usePlanStore`/PlanPanel；计划状态下沉 Rust 随会话 SQLite 持久化、切换会话恢复；失败步骤后局部重规划（保留已完成进度）。Checkpoint 回放**暂缓**（决策 016） |
| A1 全链路事件流可观测 | 已完成 | 决策 017；统一 trace 事件通道 `agent:event:trace:{session_id}`（`trace_seq` 序号 + `trace_summary` 17 类事件映射，过滤高频 StreamDelta）+ 前端 `useActivityLog` 加 `traceType`、`useAgentRust` 新增 trace 监听按序还原完整事件链 |
| C3 长期记忆加权融合排序 | 已完成（加权融合排序；sqlite-vec 暂缓） | 决策 018；`tools/memory-internal.ts` 加 `importance` + `inferImportance`；`tools/memory.ts` 的 `recallMemory` 从取最高分改归一化加权融合（0.45 词分 + 0.35 语义 + 0.20 importance）、`memory_store` 自动标注 importance；kb-extractor / pi-backend-memory-accessor 补 importance；sqlite-vec 留待记忆规模增长（决策 016 类似思路） |
| A7 权限分级守卫 | 已完成（三分级 + 前端开关） | 决策 019；`ConfirmationPolicy` 升级 Safe/Moderate/Dangerous 三分级 + `tool_permission()` 映射表 + `moderate_and_dangerous()` 严格档；`AgentLoop.set_confirmation_policy` 运行时切换；`SecurityLevel` 枚举 + 命令 + 前端「工具安全级别」三档下拉（localStorage 持久化）；不引入进程级沙盒（桌面单用户无价值） |
| A6 Hook 工具生命周期护栏 | 已完成（Rust 三阶段机制） | 决策 020；新增 `tool_hook.rs`：`ToolHookAction::{Allow(Value),Deny(String)}` + `ToolLifecycleHook`（on_pre_use/on_post_use/on_error）+ `AuditLifecycleHook`；`AgentLoop.with_tool_hook` 注册，`execute_tool_with_retry` 接入（pre 改 args/拒绝 → call_tool → post → on_error）；内置审计钩子示例，待接 A1 trace 或持久化审计表 |
| B1 场景工具闭环（FrontendToolBridge） | 已完成（首批 3 工具：entity_create/entity_update/content_search） | 决策 021；新增 `frontend_tool_bridge.rs`（`FrontendToolBridge` oneshot + `FrontendBridgeTool` + `bridge_tools()`）+ `cmd_agent_tool_result` 命令 + lib.rs 装配（manage + 并入 extra_tools）；前端 `useAgentRust` 加 `buildBridgeContext`/`handleToolCall`/`setupToolBridgeListener`（全局 `agent:tool_call` 监听，`ALL_TOOLS_MAP` 执行 + 按 callId 回传）。把 B1 从「只读实体查询」扩展到「CRUD + 内容检索」，补齐 7.7 声明的场景工具被 NotFound 裁半的短板；其余场景工具（relation/memory/kb 等）可按 `bridge_tools()` 扩展 |

_（采纳并实施的项目移入此处并保留决策理由，详见对应实施记录章节。）_

---

## 七、B1 多场景插件体系 · 详细落点调研（2026-08-12）

> 目的：把 OpenWorld 的「场景插件」设计（场景 = 身份 prompt + 专用工具 + 内置技能 + 可选管线 + 消息钩子 + 项目上下文注入）
> 落进 WorldSmith 的正确模块。本调研结论为决策 004 的依据。

### 7.1 WorldSmith 现状（已核实）

| 项 | 现状 | 与 B1 的关系 |
|----|------|-------------|
| 主 Agent 后端 | TS `agent-runtime` 已冻结为适配器宿主；`createWorldSmithAgent` 为 stub；实际执行走 **Rust `AgentLoop`**（crates/agent-runtime） | → B1 落点应在 Rust |
| Rust `AgentLoop` | ReAct 核心循环：`backend(LLM)+tool_bus+state+config+broadcaster+long_task+loop_control+memory`；`run()` 内做记忆闭环 | → 场景需介入 `run()` 的 prompt 构建与工具视图 |
| system_prompt 注入链 | `AgentLoopConfig.system_prompt`（静态字符串）→ `agent/memory.rs::build_prompt_options` 拼入 `PromptCallOptions.system_prompt_override` → `genai_backend.rs` 应用 | → 场景把「静态字符串」升级为「场景动态构建」的挂载点 |
| 工具视图隔离 | `ToolBus` trait + `SimpleToolBus` + **`WhitelistToolBus`**（按白名单过滤 `list_all/call_tool`）已存在 | → 场景工具裁剪可直接复用 `WhitelistToolBus`，无需新造 |
| 技能体系 | 在 **TS** `packages/agent-runtime/skills`：`SkillMeta`（allowedTools/baseTools/promptFile/capabilities）、六大类 `SKILL_REGISTRY`、`resolveToolNames`、`registerSkillsToGlobalRegistry` | → 场景的 `builtin_skills` 与 TS 技能体系联动（场景激活时预选技能） |
| 场景/场景概念 | Rust 侧**无** scenario 概念（全局 Grep 仅在 vendor 命中） | → 全新模块，无冲突 |

### 7.2 落点设计（借鉴 OpenWorld `ScenarioPlugin`）

**新增 `crates/agent-runtime/src/scenario.rs`**（Rust trait，与 OpenWorld 同构但适配本地实体上下文）：

```rust
#[async_trait]
pub trait Scenario: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    /// 构建场景 system prompt（身份 + 项目/实体上下文注入）
    async fn build_system_prompt(&self, ctx: &ScenarioContext<'_>) -> String;
    /// 场景专用工具名（供 WhitelistToolBus 裁剪；通用工具自动保留）
    fn tool_ids(&self) -> Vec<String>;
    /// 场景默认激活的技能 ID（与 TS 技能体系联动）
    fn builtin_skills(&self) -> Vec<String>;
    /// 可选：消息钩子（消息前预处理）
    async fn on_message(&self, _msg: &str, _ctx: &ScenarioContext<'_>) {}
}
pub struct ScenarioContext<'a> { pub project_id: Option<&'a str>, pub query_text: Option<&'a str>, /* + 本地实体上下文读取器 */ }
pub struct ScenarioRegistry { /* 注册/查找/默认 */ }
```

**接入点（复用现有挂载点，改动最小）**：
1. `AgentLoopConfig` 增加 `scenario: Option<Arc<dyn Scenario>>`（默认 None = 现行为，向后兼容）。
2. `build_prompt_options`（agent/memory.rs）：当 `config.scenario` 存在时，用 `scenario.build_system_prompt(ctx)` 作为/追加到 `system_prompt_override`（保留现有 memory 注入逻辑）。
3. 工具视图：为 `AgentLoop` 传入的 `tool_bus` 增加 `WhitelistToolBus` 包装（白名单 = 通用工具 + `scenario.tool_ids()`），在 `new/with_scenario` 时构建。
4. `run()` 开头：把当前项目上下文（WorldSmith 本地 entity 库）注入 `ScenarioContext`。

**WorldSmith 内置场景建议**（利用其世界构建优势，远富过 OpenWorld writing 场景）：
- `worldbuilding`（默认）：实体 CRUD / 角色 / 区域 / 图谱 / 记忆 + 世界观技能
- `writing`：文稿 / 大纲 / 润色 / 翻译
- `coding`：复用 `codingAgentTools`（编码 Agent 工具集）
- `research`：搜索 / 检索 / 知识库（关联 B3 搜索 Provider）

**命令层 + 前端**：`agent-commands` 增加场景设置/切换命令；前端会话区增加场景选择器（复用 `ModelSwitcher` / `AgentPersonaBar` 模式），`startTask`/`chat` 请求携带 `scenario_id`。

### 7.3 收益与成本

- **收益**：① 按场景动态裁剪工具集，降低单轮 LLM 工具噪音、提升专注度；② 动态身份 prompt + 项目上下文注入（当前是静态字符串）；③ 为未来 B2 场景工具过滤、B3 搜索能力铺路。
- **成本**：中大型 Rust 改动（核心 trait + AgentLoop 接入 + 命令层 + 前端），且技能联动需对齐 TS/Rust 边界。
- **风险**：Rust/TS 双端工具清单不一致（TS `ALL_TOOLS_MAP` vs Rust `ToolBus`）；需确认 Rust 侧是否已注册完整工具集（由 `agent-commands` / `FrontendToolBridge` 桥接 TS 工具，见 agent.ts 注释）。

### 7.4 待用户确认的决策点
1. **实施范围**：A) 完整实现（Rust trait + 全部内置场景 + 前端选择器）；还是 B) MVP（Rust trait + 仅 `worldbuilding` 场景 + 命令层，前端暂用开关）。
2. **工具裁剪方式**：复用现有 `WhitelistToolBus`（推荐）vs OpenWorld 式 `tool_owner` 映射。
3. **内置场景首发清单**：是否按上述 4 个（worldbuilding/writing/coding/research）起步。

---

### 7.5 MVP 实施记录（2026-08-12，决策 005）

**已实现（Rust 核心，`cargo check` + `cargo test` 通过）**：
- 新增 `crates/agent-runtime/src/scenario.rs`：`Scenario` trait（`id/display_name/build_system_prompt/tool_ids/builtin_skills/on_message`）+ `ScenarioContext` + `ScenarioRegistry`（`std::sync::RwLock`）+ `WorldbuildingScenario`（身份 prompt + 14 个工具意图 + 6 个技能意图）。3 个单元测试通过。
- `crates/agent-runtime/src/lib.rs`：导出 `scenario` 模块与 `Scenario/ScenarioContext/ScenarioRegistry/WorldbuildingScenario`。
- `crates/agent-runtime/src/agent/config.rs`：`AgentLoopConfig` 增加 `scenario: Option<Arc<dyn Scenario>>`（默认 None，向后兼容）。
- `crates/agent-runtime/src/agent/memory.rs`：`build_prompt_options` 场景 prompt 合并（场景 prompt 为主体，静态 prompt/记忆依次追加）+ 工具裁剪（场景启用时用 `WhitelistToolBus`，白名单 = 系统基础工具 ∪ 场景 tool_ids）。

**已实现（命令层，`cargo check` 通过）**：
- `crates/agent-commands/src/lib.rs`：`AgentCommandService` 加 `scenario_registry`；`ensure_scenarios`/`resolve_scenario`/`list_scenarios`；`new_agent`/`new_session`/`new_session_with_kind` 接入 `scenario`；新增 `ScenarioInfo` 类型。
- `apps/tauri/src-tauri/src/commands.rs`：`new_session` 加 `scenario_id`；新增 `list_scenarios` 命令。
- `apps/tauri/src-tauri/src/lib.rs`：注册 `list_scenarios`。

**已实现（前端调用层，代码就绪待 GUI 运行验证）**：
- `apps/tauri/src/agent/composables/useAgentRust.ts`：`newSession` 透传 `scenarioId`；新增 `listScenarios`；expose 到 backend。

**验证说明**：
- 编译：`cargo check`（agent-runtime、agent-commands）通过；`cargo test --lib scenario`（agent-runtime）3/3 通过。
- 网络：rsproxy.cn 下载 CDN 超时不可达，改用 tuna 镜像临时编译验证（`--config` 命令行覆盖，未改 `.cargo/config.toml`）。
- 前端 GUI 未运行验证（需 `pnpm tauri:dev`）；UI 场景选择器（下拉）未做——因默认即 `worldbuilding`，缺省不传 `scenarioId` 即生效。

**待办（后续）**：
- ✅ **UI 场景选择器**（已完成 2026-08-12）：顶栏 `SpaceNavbar` 新增场景选择（globe 图标 + TuiSelect 列出 `listScenarios`），切换即 `newSession('新会话', undefined, scenarioId)` 新建对应场景会话；`vue-tsc --noEmit` 通过；**Trae 内置浏览器实测**：下拉正常弹出并默认选中「世界构建」，无控制台 error。
- ✅ **场景项目上下文注入**（已完成 2026-08-12）：详见「7.6 场景上下文注入实施记录」。
- ✅ **工具桥接（原生只读 MVP）**（已完成 2026-08-12）：worldbuilding 场景 `tool_ids()` 声明的 `entity_list` / `entity_get` 已注册为原生 Rust 工具，可被 LLM 看到并执行。详见「7.7 工具桥实施记录」。完整 TS↔Rust 双向桥（FrontendToolBridge）列为后续增强。

### 7.6 场景上下文注入实施记录（2026-08-12）

**目标**：让 worldbuilding 场景在系统 prompt 中动态注入当前项目实体概览（角色/区域/势力等），
使 Agent 首轮即感知项目已有设定，避免脱离既有世界观空谈。

**方案（分层对齐）**：
- 在 `agent-runtime`（公共层）定义 `ScenarioEntityProvider` trait（`entity_summary(types, per_type_limit) -> String`），
  语义 = 按实体类型拉取紧凑摘要；抽象在公共层，避免公共层反向依赖具体存储实现。
- `ScenarioContext` 增加 `entity_summary: Option<String>` 字段，承载注入的摘要。
- `AgentLoopConfig` 增加 `entity_provider: Option<Arc<dyn ScenarioEntityProvider>>`。
- `build_prompt_options` 在构建场景 prompt 前经 provider 拉取摘要，填入 `ScenarioContext`，
  场景 `build_system_prompt` 拼入「【当前项目已有设定】」段落（空摘要自动跳过）。
- 命令层 `AgentCommandService` 增加 `with_entity_provider` 链式注入，`new_agent` 传给 `AgentLoopConfig`。
- Tauri 层 `SqliteScenarioEntityProvider` 基于全局 `EntityDb`（SQLite 兜底库）实现：
  `EntityDb::summarize_types` 按类型去 `name`+`description`（描述截断 120 字符）拼成可读概览。

**注入类型集**（`WORLDBUILD_CONTEXT_TYPES`，对应 `typeMappingRegistry.ts` 实体类型规范）：
`character / region / organization / event / concept / species / magic`，每类型上限 8 条。

**已实现/验证**：
- `cargo check`（agent-runtime / agent-commands / tauri-app 三 crate）全部通过。
- scenario 测试 4/4 通过（新增 `worldbuilding_prompt_injects_entity_summary`：含实体摘要注入 + 空摘要跳过）。
- agent-commands 测试 65 单测 + 1 集成通过（同时修复上一轮 `new_session` 加 `scenario_id` 参数后
  `lib_tests.rs`/`e2e_llm.rs` 未同步的 16 处调用缺参编译错误）。
- 顺带修复 `commands.rs::list_scenarios` 未返回 `Result` 的 Tauri 异步命令签名错误（上轮遗留，此次 `cargo check` 暴露）。
- 编译网络：rsproxy CDN 再次超时，继续用 tuna 镜像 `--config` 临时覆盖验证（未改 `.cargo/config.toml`）。

**后续优化路标**：当前摘要数据源为全局 `EntityDb`（TauriStorageBackend 兜底库）；
per-project FileStorageBackend 接入后仅替换 provider 实现即可（trait 已解耦）。

### 7.7 工具桥实施记录（2026-08-12）

**目标**：让 worldbuilding 场景 `tool_ids()` 声明的 entity 工具从「仅表达意图」变为真实可调用。

**方案决策（用户确认）**：原生 Rust 只读工具 MVP（非完整 TS 双向桥）。

**实现**：
- Tauri 层 `entity_commands.rs` 新增两个原生 `Tool`：
  - `entity_list`（可按 `entity_type` 过滤列出实体）
  - `entity_get`（按 `id` 取单个实体）
  数据源复用已接入的全局 `EntityDb`（新增 `list_all` / `list_by_type` / `get` 查询方法）。
  `entity_read_tools(db)` 工厂返回 `Vec<Arc<dyn Tool>>`。
- 命令层 `agent-commands`：`AgentCommandService` 新增 `extra_tools` 字段 + `with_extra_tools` 注入，
  `new_agent` 在注册 terminal/subagent 工具后把 extra_tools 逐个注册进 ToolBus。
- Tauri `lib.rs` 装配：`.with_extra_tools(entity_commands::entity_read_tools(entity_db.clone()))`。

**生效链路**：`new_agent` 注册 tools → 场景启用时 `build_prompt_options` 用 `WhitelistToolBus`
（白名单 = 系统基础工具 ∪ worldbuilding `tool_ids()`）对 LLM 展示 `entity_list`/`entity_get` →
AgentLoop 执行走完整 tool_bus（`call_tool` 命中原生工具）→ 读 EntityDb 返回结果。

**验证**：
- 三 crate `cargo check` 通过；tauri 新增实体工具单测 2/2 通过（`entity_list_tool_works` / `entity_get_tool_works`）。
- 顺带在 tauri Cargo.toml 加 `[dev-dependencies] tokio`（`#[tokio::test]` 需要）。
- 编译网络：rsproxy CDN 超时，继续用 tuna 镜像 `--config` 临时覆盖（未改 `.cargo/config.toml`）。

**边界与后续**：
- 仅覆盖 `entity_list` / `entity_get` 两个只读工具；`entity_create/update/delete`、relation、content_search、
  memory、kb 等 TS 工具仍不可被 LLM 调用，需完整 FrontendToolBridge（Rust emit `agent:tool_call` → 前端
  `ALL_TOOLS_MAP` 执行 → `cmd_agent_tool_result` 回传）才能全量启用。
- 数据源为全局 `EntityDb`（TauriStorageBackend 兜底库）；per-project FileStorageBackend 接入后替换即扩大覆盖。

---

## 八、A5 HITL 权限确认 · 实施记录（2026-08-12）

> 对应盘点表 A5「HITL 权限确认 / 提问」。目标：在 Rust `AgentLoop` 工具执行前加权限确认，
> 危险操作（如危险 shell 命令、委派子 Agent）需用户弹窗确认，避免 Agent 擅自执行破坏性动作。

**方案决策（用户确认）**：
- 权限判定位置：**Rust 侧配置确认集**（非复用 TS `PermissionGuard` 元数据）。
- 首批范围：**仅危险操作确认**（safe/moderate 自动放行）。

**实现（分层）**：
- `agent-runtime/src/confirmation.rs`（新增）：
  - `ConfirmationBroker`：`request(broadcaster, tool, args)` 广播 `ConfirmationRequested` 并 `await` oneshot（60s 超时，超时按拒绝）；`resolve(confirm_id, approved)` 唤醒等待方。
  - `ConfirmationPolicy`：`confirm_tools`（无条件确认集）+ `dangerous_command_patterns`（execute_command/shell_session 命令命中时确认）；默认 `dangerous_only()` = `delegate_to_sub_agent` + 危险命令模式清单。
- `event.rs`：`OrchestratorEvent` 新增 `ConfirmationRequested { confirm_id, tool_name, args }` 与 `ConfirmationResolved { confirm_id, approved }`。
- `agent/mod.rs`：AgentLoop 增 `confirmation_broker` 字段 + `with_confirmation` + `resolve_confirmation`；`agent/tools.rs`：`execute_tool_calls` 命中策略强制串行（确认不适合并行），串行路径执行前经 `maybe_require_confirmation` 暂停征询，拒绝/超时按 `{"error":"用户拒绝了..."}` 工具结果返回给 LLM。
- `agent/config.rs`：`AgentLoopConfig.confirmation_policy: Option<ConfirmationPolicy>`。
- `agent-commands`：`new_agent` 注入 `ConfirmationBroker` + `ConfirmationPolicy::dangerous_only()`；`resolve_confirmation(session_id, confirm_id, approved)` 服务方法。
- Tauri `commands.rs`：emitter 转发 `agent:confirm:{session_id}`（`ConfirmationRequested`/`Resolved`）；新增 `cmd_agent_confirm` 命令；`lib.rs` 注册。
- 前端 `useAgentRust.ts`：监听 `agent:confirm:{session_id}`，`ConfirmationRequested` 弹 `WsConfirmDialog`（`useConfirm`，danger 类型），用户选择后 `invoke('cmd_agent_confirm', { sessionId, confirmId, approved })` 回传；监听器随会话生命周期注册/清理。

**生效链路**：AgentLoop 执行工具 → 命中 `confirmation_policy` → `broker.request` 广播 `agent:confirm:{session_id}` → 前端弹窗 → 用户选择 → `cmd_agent_confirm` → `broker.resolve` 唤醒 → 放行执行 / 拒绝返回工具错误 → LLM 感知。

**验证**：
- agent-runtime confirmation 测试 2/2 通过（`policy_dangerous_only_matches` / `broker_resolve_wakes_request`）。
- 三 crate `cargo check` 通过；前端 `vue-tsc --noEmit` 通过。
- 编译网络：rsproxy CDN 超时，tuna 镜像 `--config` 临时覆盖（未改 `.cargo/config.toml`）。

**边界与后续**：
- MVP 仅覆盖危险操作（`delegate_to_sub_agent` + 危险 shell 命令）；`ask_user` 主动提问、`confirmation_timeout` 可配、前端判定复用 `PermissionGuard` 等留待增强。
- 并行工具调用遇确认自动降级串行（安全优先）。

---

## 九、变更记录

- **2026-08-12**：创建文档。完成 OpenWorld 全项目探查，产出四类可取点盘点；记录决策 001/002/003；给出 P0/P1/P2 建议排序。
- **2026-08-12**：完成 B1（多场景插件体系）详细落点调研——结论：落点 Rust `crates/agent-runtime` 新增 `scenario` 模块，复用 `WhitelistToolBus` + `system_prompt_override` 注入链；记录决策 004；新增「七、B1 详细落点调研」章节（含 3 个待确认决策点）。
- **2026-08-12**：B1 MVP 实施完成（决策 005）——Rust 核心（scenario trait + registry + worldbuilding + AgentLoop 接入 + WhitelistToolBus 裁剪）+ 命令层（list_scenarios / new_session scenario_id）+ 前端调用层；cargo check 通过、scenario 测试 3/3 通过；编译因 rsproxy CDN 不可达临时改用 tuna 镜像。UI 场景选择器留待后续。
- **2026-08-12**：B1 UI 场景选择器完成——对话顶栏 `scene-field`（TuiSelect 列出 `listScenarios`，切换即新建对应场景会话）；`vue-tsc --noEmit` 通过。B1 MVP 至此闭环（Rust 核心 + 命令层 + 前端选择器）。
- **2026-08-12**：B1 前端修正——① `AgentWorkspace.vue` 为退役组件（2026-08-09 迁入 AgentSpace），场景选择器迁移到实际挂载的 `SpaceNavbar` 顶栏，并清理 AgentWorkspace 死代码；② 修复纯浏览器 preview 下 `invoke` undefined 崩溃（`useAgentRust` 加 `safeInvoke` mock 兜底）；`vue-tsc` 通过；**Trae 内置浏览器实测**：顶栏场景下拉正常弹出并默认选中「世界构建」，无 error。
- **2026-08-12**：B1 场景项目上下文注入完成——`agent-runtime` 新增 `ScenarioEntityProvider` trait + `ScenarioContext.entity_summary`；`AgentLoopConfig.entity_provider` + `build_prompt_options` 注入；命令层 `with_entity_provider`；Tauri `SqliteScenarioEntityProvider`（基于 `EntityDb::summarize_types`）。三 crate `cargo check` 通过、scenario 测试 4/4、agent-commands 65+1 通过；顺带修复上一轮遗留的 `new_session` 测试缺参（16 处）与 `list_scenarios` 非 Result 签名。详见 7.6。
- **2026-08-12**：B1 工具桥（原生只读 MVP）完成——Tauri 层新增原生 `entity_list`/`entity_get` 工具（数据源 `EntityDb`，新增 `list_all`/`list_by_type`/`get`）；命令层 `AgentCommandService` 加 `extra_tools` + `with_extra_tools`，`new_agent` 注册进 ToolBus；Tauri 装配 `.with_extra_tools(entity_read_tools(...))`。worldbuilding 场景 `tool_ids()` 声明的 entity 工具对 LLM 可见且可执行。tauri 单测 2/2 通过；顺带给 tauri Cargo.toml 加 `[dev-dependencies] tokio`。详见 7.7。完整 TS↔Rust 双向桥（FrontendToolBridge）列为后续增强。
- **2026-08-12**：A5 HITL 权限确认（Rust MVP）完成——`agent-runtime` 新增 `confirmation` 模块（`ConfirmationBroker` + `ConfirmationPolicy`，默认仅危险操作确认）+ `OrchestratorEvent::ConfirmationRequested/Resolved` + AgentLoop 执行前确认钩子（命中策略强制串行）；命令层 `new_agent` 注入 broker + `dangerous_only` 策略、`resolve_confirmation` 服务；Tauri `cmd_agent_confirm` 命令 + `agent:confirm:{session_id}` 事件转发；前端 `useAgentRust` 监听弹 `WsConfirmDialog` 回传。agent-runtime confirmation 测试 2/2、三 crate `cargo check` + `vue-tsc` 通过。详见「八、A5 实施记录」。
- **2026-08-12**：D1 统一符号召唤分层完成（决策 006）——`summon-registry.ts` 重构为五符号分层（`#`面板 / `~`资产 / `！`创作区 / `/`指令+技能 / `@`引用） + `buildSummonItems(creationViews)` 动态构建；`ChatInput.vue` 接入 `~` 符号、`pluginStore`+`uiStore` 创作区视图切换、工具栏新增 `~` 按钮；`vue-tsc` 通过。
- **2026-08-12**：C2 引用有效性校验完成（决策 007）——`entity_get` 工具增强（可选 `expected_type`，读取前校验 id 存在防悬空 + 类型匹配防错配）；`SpaceChat.vue` 引用块结构化指示 LLM 传 `expected_type`；tauri 单测 2/2 通过（含新增 `entity_get_reference_validity_check`）、前端 `vue-tsc` 通过。编译用 `cargo test --offline` 规避 rsproxy CDN 不可达。
- **2026-08-12**：A2 多 Key 池 + 降级完成（决策 008）——`backend.rs` trait 增 `set_api_key_pool` default 方法；`GenaiBackend` 增 `key_pool` 字段、`prompt` 改为逐候选 key 降级重试（可重试错误 Auth/RateLimit/Network 换下一把 key）、`exec_stream_once`/`finish_prompt` 重构 + `set_config_api_key`/`is_retryable_error` 辅助；命令层 `set_api_key_pool` 服务 + Tauri 命令 + `useAgentRust.setApiKeyPool` 暴露。agent-runtime 测试 204/204 通过（含 4 个新增 A2 测试）、三 crate `cargo check` + 前端 `vue-tsc` 通过。llm-genai feature 需 tuna 镜像避免 rsproxy 超时。
- **2026-08-13**：A1 全链路事件流可观测完成（决策 017）——`commands.rs` `TauriAgentEventEmitter` 加 `trace_seq`/`trace_summary`/`emit_trace`，把 17 类非高频事件按序投递到新通道 `agent:event:trace:{session_id}`（过滤高频 StreamDelta）；`useActivityLog.ts` `ActivityLogEntry` 加 `traceType`；`useAgentRust.ts` 新增 trace 监听（按类型映射 error/tool/info）接入会话生命周期。`cargo check` + tauri 22 tests + `vue-tsc --noEmit` 通过。A1 盘点表状态 →「已完成」。
- **2026-08-13**：C3 长期记忆加权融合排序完成（决策 018）——`tools/memory-internal.ts` 加 `importance` 字段 + `inferImportance` + 旧数据兼容；`tools/memory.ts` 的 `memory_store` 自动/显式标注 importance、`recallMemory` 从「取最高分」改「归一化加权融合」（0.45 词分 + 0.35 语义 + 0.20 importance，语义阈值放宽到 0）；kb-extractor / pi-backend-memory-accessor 补 importance。agent-runtime `vue-tsc --noEmit` 通过；不引入 sqlite-vec（待记忆规模增长）。C3 盘点表状态 →「已完成（加权融合排序；sqlite-vec 暂缓）」。
- **2026-08-13**：A7 权限分级守卫完成（决策 019）——`confirmation.rs` 加 `ToolPermission` 枚举 + `tool_permission()` 映射表 + `ConfirmationPolicy` 三分级裁决 + `moderate_and_dangerous()` 严格档（测试 4/4）；`AgentLoop.set_confirmation_policy` 运行时切换；`agent-commands` 加 `SecurityLevel` 枚举 + `set_security_level` 服务；Tauri `cmd_agent_set_security_level` 命令；前端 `AgentSettingsPanel` 安全面板「工具安全级别」三档下拉 + `settingsStore.agentSecurityLevel` 持久化。`cargo check`（三 crate）+ `vue-tsc` 通过；不引入进程级沙盒（桌面单用户无价值）。A7 盘点表状态 →「已完成」。
- **2026-08-13**：A6 Hook 工具生命周期护栏完成（决策 020）——新增 `crates/agent-runtime/src/tool_hook.rs`（`ToolHookAction::{Allow(Value),Deny(String)}` + `ToolLifecycleHook` 三方法 + `AuditLifecycleHook`，2 单测）；`AgentLoop` 加 `tool_hooks` 字段 + `with_tool_hook` builder；`execute_tool_with_retry` 接入（pre 改 args/拒绝 → call_tool → post → on_error）。`cargo test tool_hook` 4/4（含 2 集成实测改 args 生效、deny 进 toolResult）+ 三 crate `cargo check` 通过。A6 盘点表状态 →「已完成」。
- **2026-08-19**：FrontendToolBridge 完成（决策 021）——B1 场景工具闭环补齐：Rust `frontend_tool_bridge.rs`（`FrontendToolBridge` oneshot + `FrontendBridgeTool` 实现 Tool + `bridge_tools()` 首批 3 工具）+ `commands.rs::cmd_agent_tool_result` + `lib.rs` setup 构造 manage + 并入 extra_tools；前端 `useAgentRust` 加 `buildBridgeContext`（复用 entity-core stores 构造 `IToolContext`）/`handleToolCall`（`ALL_TOOLS_MAP` 执行 + 按 callId 回传）/`setup/teardownToolBridgeListener`（全局 `agent:tool_call` 幂等监听）接入 newSession/switchSession/dispose。首批桥接 `entity_create`/`entity_update`/`content_search`，worldbuilding 场景从「只读查询」扩展到「CRUD + 内容检索」。验证：`cargo check` + `cargo test --lib` 23 passed + `vue-tsc --noEmit` 通过。风险点（用户知悉）：真实链路需 Tauri 桌面端验证；`entity_list/get`（Rust SQLite）与桥工具（前端 Dexie）数据源不一致。详见决策 021。
- **2026-08-19**：FrontendToolBridge Tauri 桌面端端到端排障 3 项（决策 021 补充）——① `UpdateModelParams` 补 `#[serde(rename_all = "camelCase")]`（修 API Key 缺失根因）+ 前端 `ensureModelKey()` 发送前幂等注入 key；② `App.vue` 补齐 `provideAgentUiDeps`（修深度消息渲染 `useAgentUiDeps 未注入`/`instance.update` 崩溃）；③ 新增 `secure_store.rs`（`cmd_secure_store/load/delete` 三命令落 SQLite，修 `cmd_secure_store not found` Keyring 降级警告，4 单测）。收尾验证：桌面端「创建角色」实测正常回复、无 API Key 缺失、无渲染崩溃、无 secure_store 警告，角色创建桥链路具备。详见「决策 021 补充」。新增依赖：无（secure_store 复用已有 sqlx）。
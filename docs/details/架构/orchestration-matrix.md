# Agent 编排模式层级架构矩阵（现状+目标双栏契约）

> status: 执行中（作为后续代码模块化施工基准）
> 创建日期：2026-08-25（纯文档期：现状收集 + 架构分析，未动代码）
> 修正记录：2026-08-25 吸收「Harness 方案」裁定合并——GoT/Reflection 跨模式耦合补录（§4，已经代码核实）、NodeType 枚举清理与 SubAgent 双池两项待决（§7）、织入点协议化里程碑（§8）
> 施工进展：2026-08-25 阶段 A/B + 里程碑 2/5 全部完成——`crates/` 拆为 `agent-kernel`（底座）+ `agent-patterns`（8 扩展模式 + shared）+ `agent-runtime`（聚合壳，对外路径零改动）；RouterDecider trait 抽象消除 kernel→patterns 反向依赖；织入点 Hook 协议化（RunPhase 位点 + AgentLoopHook）；cargo test 全绿（agent-kernel 140 + agent-patterns 100 + agent-commands 86+1 + tauri check）。
> 关联：[agent-orchestration-roadmap.md](../../plans/已完成/agent-orchestration-roadmap.md)（规划，13 模式编号源） · [orchestration-patterns-delivery.md](../../misc/orchestration-patterns-delivery.md)（交付史） · [03-两方方案裁定纪要.md](../../plans/已完成/agent编排层架构重构/03-两方方案裁定纪要.md)（两方方案裁定，本文档权威性来源） · [ARCHITECTURE.md](../ARCHITECTURE.md)（项目总览）
> 用途：回答「底座该是什么」+ 给 13 个名义模式重新归位，作为 `kernel/ + patterns/` 代码模块化的**施工图纸与验收基准**。

---

## 0. 一页结论（TL;DR）

- **底座 = Agent 执行内核（内聚内核）**：执行契约 + 宿主引擎 + 最小闭环 + 资源服务 + 工程横切，五项内容见 §2.2。
- **判定线**：底座 = **能力与契约**（能不能跑、怎么跑）；模式 = **策略与组合**（跑成什么样）。**底座永不反向依赖任何模式**。
- **13 个名义模式 ≠ 13 份扩展代码**。按判定线重归位为两层：
  - **底座能力（5 个，零迁移）**：Single Agent / ReAct / Tool Use / Memory / Loop Engineering —— 其执行体天生是内核的一部分；
  - **扩展模式（8 个，独立目录）**：Plan-and-Execute / Reflection / Self-Refine / ToT / GoT / Multi-Agent / Supervisor / Router。
- **13 是产品语义编号**（对外/UI 保持一致），**架构归属是两层**（底座能力 + 扩展模式），两者双轨并行、互不冲突。
- 底座不依赖编排也能独立运行（单 Agent 直连 LLM+工具即为最小闭环）；除编排层外，底座可承载**深度任务层 / 治理层 / 知识层 / UI 层**等其他类层（§6，deep_phases 为现成示例）。

---

## 1. 背景：为什么重划层级

现状三个"不够硬"的症状：

1. **单 crate 大杂烩**：[crates/agent-runtime](../../../crates/agent-runtime/src/lib.rs) 一个 crate 平铺三类东西——底座资源、宿主引擎、13 种模式。无物理分层，无法独立编译/测试/搬移，"可迁"无处下手。
2. **模式形态不一致**：ToT `/tree_of_thoughts/`、Multi-Agent `/multi_agent/` 已是独立目录；GoT `graph_of_thoughts.rs`、Supervisor、Router、Plan、Reflection 还是单文件；ReAct / Single Agent / Tool Use / Memory 直接长在底座里。同样号称"模式"，物理形态各异，边界无从谈起。
3. **横切与模式混居**：Memory（服务）、Loop（工程设施）与策略模式（ToT/Supervisor…）并列编号 12/13，职责语义未显性化，导致"归谁、往哪迁"无法回答。

> 旧三层架构（roadmap：loop 层 / 编排层 / LLM 通信层）是**目标蓝图**，缺现状代码落点映射；本文档补上"现状 ↔ 目标"双栏并落到具体文件，成为施工基准。

---

## 2. 目标分层模型

### 2.1 分层图

```
┌────────────────────────────────────────────────────────────┐
│ 产品语义层（编号口径，对外不变）                              │
│   13 种模式：对外 13 编号 ↔ 对内两层归属（§3）                │
├────────────────────────────────────────────────────────────┤
│ 扩展层（可扩 / 可深 / 可迁）                                 │
│   扩展模式 8 个（每模式独立目录）                            │
│   + 可挂载其他类层：深度任务 / 治理 / 知识 / UI（§6）         │
├────────────────────────────────────────────────────────────┤
│ 底座内核（Agent Execution Kernel，必备，可独立运行）          │
│   ① 执行契约 ② 宿主引擎 ③ 最小闭环 ④ 资源服务 ⑤ 工程横切      │
├────────────────────────────────────────────────────────────┤
│ LLM 通信层（genai / ProviderConfig / Manifest）              │
└────────────────────────────────────────────────────────────┘
```

规则：**扩展层只依赖底座契约与资源服务；底座看不到任何一个扩展模式；任何"层"（实现 `OrchestratorNode`）都能挂到底座。**

### 2.2 底座五项内容清单（内聚内核）

| 项 | 内容 | 现状代码落点 |
|----|------|-------------|
| ① 执行契约 | `OrchestratorNode` trait + `NodeContext`（后端/工具/记忆/事件/中止检查注入） | [node.rs](../../../crates/agent-runtime/src/node.rs) |
| ② 宿主引擎 | `DefaultOrchestrator` 图执行器（节点调度/条件边/循环检测/中止恢复） | [orchestrator.rs](../../../crates/agent-runtime/src/orchestrator.rs) |
| ③ 最小闭环 | `AgentLoop`（prompt→思考→工具→结果，离了模式层也能跑） | [agent/mod.rs](../../../crates/agent-runtime/src/agent/mod.rs) |
| ④ 资源服务 | Backend / ToolBus / Memory / Confirmation / 事件 / State 类型 | [backend.rs](../../../crates/agent-runtime/src/backend.rs) · [tool.rs](../../../crates/agent-runtime/src/tool.rs) · [memory.rs](../../../crates/agent-runtime/src/memory.rs) · [event.rs](../../../crates/agent-runtime/src/event.rs) · [types.rs](../../../crates/agent-runtime/src/types.rs) · [confirmation.rs](../../../crates/agent-runtime/src/confirmation.rs) · `llm/` |
| ⑤ 工程横切 | LoopControl（重试/超时/限流）+ LongTask（检查点/心跳/看门狗） | [loop_control.rs](../../../crates/agent-runtime/src/loop_control.rs) · [long_task.rs](../../../crates/agent-runtime/src/long_task.rs) |

### 2.3 判定线（硬性约束）

- 底座 = **能力与契约**；模式 = **策略与组合**。
- **底座永不反向依赖任何模式**；Memory / Loop 以"服务"形式在底座提供，模式只是使用者。
- "可承载其他类层" = 任何实现 `OrchestratorNode` 的层都能挂到底座，不限于编排。

---

## 3. 核心矩阵

### 3.1 认知矩阵（归属决议 / 职责 / 依赖 / 扩展性）

| # | 模式 | 架构归属 | 职责（一句话） | 核心依赖 | 可扩 | 可深 | 可迁 | 可关断独立运行 |
|---|------|---------|---------------|---------|------|------|------|--------------|
| 1 | Single Agent | 底座能力 | 单轮 prompt→response，最基础闭环 | ①LLM 后端 | ✓（配置） | ✓（换后端） | 天然在底座 | 是（底座最小形态） |
| 2 | ReAct | 底座能力 | 思考→工具调用→观察→再思考 | ①+④ToolBus | ✓ | ✓ | 天然在底座 | 是 |
| 3 | Plan-and-Execute | 扩展模式 | 先规划任务分解，再逐步执行 | AgentLoop + 图引擎 | ✓ | ✓（动态追加步骤） | ✓ 独立搬移 | 可（单节点图） |
| 4 | Reflection | 扩展模式 | 执行后自我评审识别问题 | ReAct 输出 + LLM | ✓ | ✓（评审维度） | ✓ | 可 |
| 5 | Self-Refine | 扩展模式 | 基于评审反馈迭代优化至收敛 | Reflection | ✓（收敛条件） | ✓（多轮迭代） | ✓ | 可 |
| 6 | Tree of Thoughts | 扩展模式 | 分支探索多思维路径，Beam 剪枝选优 | ReAct + 并发 | ✓（beam/branch） | ✓（多层扩展） | ✓ | 可 |
| 7 | Graph of Thoughts | 扩展模式 | 思维图任意连接，多父聚合 | ToT | ✓（聚合策略） | ✓ | ✓ | 可 |
| 8 | Multi-Agent | 扩展模式 | N Agent 对等协作共享黑板 | Single Agent × N | ✓（拓扑） | ✓ | ✓ | 可 |
| 9 | Supervisor | 扩展模式 | 中心化调度分配任务给子 Agent | Multi-Agent | ✓（分配策略） | ✓（Agent 池） | ✓ | 可 |
| 10 | Router | 扩展模式 | 按输入特征路由到专业 Agent/工具链 | Single Agent | ✓（路由目标） | ✓（嵌套路由树） | ✓ | 可 |
| 11 | Tool Use | 底座服务 | 工具调用规范（ToolBus） | ①LLM 后端 | ✓（注册/别名/MCP） | — | 天然在底座 | 是 |
| 12 | Memory | 底座服务 | 短期/长期/共享记忆横切 | 存储后端 | ✓（Accessor 可插拔） | ✓ | 天然在底座 | 是 |
| 13 | Loop Engineering | 底座横切 | 通用循环控制（重试/超时/限流/心跳） | 底座 | ✓（策略组） | ✓ | 天然在底座 | 是 |

> 扩展性三词释义：**可扩**=可加能力/策略不破坏现有；**可深**=可与底座或其他模式组合加深（如 ReAct 嵌 ToT 嵌 Supervisor）；**可迁**=整目录搬移即可脱离原宿主。

### 3.2 落点矩阵（现状 ↔ 目标）

| # | 模式 | 现状代码（Rust） | 现状形态 | 命令入口 | 前端入口 | 测试 | 目标独立目录 |
|---|------|-----------------|---------|---------|---------|------|-------------|
| 1 | Single Agent | [agent/mod.rs](../../../crates/agent-runtime/src/agent/mod.rs) `AgentLoop` | 嵌底座 | `send_message`（agent-commands） | 主对话 | [agent/tests.rs](../../../crates/agent-runtime/src/agent/tests.rs) | 留 `agent/`（底座） |
| 2 | ReAct | [agent/mod.rs](../../../crates/agent-runtime/src/agent/mod.rs) `run_react_loop` | 嵌底座 | 同上（主链路） | 主对话 | 同上 | 留 `agent/`（底座） |
| 3 | Plan-and-Execute | [plan.rs](../../../crates/agent-runtime/src/plan.rs) `PlanNode`+`ExecuteNode` | 单文件 | `orchestrator_run_plan`（Tauri）→ `run_plan_execute`（agent-commands） | [PlanPanel.vue](../../../apps/tauri/src/agent/panels/PlanPanel.vue) · [usePlanRust.ts](../../../apps/tauri/src/agent/composables/usePlanRust.ts) | plan 相关测试 | `patterns/plan_execute/` |
| 4 | Reflection | [reflection.rs](../../../crates/agent-runtime/src/reflection.rs) `ReflectionNode` | 单文件 | 同上（refine 开关） | PlanPanel 评审区 | reflection 相关测试 | `patterns/reflective/` |
| 5 | Self-Refine | [reflection.rs](../../../crates/agent-runtime/src/reflection.rs) `RefineNode` | 与 4 同文件 | 同上（refine 开关） | PlanPanel | 同上 | `patterns/reflective/`（与 4 同目录） |
| 6 | ToT | [tree_of_thoughts/](../../../crates/agent-runtime/src/tree_of_thoughts/mod.rs)（mod/config/node/strategies/error/tests） | 独立目录 ✓ | `run_tot`（agent-commands） | [OrchestratorPanel.vue](../../../apps/tauri/src/agent/panels/OrchestratorPanel.vue) mode=tot · [useToTRust.ts](../../../apps/tauri/src/agent/composables/useToTRust.ts) | [tests.rs](../../../crates/agent-runtime/src/tree_of_thoughts/tests.rs) | `patterns/tot/`（搬移） |
| 7 | GoT | [graph_of_thoughts.rs](../../../crates/agent-runtime/src/graph_of_thoughts.rs) + [graph_of_thoughts_tests.rs](../../../crates/agent-runtime/src/graph_of_thoughts_tests.rs) | 单文件 | `run_got` | OrchestratorPanel mode=got · [useGoTRust.ts](../../../apps/tauri/src/agent/composables/useGoTRust.ts) | graph_of_thoughts_tests | `patterns/got/`（升目录） |
| 8 | Multi-Agent | [multi_agent/](../../../crates/agent-runtime/src/multi_agent/mod.rs)（mod/types/config/strategies/blackboard/error/tests） | 独立目录 ✓ | `run_multi` | [MultiAgentPanel.vue](../../../apps/tauri/src/agent/panels/MultiAgentPanel.vue) · [useMultiAgentRust.ts](../../../apps/tauri/src/agent/composables/useMultiAgentRust.ts) | [tests.rs](../../../crates/agent-runtime/src/multi_agent/tests.rs) | `patterns/multi_agent/`（搬移） |
| 9 | Supervisor | [supervisor.rs](../../../crates/agent-runtime/src/supervisor.rs) + [supervisor_tests.rs](../../../crates/agent-runtime/src/supervisor_tests.rs) | 单文件 | `run_supervisor` | OrchestratorPanel mode=supervisor · [useSupervisorRust.ts](../../../apps/tauri/src/agent/composables/useSupervisorRust.ts) | supervisor_tests | `patterns/supervisor/`（升目录） |
| 10 | Router | [router.rs](../../../crates/agent-runtime/src/router.rs) + [router_tests.rs](../../../crates/agent-runtime/src/router_tests.rs) | 单文件 | `router_*`（[router_commands.rs](../../../apps/tauri/src-tauri/src/router_commands.rs)，含 `router_route`） | [RouterPanel.vue](../../../apps/tauri/src/agent/panels/RouterPanel.vue) · [useRouterRust.ts](../../../apps/tauri/src/agent/composables/useRouterRust.ts) | router_tests（16/16） | `patterns/router/`（升目录） |
| 11 | Tool Use | [tool.rs](../../../crates/agent-runtime/src/tool.rs) `ToolBus` | 底座服务 | 工具调用走主链路 | 工具区 | tool 相关测试 | 留 `tool.rs`（底座） |
| 12 | Memory | [memory.rs](../../../crates/agent-runtime/src/memory.rs) `MemoryAccessor` | 底座服务 | `memory_*`（agent-commands） | 记忆面板 | memory 相关测试 | 留 `memory.rs`（底座） |
| 13 | Loop Engineering | [loop_control.rs](../../../crates/agent-runtime/src/loop_control.rs) + [long_task.rs](../../../crates/agent-runtime/src/long_task.rs) | 底座横切 | loop / long_task 命令 | composable 内嵌（useLoopControlRust / useLongTaskRust） | loop_control_tests / long_task_tests | 留 `loop_control.rs` `long_task.rs`（底座） |

> 说明：命令入口标注到 Tauri 命令名（`router_*`/`orchestrator_run_plan`）或 agent-commands 服务函数名（`run_tot`/`run_got`/`run_supervisor`/`run_multi`）；Router 模式的运行入口为 `router_route`（会话级开关 `set_session_router_enabled` 仅为启用标记）。

---

## 4. 13 模式逐一卡片

### 底座能力（5）——零迁移，仅登记

**1 | Single Agent**
- 现状：`AgentLoop` 即底座最小闭环，无独立模式代码。
- 目标：留 `agent/`。模式语义由产品层（对话入口）表达。

**2 | ReAct**
- 现状：`run_react_loop` 是 AgentLoop 的 tool-call 循环能力本身。
- 目标：留 `agent/`。执行体 = 底座；"ReAct 模式"只是其策略命名。

**11 | Tool Use**
- 现状：`ToolBus`（SimpleToolBus/WhitelistToolBus + MCP 注册 + 别名 + 并行执行）为底座资源服务。
- 目标：留 `tool.rs`。工具的注册/解析/执行全部由底座承担，任何模式均可使用。

**12 | Memory**
- 现状：`MemoryAccessor` trait + MemoryCenterAccessor（crates/agent-memory 实现）注入 NodeContext 横切。
- 目标：留 `memory.rs`，以"服务"形式持续。模式若能级扩展（如记忆编排节点）时，可另挂 `patterns/memory/` 提供策略包装，不改底座。

**13 | Loop Engineering**
- 现状：`LoopController`（RateLimiter/RetryPolicy/SoftTimeout/Watchdog）+ `LongTaskManager`（检查点/心跳）。
- 目标：留 `loop_control.rs` `long_task.rs`，作为所有层共享的工程设施。

### 扩展模式（8）——独立目录规划

**3 | Plan-and-Execute** → `patterns/plan_execute/`
- 现状审计：`PlanNode`（生成计划）+ `ExecuteNode`（内部循环逐步执行、解析 `<new_tasks>` 动态追加）；ExecuteNode 用内部循环规避 `MAX_VISIT_PER_NODE` 误报。
- 迁移动作：`plan.rs` → `patterns/plan_execute/{mod.rs, node.rs, config.rs, tests.rs}`；lib.rs 导出路径同步。
- 影响面：agent-commands `run_plan_execute`、Tauri `orchestrator_run_plan`、PlanPanel 事件（`agent:event:plan_*`）。

**4 | Reflection** → `patterns/reflective/`
- 现状审计：`ReflectionNode`（评审维度 default_dimensions、输出 ReflectionResult 事件）、`RefineNode`（max_iterations/min_score/no_improvement_rounds 三收敛条件）。
- 迁移动作：与 Self-Refine 同目录（共用反射域），`reflection.rs` 拆为 `{mod, node, refine, config, tests}`。
- 影响面：agent-commands `run_plan_execute(refine=true)`、PlanPanel 评审区、ReflectionResult 事件通道。

**5 | Self-Refine** → `patterns/reflective/`（与 4 同目录）
- 现状审计：RefineNode 与 ReflectionNode 同文件共存，评审高分一次收敛（实测 95 分），低分迭代分支待专用用例验证（roadmap 遗留风险）。
- 迁移动作：随 Reflection 一并搬入，不单独成目录（两者共享收敛协议）。

**6 | Tree of Thoughts** → `patterns/tot/`（搬移）
- 现状审计：已为独立目录（mod/config/node/strategies/error/tests）。`ToTNode` 实现执行契约；BeamSearchStrategy + LLM 评分/目标检查；四终止条件（max_depth/max_thoughts/目标达成/评分收敛）；6 个 ToT 事件。
- 迁移动作：整目录搬移即可完成"可迁"验证样板；仅更新引用路径。
- 影响面：agent-commands `run_tot`、OrchestratorPanel(mode=tot)、ThoughtTree 前端。

**7 | Graph of Thoughts** → `patterns/got/`（单文件升目录）
- 现状审计：单文件 `graph_of_thoughts.rs` + 独立 tests；`ThoughtGraph`（HashMap）+ 多父聚合（`LlmAggregationStrategy`）；GoTNode 构造 7 参数。**跨模式耦合**（2026-08-25 核实）：`graph_of_thoughts.rs:14` 从 `tree_of_thoughts` 导入 10 个符号（`ThoughtNode/ThoughtNodeStatus/ToTConfig/ToTError/ToTTerminationReason` + 5 个策略 trait/实现），违反「扩展只依赖底座」判定线。
- 迁移动作：拆为 `patterns/got/{mod.rs, node.rs, aggregation.rs, tests.rs}`；**先解耦**——`ThoughtNode/ToTConfig/ToTError/ToTTerminationReason` 及策略 trait 提升为 patterns 共享类型（ToT 公开导出或独立 `patterns/shared/`），GoT 经公开 API 复用，搬移后不得跨目录 import tot 内部符号。
- 影响面：agent-commands `run_got`、OrchestratorPanel(mode=got)。

**8 | Multi-Agent** → `patterns/multi_agent/`（搬移）
- 现状审计：已为独立目录（mod/types/config/strategies/blackboard/error/tests）。mpsc 通信拓扑（mesh/ring/star/pipeline/custom）、SharedBlackboard、三收敛条件（MaxRounds/GoalReached/AllAgentsIdle）、AgentRole 语义。
- 迁移动作：整目录搬移；注意 `EventEmitterSafe`/`CollectingEmitter` 与底座 event 的桥接保持在边界文件内。
- 影响面：agent-commands `run_multi`、MultiAgentPanel。

**9 | Supervisor** → `patterns/supervisor/`（单文件升目录）
- 现状审计：单文件 `supervisor.rs` + 独立 tests；`AssignmentStrategy`（轮询/负载 → `LlmAssignmentStrategy` 能力匹配）、`SubAgentSpec` 池生命周期。
- 迁移动作：拆为 `patterns/supervisor/{mod.rs, node.rs, assignment.rs, error.rs, tests.rs}`。
- 影响面：agent-commands `run_supervisor`、OrchestratorPanel(mode=supervisor)、SubAgentSection 展示。

**10 | Router** → `patterns/router/`（单文件升目录）
- 现状审计：单文件 `router.rs` + 独立 tests（16/16）；`RoutingStrategy`（Llm/Keyword/可插拔）、嵌套路由经图天然成树、`A3 Routing` 四管线（Query/Research/Experiment/Compose）。
- 迁移动作：拆为 `patterns/router/{mod.rs, node.rs, strategies.rs, prompt.rs, tests.rs}`（routing prompt 模板随策略独立）。
- 影响面：`router_*` Tauri 命令、RouterPanel；注意 A3 管线与底座 router 的职责厘清（A3 是产品级管线，Router 是内核级节点，两者关系在 §7 待澄清）。

---

## 5. 归属判定记录（决议 + 理由）

| # | 模式 | 决议 | 理由 |
|---|------|------|------|
| 1 | Single Agent | 底座能力 | 执行体就是 AgentLoop；无独立策略代码可搬 |
| 2 | ReAct | 底座能力 | `run_react_loop` 是 AgentLoop 的工具调用循环本体 |
| 3 | Plan-and-Execute | 扩展模式 | 独立策略（计划生成+逐步执行），可脱离 AgentLoop 复用图引擎 |
| 4 | Reflection | 扩展模式 | 评审策略可插拔，与底座循环解耦 |
| 5 | Self-Refine | 扩展模式 | 迭代收敛策略，依赖 Reflection |
| 6 | ToT | 扩展模式 | 完整策略域（探索/评分/剪枝），已独立目录 |
| 7 | GoT | 扩展模式 | 在 ToT 上加图聚合策略，独立目录候选 |
| 8 | Multi-Agent | 扩展模式 | 多实例协作策略，已独立目录 |
| 9 | Supervisor | 扩展模式 | 分配调度策略，依赖 Multi-Agent |
| 10 | Router | 扩展模式 | 路由决策策略，可扩展到其他传输面 |
| 11 | Tool Use | 底座服务 | ToolBus 是资源服务，任何模式共用 |
| 12 | Memory | 底座服务 | Accessor 注入契约，横切所有层 |
| 13 | Loop Engineering | 底座横切 | 重试/超时/限流/心跳是工程基础设施 |

> 判定逻辑：问"把这段代码删掉，AgentLoop 还能不能跑？"——能跑且不亏功能 ⇒ 模式；不能跑或跑起来残缺 ⇒ 底座能力/服务。

---

## 6. 底座可承载的其他类层（明日"可承载"示例）

底座通过「执行契约 + 宿主引擎 + 资源服务」天然承载编排以外的层：

| 类层 | 说明 | 现状锚点 |
|------|------|---------|
| **深度任务层** | 五阶段任务拆解流程，当前嵌在 `agent/mod.rs` 被调用 | [deep_phases.rs](../../../crates/agent-runtime/src/deep_phases.rs) —— **现成示例**：可升为独立"层"（非 13 模式之列）挂到底座 |
| 治理层 | 权限/确认策略，已在底座 | [confirmation.rs](../../../crates/agent-runtime/src/confirmation.rs) + 安全分级 selector |
| 知识层 | KB 检索/实体访问（tools 层） | [mcp.rs](../../../crates/agent-runtime/src/mcp.rs) / 工具集 |
| UI 交互层 | A2UI 页面渲染节点 | [a2ui.rs](../../../crates/agent-runtime/src/a2ui.rs) |
| 技能/插件层 | Skills 解析与注入 | crates/skills-store / plugins |

> 启示：base 只要守住"契约+宿主+资源"，任何一层（编排/深度/治理/知识/UI）都是可插拔扩展——这正是"可扩、可深、可迁"的落点。

---

## 7. 风险与待决

1. **13 编号 vs 两层归属的口径一致性**：对外文档/UI 继续用"13 种模式"；架构文档用"底座能力 5 + 扩展模式 8"。需在 roadmap、README、产品文案三方保持双轨表述，避免读者困惑。
2. **roadmap 旧三层架构图**：其"loop 层"大致对应底座能力（1/2/11 + 3/4/5 原 loop 层但其实已是节点）；新矩阵以"底座/扩展"为准，roadmap 图保留为历史规划视角（本文档 §2.1 为新权威）。
3. **deep_phases 的归属**：当前嵌在 `agent/mod.rs` 由 AgentLoop 调用；若要升为"深度任务层"独立扩展，需要先抽取调用点（属于后续代码里程碑，不纳入本期）。
4. **A3 Routing 与 Router 节点职责边界**：A3 四管线（Query/Research/Experiment/Compose，产品级）与内核级 RouterNode（路由决策）关系待后续澄清，防止"两套路由"概念混淆。
5. **代码模块化的前提依赖**：搬移 8 个扩展模式为独立目录时，需同步改 lib.rs 导出、agent-commands import、tests 路径——属后续里程碑，迁移顺序建议：先 ToT/Multi-Agent（已是目录，搬移样板）→ 单文件升目录（Supervisor/Router/GoT）→ plan/reflection 拆目录。
6. **NodeType 枚举与两层归属错位**（2026-08-25 裁定新增）——**已完成（2026-08-25，commit 8345e84）**：枚举删除 `React/SubAgent/Memory` 三个无节点变体，仅保留 9 模式真节点 + `Custom` 扩展位；`as_str` 删对应分支；全库 grep 零引用 + 编译期穷尽匹配保证安全。产品语义「13 模式」与架构两层归属代码级一致。**未引入 ExtensionRegistry 注册表**（扩展通道本就是实现 trait，动态注册需求尚不存在）。
7. **SubAgent 双池并存**（2026-08-25 裁定新增）——**已完成（2026-08-25，commit 09b933b）**：新增 `agent-kernel/src/sub_agent_pool.rs` 共享运行时（`SubAgentSpec` 上移 + `SubAgentPool`：懒加载池/spec 指纹复用/规格变更重建+上下文迁移/WhitelistToolBus 白名单隔离/clear/remove/instances）；`SupervisorNode` 与 `SubAgentManager` 均改用 SubAgentPool（各自删除重复创建实现）。边界：池只承载「创建/复用/重建/隔离」，不承载触发语义（Supervisor 图节点显式调度 vs delegate 工具隐式委派）与命令层状态（specs 注册表、委派深度/超时、事件广播）——后者保留原位。**不将 SubAgent 节点化**（会消灭自主委派语义）。行为增强：Supervisor 子 Agent 现自动获得白名单隔离 + 规格变更重建能力。

---

## 8. 后续里程碑（本期不做，方向备忘）

1. **代码模块化**：`crates/agent-runtime/src/` 重组为 `kernel/`（底座五项）+ `patterns/`（8 扩展模式独立目录），按 §4 卡片迁移动作执行。
   - **阶段 A（patterns/ 扩展层）已完成（2026-08-25）**：8 模式全部独立目录 + shared 共享类型/工具。
   - **阶段 B（kernel/ 底座目录化）已完成（2026-08-25）**：底座重启（node/orchestrator/agent/backend/tool/tool_context/tool_hook/memory/event/types/confirmation/loop_control/long_task(+tests)/llm/alias/mcp/a2ui/deep_phases/scenario）入 kernel/；lib.rs 转发层作为对外公共门面保留（内部实现全在 kernel//patterns/）。
   - **剩余**：转发层可选收尾——若外部引用收敛到 `kernel::`/`patterns::` 新路径后可摘除顶层转发（对外 API 稳定优先，默认保留）。
2. **crate 拆分** —— **已完成（2026-08-25）**：`crates/` 拆为 `agent-kernel`（底座）+ `agent-patterns`（扩展模式）+ `agent-runtime`（聚合壳，转发两子 crate 保持对外 `agent_runtime::xxx` 零改动）；前置抽象 `RouterDecider` trait（agent-kernel/router_decider.rs）消除 kernel→patterns 反向依赖；feature（llm-genai/sqlite）经壳传导。验证：agent-kernel 140 + agent-patterns 100 + agent-commands 86+1 全绿 + tauri check。
3. **前端收敛** —— **统一适配器已收口（2026-08-25）**：`createOrchestratorRunner` 升级为配置式工厂（新增 `OrchestratorRunHooks.onPrepare` 运行前钩子），覆盖 **ToT/GoT/Supervisor/Plan** 4 模式（usePlanRust 经 onPrepare 挂载评审监听并收敛骨架；busy/error/result/会话校验/error 回显单份）；`useMultiAgentRust`（多会话自治 sessions Map + 实时事件订阅）、`useRouterRust`（router_* 配置/决策语义）、工程类（useLoopControlRust/useLongTaskRust）保留独立——各自语义不同于「run 编排图」骨架，为收敛而收敛属过度工程。OrchestratorPanel 已 mode= 表驱动（ToT/GoT/Supervisor）。「模式→底座/扩展」产品语义层表达与编号口径 UI 展示：延后至有真实 UI 需求时再做。
4. **验证基准**：以本文档 §3 矩阵为验收，迁移后 `cargo test` 全绿 + 每模式前端实测链路闭合。
5. **织入点协议化**（2026-08-25 裁定列入）——**已完成（2026-08-25）**：`agent-kernel/src/agent/hooks.rs` 定义 `RunPhase` 位点（BeforeReact/AfterUserMessage/OnToolCall/AfterReact/AfterRun）+ `AgentLoopHook` trait + `AgentLoopHooks` 注册表 + `HookContext` 只读上下文；内置织入（记忆/路由/DeepPhase）组织化为内部方法（`run_recall_memory`/`run_router_decision`/`run_memory_archive`）；`with_hook`/`register_hook` 扩展通道；行为零变化（无钩子时 dispatch 短路），单测 `run_dispatches_hooks_in_order_and_keeps_behavior` 验证。位点清单与契约详见 [agent.md 织入点 Hook 协议](../../注释/agent-runtime/agent.md)。此为被否决 Harness 方案（SessionRuntime/ReactNode 抽离）的合理内核降级保留。
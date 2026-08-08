# Agent 编排框架路线图

> status: 执行中
> 创建日期：2026-07-24
> 状态：**阶段 1（Rust Agent loop）+ 阶段 2（编排框架）已完成**（2026-07-28，cargo test 127/127）；阶段 0（TS 编排验证）未做完整，被 Rust 直接实现替代；阶段 3（自研 pi-ai）可选待定
> 关联：替换 WorldSmith 的 TS pi-ai（详见 [project_memory.md](../../project_memory.md)）

## 一、目标

为 WorldSmith 构建一套完整的 Agent 编排框架，支持 13 种主流 Agent 模式，并分阶段从 TypeScript（pi-ai）迁移到 Rust 原生实现。

## 二、13 种模式的三层架构

这 13 个模式不是平级的，而是分布在三个抽象层。底层 LLM 选型只影响最下层，上层编排框架无论选哪条路径都要自研。

```
┌──────────────────────────────────────────────────────────────┐
│  编排框架层（100% 自研，与底层选型无关）                       │
│  6. Tree of Thoughts    7. Graph of Thoughts                 │
│  8. Multi-Agent         9. Supervisor Pattern                │
│  10. Router Pattern     13. Loop Engineering                 │
├──────────────────────────────────────────────────────────────┤
│  Agent loop 层（基础循环，需要可控）                           │
│  1. Single Agent        2. ReAct                             │
│  3. Plan-and-Execute    4. Reflection                        │
│  5. Self-Refine         11. Tool Use Pattern                 │
├──────────────────────────────────────────────────────────────┤
│  LLM 通信层（pi-ai / genai / 自研 Rust）                      │
│  streamSimple + getModel + 多 Provider 适配                   │
└──────────────────────────────────────────────────────────────┘
                    12. Memory Pattern 横切所有层
```

### 2.1 模式定义与依赖关系

| # | 模式 | 层级 | 依赖 | 说明 |
|---|------|------|------|------|
| 1 | Single Agent | loop | LLM 通信层 | 单轮 prompt→response，最基础循环 |
| 2 | ReAct | loop | Single Agent | Reason+Act 循环：思考→工具调用→观察→再思考 |
| 3 | Plan-and-Execute | loop | ReAct | 先规划任务分解，再逐步执行子任务 |
| 4 | Reflection | loop | ReAct | 执行后自我评审，识别问题并改进 |
| 5 | Self-Refine | loop | Reflection | 基于 Reflection 反馈迭代优化输出 |
| 6 | Tree of Thoughts | 编排 | ReAct + 并发 | 分支探索多条思维路径，回溯选优 |
| 7 | Graph of Thoughts | 编排 | ToT | 思维图，节点间任意连接（非线性分支） |
| 8 | Multi-Agent | 编排 | Single Agent × N | 多个 Agent 协作完成任务 |
| 9 | Supervisor Pattern | 编排 | Multi-Agent | 中心化调度器分配任务给子 Agent |
| 10 | Router Pattern | 编排 | Single Agent | 根据输入路由到不同专业 Agent/工具链 |
| 11 | Tool Use Pattern | loop | Single Agent | 工具调用规范（已由 ToolBus 实现） |
| 12 | Memory Pattern | 横切 | 所有层 | 短期/长期/共享记忆，渗透所有模式 |
| 13 | Loop Engineering | 编排 | 所有模式 | 通用循环控制（中断/恢复/重试/超时/限流） |

### 2.2 现有基础盘点

| 模式 | 现状 | 文件 |
|------|------|------|
| 1. Single Agent | ✅ 已有 | [bridge.ts](../../packages/agent-runtime/src/bridge.ts) CoreBackend |
| 2. ReAct | ⚠️ 隐式存在 | pi-agent-core 的 Agent 类内置 tool_call 循环 |
| 3. Plan-and-Execute | 🟡 雏形 | `usePlanStore.ts`（原 apps/web 路径，2026-08-08 已删除）有 PlanItem 状态机 |
| 8. Multi-Agent | 🟡 雏形 | `useOrchestrator.ts`（原 apps/web 路径，2026-08-08 已删除）子 Agent 调度 |
| 9. Supervisor | 🟡 雏形 | useOrchestrator 的 dispatch + maxConcurrency 控制即 Supervisor 雏形 |
| 11. Tool Use | ✅ 已有 | [packages/agent-core/src/bus/](../../packages/agent-core/src/bus) ToolBus 完整实现 |
| 12. Memory | 🟡 部分 | [memory-archive](../../packages/memory-archive) 已有，但未与 Agent loop 深度集成 |
| 13. Loop Engineering | 🟡 部分 | `longTaskStore.ts`（原 apps/web 路径，2026-08-08 已删除）有 checkpoint/心跳 |
| 4. Reflection | ❌ 缺失 | — |
| 5. Self-Refine | ❌ 缺失 | — |
| 6. ToT | ❌ 缺失 | — |
| 7. GoT | ❌ 缺失 | — |
| 10. Router | ❌ 缺失 | — |

## 三、三条路径分析

### 路径 1：自研 Rust 版 pi-ai

**做法**：用 `reqwest` + `eventsource-stream` 自行实现 SSE 流式推理 + 26 个 Provider 协议适配 + Agent loop

| 优势 | 劣势 |
|------|------|
| 完全可控，无第三方框架依赖 | 工作量最大（底层+中层+上层全做） |
| 可针对 worldsmith 需求精确设计 API | 需自行维护所有 Provider 协议更新 |
| 性能最优 | SSE 解析/重试/限流等基础设施需从零写 |

### 路径 2：genai + 自研 Agent loop

**做法**：用 [`genai`](https://crates.io/crates/genai) crate 做 LLM 通信层（26+ Provider 原生支持），自研 Agent loop + 编排框架

| 优势 | 劣势 |
|------|------|
| 国产模型（DeepSeek/Aliyun/Moonshot）原生支持最好 | 需自己实现 30-50 行 tool-calling 循环 |
| API 稳定，定位最贴近 pi-ai（薄通信层） | 主要维护者单一，bus factor 较低 |
| 解锁 Rust 异步并发能力（ToT/GoT 并行） | v0.7.0 仍在 beta，API 有调整 |

### 路径 3：保持现状（TS pi-ai）

**做法**：继续用 pi-ai + pi-agent-core，在其之上包一层 Orchestrator 实现编排模式

| 优势 | 劣势 |
|------|------|
| 迭代速度最快，只做上层编排 | **pi-agent-core 的单循环 Agent 是天花板** |
| 现有代码全部复用 | TS 单线程，ToT/GoT 并行调度复杂 |
| 无迁移成本 | 无法享受 Rust 性能/内存安全 |

### 关键洞察

**pi-agent-core 的 `Agent` 类是这 13 个模式的瓶颈**。它是单循环设计（prompt→stream→tool_call→result），没有原生的：
- 分支/并行（ToT/GoT 需要）
- 状态图（Plan-Execute/Router 需要）
- 多实例协调（Multi-Agent/Supervisor 需要）

要在它之上做 ToT/GoT，得绕过 Agent 类自己管循环——等于白用 pi-agent-core。路径 3 的天花板就在这里。

## 四、分阶段路线

### 阶段 0：TS 编排框架验证（路径 3，当前阶段）

> **2026-07-28 状态更新**：阶段 0 的 TS 编排框架（任务 0.1-0.5）**未完整实施即被 Rust 路线替代**（Rust 阶段 1/2 直接实现全部编排模式）。0.6/0.7 的部分产出（MemoryNode/WorkingMemory/事件扩展）已在 `packages/agent-core` 中保留。本节作为设计参考存档，不再作为前置依赖。

**目标**：用最低成本在 TS 上验证编排框架的 API 设计，为后续 Rust 迁移提供参考实现

**范围**：实现模式 1-5（基础循环类）+ 模式 12（Memory 横切）

**关键原则**：用 pi-agent-core 的 Agent 但包一层 Orchestrator，不与 Agent 类强耦合

#### 阶段 0 任务清单

##### 0.1 设计统一 Orchestrator 接口
- [ ] 定义 `Orchestrator` trait/interface（TS 版）
- [ ] 定义 `Node` / `Edge` / `State` 抽象（参考 LangGraph）
- [ ] 设计事件流（与现有 [AgentEvent](../../packages/agent-runtime/src/bridge-types.ts) 兼容）
- [ ] 输出：`packages/agent-core/src/orchestrator/` 新模块

##### 0.2 重构现有 ReAct 循环
- [ ] 将 pi-agent-core 的 Agent 循环包装为 `ReactNode`
- [ ] 暴露中断/恢复/重试钩子（替代直接调 `agent.prompt`）
- [ ] 将 [bridge.ts](../../packages/agent-runtime/src/bridge.ts) 的 prompt 调用改为经过 Orchestrator
- [ ] 验收：现有功能不退化，新增可控中断能力

##### 0.3 实现 Plan-and-Execute 模式
- [ ] 复用 `usePlanStore.ts`（原 apps/web 路径，2026-08-08 已删除）的 PlanItem 状态机
- [ ] 实现 `PlanNode`（生成计划）+ `ExecuteNode`（逐步执行）
- [ ] 支持 Plan 动态调整（执行中发现新任务可追加）
- [ ] 验收：可让 Agent 先列计划再执行，UI 展示进度

##### 0.4 实现 Reflection 模式
- [ ] 实现 `ReflectionNode`（评审输出）
- [ ] 定义评审维度接口（正确性/完整性/风格）
- [ ] 与 ReAct 循环集成：每 N 轮触发一次 Reflection
- [ ] 验收：Agent 能识别自己的错误并修正

##### 0.5 实现 Self-Refine 模式
- [ ] 基于 Reflection，实现迭代优化循环
- [ ] 定义收敛条件（最大迭代数/评分阈值/无改进）
- [ ] 验收：Agent 输出质量随迭代提升

##### 0.6 Memory Pattern 横切集成
- [x] 设计 `MemoryAccessor` 接口（解耦 memory-archive，可迁移到 Rust trait）
- [x] 实现 `MemoryNode` 节点（4 种动作：recall/inject/archive/auto）
- [x] 短期记忆：`ShortTermMemoryHelper` trim 策略（token 估算 + 保留 system/首条user/最近N条）
- [x] 将 [memory-archive](../../packages/memory-archive) 接入 Orchestrator（通过 `NodeContext.memory` 可选字段注入）
- [ ] 工作记忆：ReAct 循环内的观察缓冲（推迟到阶段 0.7 实现，已在 0.7 完成）
- [x] 长期记忆：通过 `MemoryAccessor.recall()` 检索跨会话记忆
- [x] 事件扩展：`memory_recall` / `memory_inject` / `memory_archive` / `memory_trim` 4 类事件
- [x] 类型检查验证：agent-core 0 errors，worldsmith-agent 无新错误
- [ ] 验收：实现 `PiBackendMemoryAccessor` 适配器并浏览器实测（适配器已在 0.7 实现，浏览器实测推迟）

##### 0.7 工作记忆补全与 Memory 验收
- [x] 设计 `WorkingMemoryEntry` / `WorkingMemorySnapshot` 类型（types.ts 已添加）
- [x] 实现 `WorkingMemoryHelper` 工具类（观察缓冲+容量控制+合并）
  - `push` / `pushObservation`：推入观察条目，自动 trim
  - `getSnapshot`：只读快照视图
  - `trim`：按 importance 升序移除低重要性条目（保留 >= threshold 的）
  - `clear`：清空工作记忆
  - `merge`：合并到 messages（按 importance 降序选择，限 token）
  - `formatForPrompt`：格式化为可注入 prompt 的文本
- [x] 扩展 `OrchestratorEvent` 添加 `working_memory_*` 4 类事件
  - `working_memory_push` / `working_memory_trim` / `working_memory_clear` / `working_memory_merge`
- [x] 实现 `PiBackendMemoryAccessor` 适配器（worldsmith-agent）
  - 包装 `recallMemory` / `formatMemoryForPrompt`
  - KV 模型 → `MemoryRecallResult` 格式转换
  - `archive` 返回 null（KV 模型无归档概念，阶段 1 迁移到 memory-archive 后实现）
  - `outputTypes` 过滤基于原始 entry 推断（比 summary 推断更准确）
- [x] 类型检查验证：agent-core 0 errors，worldsmith-agent 0 errors（无 orchestrator 相关错误）
- [x] ReactNode 集成工作记忆 hook（阶段 0.7 完成）
  - `ReactNodeWorkingMemoryConfig`：enabled/options/captureFromMessages/mergeOnComplete/mergeFormat/mergeMaxTokens/autoInjectToPrompt/autoInjectMaxTokens
  - `workingMemoryHelper` 注入：支持外部 helper 复用（多节点共享工作记忆）
  - 工具结果捕获：从本次 execute 新增的 toolResult 消息提取（基于 messagesBefore 索引）
  - Prompt 注入：支持 `{{workingMemory}}` 占位符 + autoInjectToPrompt 自动拼接
  - 完成合并：节点 done 时将工作记忆聚合为 system 消息追加到 messages
  - `getWorkingMemoryHelper()`：暴露 helper 给外部节点（Reflection 评估等）
- [x] 导出更新：index.ts 新增 `ReactNodeWorkingMemoryConfig` / `WorkingMemoryEntry` / `WorkingMemorySnapshot` 类型导出
- [ ] 验收：浏览器实测 MemoryNode + WorkingMemoryHelper 端到端流程（推迟到阶段 1 Rust 迁移后统一验证）

#### 阶段 0 验收标准
- 模式 1-5 在 TS 上可用，通过浏览器实测
- Orchestrator 接口设计稳定，可平滑迁移到 Rust trait
- pi-agent-core 的耦合度降低，替换它不需要改动编排层

---

### 阶段 1：Rust Agent loop 迁移（路径 2）

**前置条件**：阶段 0 完成，Orchestrator 接口设计稳定

**目标**：用 Rust 实现 Agent loop 层，解锁 ToT/GoT 的并行能力

**选型**：genai（26+ Provider 原生支持，定位最贴近 pi-ai）

#### 阶段 1 任务清单

##### 1.1 Rust crate 脚手架
- [x] 新建 `crates/agent-runtime/`（独立 crate，不进 src-tauri）
- [x] 依赖：`genai`（0.7.0-beta.14）、`tokio`、`serde`、`sqlx`（SQLite）
- [x] 定义 Rust trait：`Orchestrator` / `OrchestratorNode` / `OrchestratorEdge` / `OrchestratorState`（映射阶段 0 的 TS 接口）
  - `backend::NodeBackendAccessor`：LLM 后端访问器（prompt/steer/messages/trim_context）
  - `memory::MemoryAccessor`：记忆访问器（recall/inject/archive/getArchiveBoundary/loadChunk）
  - `node::OrchestratorNode`：节点接口（execute/reset）+ `NodeContext` / `NodeResult` / `NodeStatus`
  - `event::OrchestratorEvent`：编排事件枚举（Agent 透传 + Orchestrator/Node/Plan/Memory/WorkingMemory 扩展）
  - `orchestrator::{Orchestrator, DefaultOrchestrator}`：编排器 trait + 空实现（with_backend/with_memory 注入器）
  - `types::{OrchestratorState, OrchestratorMessage, PlanItem, ReflectionResult, WorkingMemoryEntry}`：核心数据结构
- [x] 输出：可 `cargo check` 的空壳 crate ✅ 0 errors / 0 warnings（genai/sqlx 可选 feature，阶段 1.2/1.4 启用）
- [x] 镜像源配置：`.cargo/config.toml` 切换为字节 RsProxy（解决 127.0.0.1:8080 代理劫持）

##### 1.2 实现 LLM 通信层
- [x] 用 genai 封装 `stream_simple()`（等价 pi-ai 的 streamSimple）— `crates/agent-runtime/src/llm/stream.rs`
- [x] 用 genai 封装 `get_model()`（等价 pi-ai 的 getModel）— `crates/agent-runtime/src/llm/stream.rs`
- [x] Provider 配置方案：**调整为运行时注入 `ProviderConfig` + 静态 Manifest**（调研发现 worldsmith 无 SQLite provider 表，原方案不可行）
  - `ProviderConfig` 支持 Cloud / Local / Custom 三种部署模式（`llm/config.rs`）
  - 16 个内置 Provider 静态元数据（`llm/manifest.rs`），含视觉/思考能力检测函数指针
  - `ModelInfo` / `ApiType` / `ModelInput` 类型定义（`llm/model.rs`）
  - `LlmError` 错误类型与 genai::Error 转换（`llm/error.rs`）
- [x] `GenaiBackend` 实现 `NodeBackendAccessor` trait（`llm/genai_backend.rs`）— 串联 prompt/steer/get_messages/set_messages/trim_context
- [x] 编译验收：`cargo check --features llm-genai` 通过 ✅ 0 errors / 1 warning（非阻塞）
- [ ] **端到端验收（推迟到阶段 1.5 Tauri 集成后）**：Rust 侧实际流式调用 DeepSeek/OpenAI/Anthropic，需 API Key 配置

###### 阶段 1.2 完成记录
- **genai 版本**：0.7.0-beta.14（features = ["native-tls"]，禁用默认 rustls-tls 避免 aws-lc-rs 编译依赖）
- **关键 API 适配**（genai 0.7 与文档差异）：
  - `ChatMessage::tool_result` → `ChatMessage::tool(MessageContent::from(ToolResponse::new(call_id, content)))`
  - `ChatRequest::with_messages` → `ChatRequest::new(messages)`
  - `ChatOptions::capture_content()` → `ChatOptions::with_capture_content(true)`
  - `ToolChunk::tool_name` → `ToolCall::fn_name`
  - `Usage::input_tokens` → `Usage::prompt_tokens`
  - `StopReason::StopReasonEndTurn` → `StopReason::Completed(_)`（每个变体带 String 参数）
  - `StreamEnd::captured_into_first_text()` 会消费 `end`，需先 clone `captured_usage` / `captured_stop_reason`
  - `with_temperature(value: f64)` 需要 f64，PromptCallOptions.temperature 是 f32，需 `.into()`
- **环境问题**：
  - NASM 工具安装（aws-lc-rs 编译依赖，后切 native-tls 规避）
  - `.cargo/config.toml` 镜像源切字节 RsProxy（解决 127.0.0.1:8080 代理劫持）
  - PowerShell 5.x 中文路径编码问题，改用 Python 脚本执行 cargo check

##### 1.3 实现 Rust Agent loop
- [x] 实现 `AgentLoop` struct（等价 pi-agent-core 的 Agent）— `crates/agent-runtime/src/agent.rs`
- [x] state 管理：`AgentState`（messages / current_iteration / aborted / paused）+ `AgentLoopConfig`（max_iterations / system_prompt / temperature / max_tokens / parallel_tool_calls / thinking_level）
- [x] 事件流：`EventBroadcaster` + `EventListener` trait（基于 `tokio::sync::RwLock<HashMap>` 订阅模型，对应 TS 版 EventEmitter）
- [x] tool_call 循环：`run_react_loop` 单层循环（LLM 调用 → 工具执行 → 推入 toolResult → 继续循环 → 最终文本）
- [x] 工具执行：`execute_tool_calls` 串行模式（阶段 1.4 启用并行），含 ToolCallStart/ToolCallEnd 事件广播
- [x] 中断机制：`abort()` 方法 + `run` 开始时检查 aborted 状态（不重置，让 abort 持续生效至显式 restore_state）
- [x] 状态快照：`get_state` / `restore_state` / `get_messages`（用于 checkpoint/恢复）
- [x] 编译验收：`cargo check --features llm-genai` 通过 ✅ 0 errors / 0 warnings
- [x] 单元测试：52 个测试全部通过（agent 6 个 + tool 9 个 + llm 24 个 + orchestrator 3 个 + types 2 个 + 其他 8 个）
- [ ] **端到端验收（推迟到阶段 1.5 Tauri 集成后）**：Rust 侧实际跑通 DeepSeek/OpenAI ReAct 循环，需 API Key 配置

###### 阶段 1.3 完成记录
- **AgentLoop 架构**：
  - 持有 `Arc<dyn NodeBackendAccessor>` + `Arc<dyn ToolBus>` + `Arc<AsyncMutex<AgentState>>` + `Arc<RwLock<EventBroadcaster>>`
  - `run(user_input)` 启动 ReAct 循环，返回最终文本
  - `with_config(config)` 链式配置，系统提示词通过 `PromptCallOptions.system_prompt_override` 传给 backend，同时推入 state.messages 供 get_messages() 查看
- **ToolBus 基础实现**（阶段 1.3 提前完成，阶段 1.4 扩展 MCP/别名）：
  - `Tool` trait：`name` / `description` / `parameters` / `execute` / `definition`（默认实现）
  - `ToolBus` trait：`register` / `unregister` / `get_by_name` / `list_all` / `call_tool` / `count`
  - `SimpleToolBus`：基于 `RwLock<HashMap<String, Arc<dyn Tool>>>` 的默认实现
  - `EchoTool`：测试用工具，原样返回输入参数
  - `ToolError` / `ToolDefinition` 类型定义
- **GenaiBackend 适配**（阶段 1.2 已实现，阶段 1.3 联调）：
  - `prompt()` 返回 `PromptResponse`（含 text / tool_calls / input_tokens / output_tokens / stop_reason）
  - ToolCall 聚合状态机：`pending_tool_calls: HashMap<String, ToolCall>` 按 call_id 去重合并
  - 优先使用 `StreamEnd::captured_tool_calls()`，回退到循环中累积的 pending_tool_calls
- **测试覆盖**：
  - `run_returns_final_text_when_no_tool_calls`：无工具调用时返回最终文本
  - `run_executes_tool_calls_then_returns_final_text`：工具调用→toolResult→最终文本完整流程
  - `run_returns_error_when_max_iterations_exceeded`：超过 max_iterations 报错
  - `abort_stops_loop`：先调 abort 再调 run 立即返回 Aborted 错误
  - `run_with_system_prompt_prepends_system_message`：system_prompt 推入 state.messages[0]
  - `tool_failure_does_not_break_loop`：工具执行失败不中断循环，错误作为 toolResult 返回
- **与 TS 版的差异**：
  - 单层循环（TS 版双层）：阶段 1.3 只实现单层 tool_call 循环，外层 follow-up 由调用方驱动
  - 串行工具执行：阶段 1.3 串行，阶段 1.4 启用并行
  - 不传工具定义给 LLM：阶段 1.3 通过系统提示词告知工具列表，阶段 1.4 再接入完整 tools 参数
- **风险点**：
  - 端到端验收推迟到阶段 1.5（需 API Key 配置 + Tauri 集成）
  - `ToolCallChunk` 处理简化为 `debug!` 打印（阶段 1.3 已完成聚合，但未传 tools 定义给 LLM）

###### 阶段 1.3 P0 修复（与前端 IAgentBackend 接口契约对齐）
- **背景**：阶段 1.5 Tauri 集成前复查发现，Rust 侧 `AgentLoop` 缺失前端 `IAgentBackend` 接口的多个方法（steer/follow_up/trim_context/set_runtime_messages/is_streaming/state/dispose/update_model），且 backend 事件未桥接到 AgentLoop 广播器。
- **交付内容**：
  1. **`AgentStateSnapshot`**（[agent.rs](../../crates/agent-runtime/src/agent.rs#L132)）：序列化友好的只读视图，含 current_iteration/aborted/paused/is_streaming/messages/model/thinking_level，对应前端 `IAgentBackend.state`
  2. **IAgentBackend 接口补全**：
     - `steer(text)` → 委托 backend.steer，进入 steer_buffer，下次 prompt 附加为前置 user 消息
     - `follow_up(text)` → 调用 run（保留历史，开始新一轮循环）
     - `clear_history()` → 清空 messages + 重置 current_iteration（保留 aborted）
     - `update_thinking_level(level)` → 同步修改 config.thinking_level
     - `trim_context(up_to_index)` → 同步清理 backend + state.messages（避免状态漂移）
     - `get_runtime_messages()` / `set_runtime_messages(messages)` → 长任务 checkpoint 持久化与断点恢复
     - `is_streaming()` → 基于 `AtomicBool` 读取 run 方法活跃状态
     - `get_state_snapshot()` → 返回 AgentStateSnapshot
     - `update_model(provider, model_id, base_url, api_key, temperature, max_tokens)` → 调用 backend.update_provider 热切换 + 同步更新 config
     - `dispose()` → 清空状态 + 标记 aborted + 重置 is_streaming
  3. **BackendEventBridge**（[agent.rs](../../crates/agent-runtime/src/agent.rs#L905)）：实现 `EventListener` trait，在 `AgentLoop::new` 时 spawn 注入到 backend.subscribe_events，转发 backend 的 StreamStart/StreamDelta/StreamEnd/ToolCallStart/ToolCallEnd 到 AgentLoop 广播器；使用 `try_read` 避免阻塞，锁竞争时丢弃事件
  4. **GenaiBackend 扩展**（[genai_backend.rs](../../crates/agent-runtime/src/llm/genai_backend.rs#L502)）：
     - `subscribe_events(listener)` → 注入监听器到 event_broadcaster
     - `current_model()` → 返回 ProviderConfig.model_id
     - `update_provider(provider, model_id, api_key, base_url)` → 热切换 Cloud/Custom 配置，保留 messages/steer_buffer；Local 返回 Unsupported 错误
  5. **AgentLoop::run 改进**：使用 `backend.current_model()` 替代硬编码 "unknown"，正确广播 AgentStart/StreamStart 模型 ID；通过 `is_streaming` AtomicBool 跟踪 run 活跃状态
  6. **ThinkingLevel 派生 Serialize/Deserialize**（[backend.rs](../../crates/agent-runtime/src/backend.rs)）：#[serde(rename_all = "lowercase")]，支持前端 JSON 通信
- **编译修复**：
  - `genai_backend.rs` 缺少 `use crate::event::EventListener` 导入
  - `Custom` 变体字段对齐：实际为 `base_url/api_key/api_type/model_id/context_window/max_tokens`（无 `provider` 字段），保留旧 api_type/context_window/max_tokens
  - `agent.rs::update_model` 的 `provider`/`model_id` move 后借用问题：调用前 clone
- **验证结果**：
  - `cargo check --features llm-genai` ✅ 0 errors / 0 warnings
  - `cargo test --features llm-genai` ✅ 68/68 通过（含 genai_backend_trim_context / genai_backend_steer / genai_backend_set_get_messages_roundtrip / genai_backend_switch_provider 等 P0 相关测试）
- **与前端接口对齐**：Rust 侧 AgentLoop 现已实现 IAgentBackend 全部方法（steer/followUp/abort/updateModel/updateThinkingLevel/clearHistory/subscribe/dispose/state/isStreaming/trimContext/getRuntimeMessages/setRuntimeMessages），可平滑接入 Tauri IPC

##### 1.4 ToolBus Rust 版（扩展 MCP / 别名 / 并行）
- [x] ~~迁移 [packages/agent-core/src/bus/](../../packages/agent-core/src/bus) 到 Rust~~（阶段 1.3 已完成基础 ToolBus）
- [x] ~~用 `dyn Tool` trait object 替代 TS 的 ToolDefinition~~（阶段 1.3 已完成）
- [x] MCP 服务器工具：`register_mcp_tools` / `unregister_mcp_server`（[mcp.rs](../../crates/agent-runtime/src/mcp.rs)）
- [x] 别名系统（LEGACY_TO_CODING_MAP / LEGACY_ALGO_MAP / LEGACY_PLUGIN_MAP）用 `HashMap<&'static str, &'static str>` + `OnceLock`（[alias.rs](../crates/agent-runtime/src/alias.rs)）
- [~] 技能解析（`SkillRegistry`）— **推迟到阶段 2**，阶段 1.5 Tauri 集成不需要
- [x] 并行工具调用：`config.parallel_tool_calls = true` 时用 `tokio::task::JoinSet` 并发执行（[agent.rs](../../crates/agent-runtime/src/agent.rs)）
- [x] 工具定义传给 LLM：在 `build_chat_request` 中填充 `ChatRequest::with_tools`（[genai_backend.rs](../../crates/agent-runtime/src/llm/genai_backend.rs)）
- [~] 验收：Rust 侧能注册和调用 MCP 工具，并行执行多个工具调用 — **单元测试跳过**（用户决策），仅 `cargo check --features llm-genai` 通过

###### 阶段 1.4 完成记录
- **交付内容**：
  1. `McpTool` + `McpToolAdapter` + `McpCaller` trait + `MockMcpCaller`（测试桩）
  2. `ToolBus` trait 扩展：`register_mcp_tools` / `unregister_mcp_server` / `resolve_alias`（带默认实现）
  3. `SimpleToolBus` 扩展：`mcp_servers` 字段记录 server_id → [tool_name] 映射，支持按服务器注销
  4. 别名系统：三张静态映射表 + `resolve_alias(name)` 懒加载 HashMap + MAX_ALIAS_DEPTH=3 防循环
  5. 并行工具调用：`AgentLoop::execute_tool_calls` 基于 `tokio::task::JoinSet`，按索引排序保证结果顺序
  6. `GenaiBackend::build_chat_request` 注入 `ChatRequest::with_tools`（动态工具定义传 LLM）
- **编译修复**：
  - `lib.rs` 补充 `pub mod alias;` + `pub mod mcp;`（阶段 1.4 新模块未声明导致编译失败）
  - `alias.rs` 迭代解构 `&(k, v)` 修复 `&&str` vs `&str` 类型不匹配
  - `mcp.rs` 删除未使用的 `ToolDefinition` 导入
  - `tool.rs` 默认实现参数 `_server_id` 消除 warning
- **验证结果**：`cargo check --features llm-genai` 通过 ✅ 0 errors / 0 warnings
- **风险点**（用户决策跳过单元测试，留待阶段 1.5 端到端验收暴露）：
  - MCP 工具 `call_tool` / `unregister_mcp_server` 未单测验证
  - 别名系统 `resolve_alias` 深度迭代未单测验证
  - 并行工具调用结果顺序一致性未单测验证

##### 1.5 Tauri 集成
- [x] 将 `crates/agent-runtime` 接入 `src-tauri/Cargo.toml`
- [x] 暴露 Tauri 命令（14 个）：`agent_prompt` / `agent_steer` / `agent_follow_up` / `agent_abort` / `agent_update_model` / `agent_update_thinking_level` / `agent_clear_history` / `agent_subscribe` / `agent_dispose` / `agent_state` / `agent_is_streaming` / `agent_trim_context` / `agent_get_runtime_messages` / `agent_set_runtime_messages`
- [x] 前端 [useAgentRust.ts](../src/agent/composables/useAgentRust.ts) 封装 Tauri invoke + 事件监听
- [x] 集成 `AgentRegistry` 多实例管理（按 sessionId 区分）
- [x] `TauriEventListener` 实现事件桥接（OrchestratorEvent → app.emit）
- [ ] 验收：浏览器经 Tauri 调用 Rust Agent，流式事件回传（推迟到阶段 2.0 端到端实测）

###### 阶段 1.5 完成记录
- 详见 [project_memory.md 阶段 1.5 章节](../../project_memory.md#阶段-15-tauri-集成完成2026-07-25)
- **关键决策**：多实例 AgentRegistry（对齐前端多 session）+ 事件桥接（EventListener trait + app.emit）+ 独立 Payload 类型（解耦前后端）
- **验证**：`cargo check` 通过 ✅ 0 errors / 0 warnings

#### 阶段 1 验收标准
- 模式 1-5 在 Rust 上等价实现，性能优于 TS 版
- ToT/GoT 所需的并行能力可用（tokio::task）
- TS 侧的 bridge.ts 被废弃，pi-ai 依赖移除

---

### 阶段 2：编排框架完整化（路径 2 续）

**前置条件**：阶段 1 完成，Rust Agent loop 稳定

**目标**：在 Rust 上实现剩余的编排模式（6/7/8/9/10/13）

#### 阶段 2 任务清单

##### 2.1 Tree of Thoughts
- [x] 实现 `ThoughtNode`（带评分的思维节点）— `crates/agent-runtime/src/tree_of_thoughts.rs`，含 `parents`/`children` 字段，GoT 聚合节点复用同一结构
- [x] 实现分支探索：`tokio::task::JoinSet` 并发生成多个思维路径 — `expand_layer` 内对 beam 选中的节点并发生成 `branch_factor` 个候选
- [x] 实现回溯：基于评分剪枝 — Beam Search 每层保留 top-K，低分节点被剪枝
- [x] 验收：cargo test tree_of_thoughts:: 全通过；四终止条件（max_depth / max_thoughts / LLM 目标达成 / 评分收敛）+ 6 个 ToT 事件 + 前端 `useToTRust.ts` composable
- **完成时间**：2026-07-28
- **配套**：`commands/tot.rs`（8 个 Tauri 命令：create/run/abort/destroy/get_state/set_state/list_sessions/get_tree）

##### 2.2 Graph of Thoughts
- [x] 扩展 ToT，支持节点间任意连接 — `ThoughtNode.parents` 多父节点字段 + `GraphOfThoughtsNode` 内部 `graph: HashMap<id, ThoughtNode>`
- [x] 实现 `ThoughtGraph` 数据结构 — 直接使用 `HashMap<String, ThoughtNode>` + 邻接关系通过 `parents`/`children` 字段维护
- [x] 支持合并多个思维节点 — `AggregationStrategy` trait + 默认 `LlmAggregationStrategy`，聚合节点 `parents` 包含所有源节点 ID
- [x] 验收：cargo test graph_of_thoughts:: 全通过；GoTNode::new 接收 7 参数（id/name/exploration/scoring/goal_check/aggregation/config，无 backend）；前端 `useGoTRust.ts` composable
- **完成时间**：2026-07-28
- **配套**：`commands/got.rs`（8 个 Tauri 命令：create/run/abort/destroy/get_state/set_state/list_sessions/get_tree）

##### 2.3 Multi-Agent 完善
- [x] 迁移 `useOrchestrator.ts`（原 apps/web 路径，2026-08-08 已删除）到 Rust — `crates/agent-runtime/src/multi_agent.rs` 实现 `MultiAgentNode`
- [x] 用 `tokio::sync::mpsc` 实现 Agent 间通信 — 每 Agent 一个 mpsc receiver，按 topology（mesh/ring/star/pipeline/custom）构建 sender 网络
- [x] 共享黑板板模式（Shared Blackboard）— `SharedBlackboard`（`Arc<RwLock<...>>`）存储全局上下文 + final_result
- [x] 验收：cargo test multi_agent:: 全通过；5 种拓扑 + 3 种收敛条件（MaxRounds/GoalReached/AllAgentsIdle）+ AgentRole 语义标签 + 前端 `useMultiAgentRust.ts` composable
- **完成时间**：2026-07-28
- **配套**：`commands/multi_agent.rs`（8 个 Tauri 命令：create/run/abort/destroy/get_state/set_state/list_sessions/get_blackboard）

##### 2.4 Supervisor Pattern
- [x] 实现 `SupervisorNode`（中心化调度器）— `crates/agent-runtime/src/supervisor.rs`
- [x] 任务分配策略（轮询/负载/能力匹配）— `AssignmentStrategy` trait + 默认 `LlmAssignmentStrategy`（LLM 决策能力匹配）
- [x] 子 Agent 生命周期管理 — Lazy 初始化 + `Arc<RwLock<HashMap>>` 池 + `clear_agent_pool` 命令
- [x] 验收：cargo test supervisor:: 全通过；Supervisor 直接持有 `Arc<AgentLoop>` 池（与 TS 版 AgentRegistry 间接管理不同）+ 前端 `useSupervisorRust.ts` composable
- **完成时间**：2026-07-28
- **配套**：`commands/supervisor.rs`（7 个 Tauri 命令：create/run/abort/destroy/get_state/set_state/list_sessions/clear_agent_pool）

##### 2.5 Router Pattern
- [x] 实现 `RouterNode`（路由节点）— `crates/agent-runtime/src/router.rs`
- [x] 路由规则：基于输入特征/意图分类 — `LlmRoutingStrategy`（默认 LLM 决策）+ `KeywordRoutingStrategy`（关键词匹配）+ 可插拔 `RoutingStrategy` trait
- [x] 支持嵌套路由（路由树）— 通过编排图天然实现：Router A 的 `target.id` 可指向另一个 Router B 节点，Orchestrator 按图调度形成路由树；测试 `nested_router_should_chain_decisions_via_orchestrator_graph` 已验证
- [x] 验收：cargo check + cargo test router:: (16/16 通过) + vue-tsc 0 errors；前端 `useRouterRust.ts` 提供完整 composable（create/run/abort/destroy/getState/setState/listSessions/getTargets + 事件订阅）
- **完成时间**：2026-07-28
- **配套**：`agent_bridge/router_registry.rs`（注册表）+ `commands/router.rs`（8 个 Tauri 命令，已注册到 `lib.rs` invoke_handler）

##### 2.6 Loop Engineering
- [x] 通用循环控制：中断/恢复/重试/超时/限流 — `crates/agent-runtime/src/loop_control.rs` 实现 `LoopController`（RateLimiter + RetryPolicy + SoftTimeout + Watchdog），协作式软限制（`should_stop()`/`should_retry()` 返回建议）
- [x] 检查点持久化（迁移 `longTaskStore.ts`，原 apps/web 路径 2026-08-08 已删除）— `crates/agent-runtime/src/long_task.rs` 实现 `LongTaskManager`（任务生命周期 + checkpoint 保存/加载 + heartbeat），前端 `useLongTaskRust.ts` composable
- [x] 心跳与看门狗 — `Watchdog` 配置（默认 5min 无活动触发恢复）+ `update_heartbeat` 命令 + `update_activity` 接口
- [x] 验收：cargo test loop_control:: + long_task:: 全通过；9 个 loop_control 命令（create/check/record_turn/record_tool_call/record_tokens/update_activity/reset_counters/get_config/get_status/destroy/list_tasks）+ 7 个 long_task 命令（save/load/list_running/list_all/update_heartbeat/update_status/delete）+ 前端 `useLoopControlRust.ts` + `useLongTaskRust.ts` composable
- **完成时间**：2026-07-28
- **配套**：`commands/loop_control.rs` + `commands/long_task.rs`（共 16 个 Tauri 命令，已注册到 `lib.rs` invoke_handler）

---

**阶段 2 整体完成**：所有 6 个子任务（2.1-2.6）均已实现并验证通过。
- **总验收**：cargo check 0 errors / cargo test 127/127 通过 / vue-tsc 0 errors
- **统一架构**：所有节点实现 `OrchestratorNode` trait，通过 `NodeContext` 共享 state/backend/memory/emitter/abort_check，事件复用 `OrchestratorEvent` 枚举变体
- **前端统一接口**：6 个 composable（useToTRust/useGoTRust/useMultiAgentRust/useSupervisorRust/useRouterRust/useLoopControlRust）+ useLongTaskRust，均提供 create/run/abort/destroy/get_state/set_state + 事件订阅

#### 阶段 2 验收标准
- 13 种模式全部可用
- 编排框架与 LangGraph 等价能力
- 单二进制部署，性能/稳定性优于 TS 版

---

### 阶段 3（可选）：自研 Rust pi-ai（路径 1）

**前置条件**：阶段 2 完成，且 genai 的限制成为瓶颈

**目标**：如 genai 限制太大，自研完全可控的 LLM 通信层

**决策点**：只有在以下情况才启动
- genai 无法支持某个关键 Provider 的特性
- genai 维护停滞
- 需要 genai 不支持的高级特性（如自定义协议）

## 五、技术选型记录

### 5.1 阶段 0（当前）
- **语言**：TypeScript
- **依赖**：pi-ai ^0.79.10、pi-agent-core latest
- **新增**：`packages/agent-core/src/orchestrator/`（纯 TS 抽象层）

### 5.2 阶段 1-2（规划）
- **语言**：Rust
- **LLM 通信**：genai（26+ Provider 原生支持）
- **异步运行时**：tokio
- **数据库**：SQLite（sqlx，复用现有项目隔离方案）
- **新增 crate**：`crates/agent-runtime/`

### 5.3 阶段 3（可选）
- **LLM 通信**：自研（reqwest + eventsource-stream）
- **触发条件**：genai 成为瓶颈时

## 六、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| pi-agent-core 单循环限制 | 阶段 0 的 ToT/GoT 难做 | 阶段 0 只做模式 1-5，ToT/GoT 推迟到阶段 2 |
| genai <1.0 breaking changes | 阶段 1 迁移成本 | Cargo.toml 锁版本号，CI 加 `cargo update --dry-run` |
| TS→Rust 迁移期双架构维护 | 短期复杂度 | 阶段 0 的 Orchestrator 接口设计为可平滑迁移 |
| 工具迁移工作量（40+ 工具） | 阶段 1 周期长 | 工具逐步迁移，关键工具优先，非关键工具保留 TS 桥接 |
| 国产模型 API 变更 | Provider 适配失效 | genai 原生支持 DeepSeek/Aliyun，由 genai 维护 |

## 七、里程碑

| 里程碑 | 预期内容 | 状态 |
|--------|----------|------|
| M0 | 阶段 0 完成：TS 编排框架，模式 1-5 可用 | ✅ 已跳过（Rust 路线直接实现，TS 仅保留部分产出） |
| M1 | 阶段 1 完成：Rust Agent loop，pi-ai 移除 | ✅ 已完成（2026-07-25 Tauri 集成，cargo check 0 errors；pi-ai 依赖保留在 TS 端作为备用） |
| M2 | 阶段 2 完成：13 模式全可用，Rust 编排框架 | ✅ 已完成（2026-07-28，ToT/GoT/Multi-Agent/Supervisor/Router/Loop 6 模式 + AgentLoop 基础 loop；cargo test 127/127） |
| M3 | 阶段 3（如需）：自研 pi-ai | ⏳ 可选（genai 未成瓶颈前不启动） |

> **待办**（阶段 1/2 验收未闭环部分）：
> - Rust Agent 端到端实测：浏览器切换 Rust 后端，验证流式对话/长任务/编排模式（部分已通过：长任务 startTask/心跳/checkpoint/SQLite 持久化 2026-08-02）
> - failTask 终态闭环（Rust 长任务，2026-08-02 待收敛后干净环境重测）
> - 深度模式 / A2UI / 终端 / 子 Agent 补齐（Rust 后端高级能力）
> - TS→Rust 迁移完成度：pi-ai 依赖移除尚未执行（TS 后端仍可用作兜底）

## 八、参考资料

- [pi 官方仓库](https://github.com/earendil-works/pi)（TS 版，无官方 Rust）
- [genai crate](https://crates.io/crates/genai)（阶段 1 选型）
- [rig crate](https://crates.io/crates/rig)（备选）
- [LangGraph](https://github.com/langchain-ai/langgraph)（编排框架参考）
- [当前 TS 架构调研报告](./agent-ts-architecture-survey.md)（如有）

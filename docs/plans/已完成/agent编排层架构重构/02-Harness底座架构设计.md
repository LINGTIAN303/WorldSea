---
status: 已完成   # 文档已完稿；方案经 2026-08-25 两方裁定未采纳，归档为备选参考
date: 2026-08-25
depends_on: 01-编排模式矩阵表.md
---

# Harness 底座架构设计

> **归档声明（2026-08-25 裁定）**：本方案核心主张——SessionRuntime 九子系统、ReAct 抽离为
> ReactNode、ExtensionRegistry 替代 NodeType、SubAgent 节点化、harness/patterns/infra 三层目录——
> 经两方裁定**全部未采纳**（子 Agent 语义悬空 / 回归风险与收益倒挂 / 扩展通道本就是 trait /
> 消灭自主委派语义 / infra 层无收益）。仅其合理内核「织入点协议化」降级列入权威矩阵
> [orchestration-matrix.md](../../../details/架构/orchestration-matrix.md) §8 里程碑 5。
> 施工以 matrix 为准；本文档仅作未采纳备选存档，防止未来重提时遗漏已否决的理由。
> 详见 [03-两方方案裁定纪要.md](03-两方方案裁定纪要.md)。

> 本文档是「Agent 编排层架构重构」的第二步：定义 Harness 底座的核心能力、接口边界、
> 层间契约，以及编排扩展层的接入方式。目标是让底座**承载编排层但不依赖编排层**，
> 离了编排层也能独立运行，同时可承载其他类扩展层。

---

## 一、设计目标与原则

### 1.1 核心目标

| 目标 | 说明 |
|------|------|
| **底座独立** | Harness 不依赖任何编排模式，移除编排层后仍能编译运行（提供最小 ReAct 或纯 LLM 调用） |
| **编排可插拔** | 13 种模式各自独立模块，通过注册表接入，新增模式不改底座代码 |
| **层间解耦** | 底座只定义 trait/接口，编排层只依赖接口不依赖实现 |
| **可承载其他层** | 底座的扩展机制不局限于编排模式，未来可接入记忆层、技能层、治理层等 |
| **迁移渐进** | 不一次性重写，按模式逐个迁移，每个阶段可编译可测试 |

### 1.2 设计原则

1. **依赖单向**：编排层 → 底座，禁止底座 → 编排层
2. **接口隔离**：每个扩展能力定义独立 trait，不搞上帝接口
3. **组合优于继承**：通过组合扩展能力，不通过继承 AgentLoop
4. **状态集中**：所有扩展共享同一个 State，通过 Channel 机制读写
5. **事件驱动**：扩展间通过事件总线通信，不直接调用

---

## 二、三层架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  应用层 (Application)                                        │
│  Tauri 命令层 / 前端 / 会话管理 / 场景配置                    │
│  → 组装 Harness + 选择编排模式 + 注入配置                     │
├─────────────────────────────────────────────────────────────┤
│  扩展层 (Extensions) — 可插拔，互不依赖                       │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ 编排模式层         │  │ 其他扩展层         │                │
│  │ (13种模式独立模块)  │  │ (记忆/技能/治理)   │                │
│  │ React/Plan/ToT/... │  │                   │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │ 通过 ExtensionRegistry 接入                        │
├───────────┼──────────────────────┼──────────────────────────┤
│           ▼                      ▼                            │
│  Harness 底座 (Core) — 无扩展也能运行                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  SessionRuntime  会话运行时容器                        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ State    │ │ EventBus │ │ Lifecycle│            │   │
│  │  │ Manager  │ │          │ │ Manager  │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ Backend  │ │ ToolBus  │ │ Context  │            │   │
│  │  │ Accessor │ │          │ │ Assembler│            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ LoopCtrl │ │ Extension│ │ Config   │            │   │
│  │  │          │ │ Registry │ │          │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 各层职责

| 层 | 职责 | 不做什么 |
|----|------|---------|
| **Harness 底座** | 提供运行时容器、状态管理、事件总线、LLM后端、工具总线、上下文组装、循环控制、扩展注册表、生命周期管理 | 不包含任何具体编排逻辑（不调LLM决策、不执行工具循环、不规划任务） |
| **编排扩展层** | 实现具体的编排模式（ReAct/Plan/ToT等），通过 OrchestratorNode trait 接入 | 不直接管理状态/事件/后端，只通过 Harness 接口访问 |
| **应用层** | 组装 Harness 实例、选择编排模式、注入配置、连接前端 | 不实现编排逻辑，不操作底层状态 |

---

## 三、Harness 底座核心能力

### 3.1 能力清单

底座包含 **9 个核心子系统**，每个子系统定义独立 trait：

| # | 子系统 | 职责 | 对应现有代码 |
|---|--------|------|-------------|
| 1 | **StateManager** | 共享状态的读写、快照、恢复、通道(Channel)注册 | `types.rs`(OrchestratorState) + `orchestrator.rs`(state锁) |
| 2 | **EventBus** | 事件发布/订阅、事件类型注册、事件转发 | `event.rs`(EventBroadcaster) |
| 3 | **BackendAccessor** | LLM 调用、消息同步、流式输出、模型管理 | `backend.rs` + `llm/` |
| 4 | **ToolBus** | 工具注册、工具调用、工具白名单、工具钩子 | `tool.rs` + `tool_context.rs` + `tool_hook.rs` |
| 5 | **ContextAssembler** | system prompt 组装、消息历史管理、上下文压缩 | `agent/llm.rs`(build_prompt_options) + `memory.rs`(短期/工作记忆) |
| 6 | **LoopController** | 限流、重试、软超时、看门狗、最大迭代 | `loop_control.rs` |
| 7 | **ExtensionRegistry** | 扩展注册/查找/枚举、模式元数据管理 | **新增**（替代 NodeType 封闭枚举） |
| 8 | **LifecycleManager** | 会话创建/销毁、暂停/恢复、中断、checkpoint | `agent/mod.rs`(run/abort/dispose) + `long_task.rs` |
| 9 | **ConfigStore** | 配置读写、运行时配置更新、配置快照 | `agent/config.rs`(AgentLoopConfig) |

### 3.2 关键接口定义

#### 3.2.1 SessionRuntime（底座主入口）

```rust
/// 会话运行时 — Harness 底座的主容器
///
/// 替代当前的 AgentLoop。本身不包含任何编排逻辑，
/// 只提供运行时基础设施。编排能力通过 ExtensionRegistry 注入。
pub struct SessionRuntime {
    state: Arc<StateManager>,
    events: Arc<EventBus>,
    backend: Arc<dyn BackendAccessor>,
    tools: Arc<dyn ToolBus>,
    context: Arc<ContextAssembler>,
    loop_ctrl: Arc<LoopController>,
    extensions: Arc<ExtensionRegistry>,
    lifecycle: Arc<LifecycleManager>,
    config: Arc<ConfigStore>,
}

impl SessionRuntime {
    /// 创建空的运行时（无任何编排扩展，仅底座能力）
    pub fn new(backend: Arc<dyn BackendAccessor>, tools: Arc<dyn ToolBus>) -> Self;

    /// 注册扩展（编排模式/记忆层/技能层等）
    pub fn register_extension(&self, extension: Arc<dyn Extension>);

    /// 获取扩展引用
    pub fn get_extension(&self, id: &str) -> Option<Arc<dyn Extension>>;

    /// 运行指定编排模式（通过扩展ID查找）
    pub async fn run_pattern(&self, pattern_id: &str, input: String) -> Result<RunResult, RuntimeError>;

    /// 直接调用 LLM（底座最小能力，无需编排扩展）
    pub async fn call_llm(&self, prompt: String) -> Result<String, BackendError>;
}
```

#### 3.2.2 Extension trait（扩展统一接入接口）

```rust
/// 扩展 trait — 所有扩展层（编排模式/记忆层/技能层）的统一接入接口
///
/// 替代当前的 NodeType 封闭枚举。每个扩展有唯一 ID、元数据、
/// 以及可选的 OrchestratorNode 实现。
#[async_trait]
pub trait Extension: Send + Sync {
    /// 扩展唯一 ID（如 "react"、"plan-execute"、"tot"）
    fn id(&self) -> &str;

    /// 扩展名称（人类可读）
    fn name(&self) -> &str;

    /// 扩展描述
    fn description(&self) -> &str;

    /// 扩展类型（编排模式/记忆层/技能层/治理层）
    fn kind(&self) -> ExtensionKind;

    /// 如果是编排模式，返回 OrchestratorNode 实例
    fn as_orchestrator_node(&self) -> Option<Arc<dyn OrchestratorNode>> { None }

    /// 扩展初始化（注册到 SessionRuntime 时调用）
    async fn on_register(&self, runtime: &SessionRuntime) -> Result<(), ExtensionError> { Ok(()) }

    /// 扩展销毁（SessionRuntime 销毁时调用）
    async fn on_unregister(&self) { }
}

/// 扩展类型枚举
pub enum ExtensionKind {
    /// 编排模式（ReAct/Plan/ToT等）
    Orchestration,
    /// 记忆扩展
    Memory,
    /// 技能扩展
    Skill,
    /// 治理扩展（guardrails/审核）
    Governance,
    /// 其他
    Other,
}
```

#### 3.2.3 OrchestratorNode trait（编排节点接口，重构版）

```rust
/// 编排节点接口 — 所有编排模式的基础构建块
///
/// 与当前版本的区别：
/// 1. 去掉 NodeType（改用 Extension.id() 标识）
/// 2. NodeContext 改为持有 SessionRuntime 引用而非零散字段
/// 3. 增加 reset 默认实现
#[async_trait]
pub trait OrchestratorNode: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;

    /// 执行节点逻辑
    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult;

    /// 重置节点状态（默认空实现）
    fn reset(&mut self) {}
}

/// 节点执行上下文 — 重构版
///
/// 持有 SessionRuntime 引用，节点通过 runtime 访问所有底座能力。
/// 不再零散传入 backend/memory/emitter/abort_check。
pub struct NodeContext<'a> {
    pub runtime: &'a SessionRuntime,
    pub state: &'a mut OrchestratorState,
}
```

#### 3.2.4 OrchestratorEngine（图执行引擎，底座的一部分）

```rust
/// 编排图执行引擎 — 底座的一部分，负责驱动节点图执行
///
/// 替代当前的 DefaultOrchestrator。它本身不包含任何编排逻辑，
/// 只负责按图遍历节点、管理执行状态、广播事件。
/// 节点（编排模式）通过 ExtensionRegistry 提供。
pub struct OrchestratorEngine {
    nodes: HashMap<String, Arc<dyn OrchestratorNode>>,
    edges: Vec<OrchestratorEdge>,
    entry: Option<String>,
    runtime: Arc<SessionRuntime>,
}

impl OrchestratorEngine {
    pub fn new(runtime: Arc<SessionRuntime>) -> Self;

    /// 从扩展注册表加载节点（按扩展ID）
    pub fn load_node_from_extension(&mut self, extension_id: &str) -> Result<(), EngineError>;

    pub fn add_edge(&mut self, edge: OrchestratorEdge);
    pub fn set_entry(&mut self, node_id: &str);

    /// 执行图
    pub async fn run(&self, input: String) -> Result<OrchestratorResult, EngineError>;
}
```

---

## 四、编排扩展层设计

### 4.1 模块组织

每个编排模式是一个**独立模块**，统一实现 `Extension` trait：

```
crates/agent-runtime/src/
├── harness/                    # ★ Harness 底座（新增目录）
│   ├── mod.rs                  # SessionRuntime 主入口
│   ├── state.rs                # StateManager
│   ├── event.rs                # EventBus
│   ├── backend.rs              # BackendAccessor trait
│   ├── tool.rs                 # ToolBus trait
│   ├── context.rs              # ContextAssembler
│   ├── loop_control.rs         # LoopController
│   ├── extension.rs            # Extension trait + ExtensionRegistry
│   ├── lifecycle.rs            # LifecycleManager
│   ├── config.rs               # ConfigStore
│   └── engine.rs               # OrchestratorEngine（图执行引擎）
│
├── patterns/                   # ★ 编排扩展层（新增目录，13种模式独立模块）
│   ├── mod.rs                  # 模式注册汇总
│   ├── react/                  # ReAct 模式（从 AgentLoop 抽离）
│   │   ├── mod.rs
│   │   ├── node.rs             # ReactNode（实现 OrchestratorNode + Extension）
│   │   └── config.rs
│   ├── plan_execute/           # Plan + Execute 模式
│   │   ├── mod.rs
│   │   ├── plan_node.rs
│   │   ├── execute_node.rs
│   │   └── config.rs
│   ├── reflection_refine/      # Reflection + Refine 模式
│   │   ├── mod.rs
│   │   ├── reflection_node.rs
│   │   ├── refine_node.rs
│   │   └── config.rs
│   ├── router/                 # Router 模式
│   │   ├── mod.rs
│   │   ├── node.rs
│   │   └── strategies.rs
│   ├── supervisor/             # Supervisor 模式
│   │   ├── mod.rs
│   │   ├── node.rs
│   │   └── sub_agent_spec.rs   # SubAgentSpec 移到这里
│   ├── sub_agent/              # ★ SubAgent 模式（从工具委派改为节点）
│   │   ├── mod.rs
│   │   ├── node.rs
│   │   └── manager.rs          # SubAgentManager 移到这里
│   ├── tree_of_thoughts/       # ToT 模式
│   │   ├── mod.rs
│   │   ├── node.rs
│   │   ├── thought.rs          # ThoughtNode 类型（GoT 可复用）
│   │   └── strategies.rs
│   ├── graph_of_thoughts/      # GoT 模式
│   │   ├── mod.rs
│   │   ├── node.rs
│   │   └── aggregation.rs
│   ├── multi_agent/            # MultiAgent 模式
│   │   ├── mod.rs
│   │   ├── node.rs
│   │   ├── blackboard.rs
│   │   └── strategies.rs
│   ├── memory/                 # Memory 模式（如需要节点化）
│   │   └── mod.rs
│   └── custom/                 # Custom 扩展点
│       └── mod.rs
│
├── infra/                      # ★ 基础设施（从根目录移入，非编排非底座）
│   ├── mod.rs
│   ├── llm/                    # LLM 后端实现（genai_backend/stream/config）
│   ├── memory/                 # MemoryAccessor trait + 实现
│   ├── long_task.rs            # 长任务管理
│   ├── confirmation.rs         # HITL 确认
│   ├── deep_phases.rs          # Deep Mode 阶段判定
│   ├── mcp.rs                  # MCP 协议
│   ├── a2ui.rs                 # A2UI 适配
│   ├── alias.rs                # 类型别名
│   └── scenario.rs             # 场景插件
│
└── lib.rs                      # 模块汇总 + 公共导出
```

### 4.2 模式注册机制

每个模式模块导出一个 `register` 函数，应用层在启动时调用：

```rust
// patterns/mod.rs
pub fn register_all_patterns(runtime: &SessionRuntime) {
    runtime.register_extension(Arc::new(react::ReactPattern::new()));
    runtime.register_extension(Arc::new(plan_execute::PlanExecutePattern::new()));
    runtime.register_extension(Arc::new(reflection_refine::ReflectionRefinePattern::new()));
    // ... 其余模式
}

// 单个模式的实现示例
pub struct ReactPattern {
    config: ReactConfig,
}

#[async_trait]
impl Extension for ReactPattern {
    fn id(&self) -> &str { "react" }
    fn name(&self) -> &str { "ReAct" }
    fn description(&self) -> &str { "思考-行动-观察循环，基础工具调用模式" }
    fn kind(&self) -> ExtensionKind { ExtensionKind::Orchestration }

    fn as_orchestrator_node(&self) -> Option<Arc<dyn OrchestratorNode>> {
        Some(Arc::new(ReactNode::new(self.config.clone())))
    }
}
```

### 4.3 模式间公共工具提取

当前跨模式耦合的工具函数提取到底座或公共层：

| 当前位置 | 函数 | 目标位置 | 说明 |
|---------|------|---------|------|
| `plan.rs` | `extract_json_array` | `harness/util.rs` 或 `infra/json_util.rs` | JSON 解析工具，所有模式可用 |
| `plan.rs` | `extract_json_object` | 同上 | 同上 |
| `plan.rs` | `extract_code_block` | 同上 | 代码块提取 |
| `tree_of_thoughts/` | `ThoughtNode` | `patterns/tree_of_thoughts/thought.rs`（公开导出） | GoT 通过公开类型复用，而非 import 内部 |
| `tree_of_thoughts/` | `ToTConfig` | 同上 | 同上 |
| `tree_of_thoughts/` | `ToTError` | 同上 | 同上 |

---

## 五、关键重构方案

### 5.1 ReAct 从 AgentLoop 抽离

**当前问题**：ReAct 循环内嵌在 `AgentLoop::run_react_loop()` 中，与底座的 state/event/backend/tool/memory/loop_control/deep_phases 全部耦合。

**抽离方案**：

1. **AgentLoop → SessionRuntime**：将 AgentLoop 中所有非 ReAct 的能力（state管理/event/backend/tool/config/lifecycle）提取为 SessionRuntime
2. **ReAct 循环 → ReactNode**：将 `run_react_loop()` 的逻辑提取为独立的 `ReactNode`，实现 `OrchestratorNode` trait
3. **织入能力改为中间件**：当前直接织入 run() 的能力（Router/Memory/LoopControl/DeepPhases）改为通过 Extension 或 Hook 机制注入

```
抽离前：
  AgentLoop.run()
    ├── 记忆 recall/inject（织入）
    ├── Router 决策（织入）
    ├── 推入 user 消息
    └── run_react_loop()  ← ReAct 逻辑混在这里
          ├── LLM 调用
          ├── 工具执行
          ├── LoopControl 检查
          ├── DeepPhase 判定
          └── checkpoint 更新

抽离后：
  SessionRuntime.run_pattern("react", input)
    ├── LifecycleManager 初始化
    ├── StateManager 重置状态
    └── OrchestratorEngine.run()
          └── ReactNode.execute()  ← 纯 ReAct 逻辑
                ├── 通过 ctx.runtime.backend 调 LLM
                ├── 通过 ctx.runtime.tools 执行工具
                ├── 通过 ctx.runtime.loop_ctrl 检查
                └── 通过 ctx.runtime.events 广播事件

  （Router/Memory/DeepPhases 作为独立 Extension 或 Hook，
    在 ReactNode 执行前后由 OrchestratorEngine 触发）
```

**迁移难度**：高。需要仔细拆分 933 行的 AgentLoop，确保每个能力正确归属。

### 5.2 SubAgent 统一为 OrchestratorNode

**当前问题**：SubAgent 不是 OrchestratorNode，而是通过 `SubAgentManager` 注册工具实现委派。与 Supervisor 功能重叠，两套子 Agent 管理逻辑并存。

**统一方案**：

1. **SubAgentManager → SubAgentNode**：将 SubAgentManager 的核心逻辑封装为 `SubAgentNode`，实现 `OrchestratorNode` + `Extension`
2. **工具委派保留为可选模式**：SubAgentNode 内部仍可注册 `delegate_to_sub_agent` 工具，但管理器逻辑归到模式模块内
3. **Supervisor 与 SubAgent 明确分工**：
   - **Supervisor**：编排图节点，显式调度，适合预定义流程
   - **SubAgent**：编排图节点 + 工具注册，隐式调用，适合动态委派
4. **SubAgentSpec 统一**：当前 SubAgentSpec 定义在 supervisor.rs，移到公共位置（如 `patterns/common/sub_agent.rs`），两个模式共享

### 5.3 NodeType 封闭枚举 → ExtensionRegistry

**当前问题**：NodeType 是封闭枚举，新增模式必须改 node.rs。Custom 占位是唯一扩展通道。

**替换方案**：

1. **移除 NodeType 枚举**：OrchestratorNode trait 不再要求 `node_type()` 方法
2. **模式标识用 Extension.id()**：每个模式通过 Extension trait 的 `id()` 唯一标识
3. **ExtensionRegistry 管理所有扩展**：支持注册/查找/枚举，运行时可动态加载
4. **序列化兼容**：需要序列化节点类型时，用 Extension.id() 字符串替代 NodeType 枚举

---

## 六、底座最小可运行验证

Harness 底座在**无任何编排扩展**时应能独立运行，提供最小能力：

```rust
// 最小用法：无编排扩展，直接调 LLM
let runtime = SessionRuntime::new(backend, tools);
let response = runtime.call_llm("你好".into()).await?;
// → 直接返回 LLM 响应，不经过任何编排循环

// 注册 ReAct 扩展后
runtime.register_extension(Arc::new(ReactPattern::default()));
let result = runtime.run_pattern("react", "帮我查天气".into()).await?;
// → 经过 ReAct 循环（思考→工具→观察）
```

**验证标准**：
- `cargo check -p agent-runtime --no-default-features`（无编排模式特性）能通过
- SessionRuntime 不 import 任何 patterns/ 下的模块
- 移除 patterns/ 目录后底座仍能编译

---

## 七、迁移路径（分阶段）

### 阶段 1：底座骨架搭建（不改现有代码）

- 新建 `harness/` 目录，定义所有 trait 接口
- 新建 `patterns/` 目录结构
- 新建 `infra/` 目录结构
- 所有新文件用 `#[allow(dead_code)]` 标记，不影响现有编译
- **交付物**：trait 定义 + 目录结构 + 编译通过

### 阶段 2：基础设施迁移

- 将 `llm/`、`memory.rs`、`long_task.rs`、`confirmation.rs`、`deep_phases.rs`、`mcp.rs`、`a2ui.rs`、`alias.rs`、`scenario.rs` 移入 `infra/`
- 保留旧路径的 re-export 确保不破坏现有引用
- **交付物**：infra/ 目录完整 + 所有测试通过

### 阶段 3：简单模式迁移（低难度）

- 按 `plan_execute/` → `reflection_refine/` → `router/` 顺序迁移
- 每个模式实现 Extension trait，移入 patterns/ 对应目录
- 提取公共 JSON 工具到 harness/util.rs
- **交付物**：3 个模式迁移完成 + 测试通过

### 阶段 4：中等难度模式迁移

- `supervisor/` → `tree_of_thoughts/` → `graph_of_thoughts/`
- ToT 类型公开导出，GoT 通过公开类型复用
- SubAgentSpec 移到公共位置
- **交付物**：3 个模式迁移完成 + 测试通过

### 阶段 5：高难度模式迁移

- `react/`：从 AgentLoop 抽离 ReAct 循环
- `sub_agent/`：SubAgentManager → SubAgentNode
- `multi_agent/`：最深耦合的模式
- AgentLoop → SessionRuntime 重命名
- **交付物**：3 个模式迁移完成 + AgentLoop 瘦身完成

### 阶段 6：底座独立验证 + 清理

- 移除 NodeType 枚举
- 移除旧路径 re-export
- 验证 `--no-default-features` 编译通过
- 更新所有文档和注释
- **交付物**：完整重构 + 底座独立可运行

---

## 八、风险点

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **AgentLoop 拆分引入回归** | ReAct 主链路可能出 bug | 阶段5 前保持 AgentLoop 兼容，拆分后逐功能对比测试 |
| **前端依赖 NodeType 序列化** | 前端可能用 node_type 字段做判断 | 用 Extension.id() 字符串替代，保持前端兼容映射 |
| **SubAgent 工具委派改节点后行为变化** | 主 Agent 可能无法自主委派 | 保留工具注册作为 SubAgentNode 的可选能力 |
| **迁移周期长** | 6 个阶段可能跨越多周 | 每阶段独立可交付，中间状态可编译可测试 |
| **GoT 对 ToT 内部类型的深度依赖** | 解耦可能需要重写 GoT | ToT 类型公开导出为共享类型，GoT 通过公开 API 复用 |

---

## 九、待确认决策点

以下决策需要用户确认后再进入实施：

1. **ReAct 抽离后，织入能力（Router/Memory/DeepPhases）走什么机制？**
   - 方案 A：OrchestratorEngine 的 before/after Hook
   - 方案 B：独立 Extension，在 ReactNode 内部显式调用
   - 方案 C：ContextAssembler 统一处理（只影响 prompt，不影响执行流）

2. **SubAgent 是否保留工具委派模式？**
   - 方案 A：完全改为 OrchestratorNode，去掉工具委派
   - 方案 B：OrchestratorNode + 可选工具注册（双模式）
   - 方案 C：保留工具委派，不作为编排模式（从13种中移除）

3. **NodeType 枚举是否完全移除？**
   - 方案 A：完全移除，用 Extension.id() 替代
   - 方案 B：保留为兼容层（内部映射到 Extension.id()）
   - 方案 C：保留但改为开放枚举（`#[non_exhaustive]` + Custom 携带 id）

4. **目录重组是在 agent-runtime crate 内完成，还是拆分 crate？**
   - 方案 A：agent-runtime 内分目录（harness/patterns/infra）
   - 方案 B：拆分为 agent-harness / agent-patterns / agent-infra 三个 crate
   - 方案 C：先内部分目录，后续再考虑拆 crate

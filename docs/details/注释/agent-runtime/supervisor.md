# supervisor.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/supervisor.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 supervisor_tests.rs

## 注释块 1（原文件第 1-29 行）

# Supervisor Pattern — 监督者编排模式

实现 Supervisor Pattern：中央协调者（Supervisor）接收用户任务，
通过 LLM 决策将任务分配给最合适的子 Agent（SubAgent）执行，
汇总子 Agent 结果后返回给用户。

## 架构

```text
用户输入
   ↓
SupervisorNode.execute
   ├─ 1. AssignmentStrategy.assign(task, specs, backend) → AssignmentResult
   ├─ 2. 从池中获取/创建子 AgentLoop
   ├─ 3. agent.run(task_description) → String
   ├─ 4. 收集子 Agent 输出 → state.messages
   └─ 5. 返回 NodeResult（Continue/Done）
```

## 关键设计

- **共享 backend**：所有子 Agent 使用同一个 `NodeBackendAccessor`（父 Orchestrator 的）
- **共享 ToolBus**：所有子 Agent 共用父 `ToolBus`（FrontendToolBridge）
- **独立 system_prompt**：每个子 Agent 用自己的 system_prompt 实现专长
- **LLM 决策分配**：默认 `LlmAssignmentStrategy`，可注入自定义策略
- **Lazy 初始化**：子 Agent 实例在首次调用时创建并缓存，避免预先创建未使用的 Agent

## 与 TS 版的差异

- Rust 版 SupervisorNode 直接持有 `Arc<AgentLoop>` 池，TS 版通过 AgentRegistry 间接管理
- 阶段 1.2 不转发子 Agent 流式事件到父 Orchestrator（前端通过 SupervisorEvent 摘要了解进度）
- 阶段 1.3 可扩展为通过 LLM 生成 summary（当前用简单拼接）

---

## 注释块 2（原文件第 292-306 行）

轮询分配策略 — 按顺序循环选择子 Agent

不调用 LLM，纯本地决策。适用于：
- 子 Agent 能力相近，无需 LLM 判断
- 需要均衡分配任务量（简单轮询）
- 低延迟场景（避免 LLM 调用开销）

## 行为

- 第 1 次 assign → candidates[0]
- 第 2 次 assign → candidates[1]
- ...
- 第 N 次 assign → candidates[(N-1) % len]

## 线程安全

内部使用 `AtomicUsize` 计数器，可安全跨线程共享。

---

## 注释块 3（原文件第 368-384 行）

负载均衡分配策略 — 选择累计分配次数最少的子 Agent

不调用 LLM，纯本地决策。适用于：
- 子 Agent 处理能力不同（部分 Agent 处理慢，应少分配）
- 长期运行场景（需要均衡各子 Agent 的总任务量）

## 负载语义

本策略跟踪的是"累计分配次数"（非实时并发数），因为
`AssignmentStrategy::assign` 无法感知子 Agent 何时完成执行。
适用于"任务量均衡"语义；如需"实时并发均衡"，需在 SupervisorNode
层集成并发计数（阶段 2.x 扩展）。

## 平局处理

多个候选负载相同时，选择 ID 字典序最小的（保证确定性，便于测试）。

## 线程安全

内部使用 `Mutex<HashMap<String, u64>>` 跟踪计数，可安全跨线程共享。

---

## 注释块 4（原文件第 467-480 行）

最大协调轮次（防止无限循环，默认 5）

每轮包含：任务分配 + 子 Agent 执行 + 结果收集。
- `max_rounds = 1`：单轮模式（阶段 1.2 行为，assign + run 一次即返回）
- `max_rounds > 1`：多轮协调模式，每轮基于上一轮子 Agent 输出继续推进任务，
  直到达成 `max_rounds`、外部中断或子 Agent 输出包含 `[TASK_COMPLETE]` 标记

## 多轮语义

多轮模式适用于需要多个子 Agent 接力完成的复杂任务：
- 轮 1：coder 编写代码 → 输出代码
- 轮 2：reviewer 审查代码 → 输出审查意见 + [TASK_COMPLETE]
- 轮 3：coder 修复问题 → 输出最终代码 + [TASK_COMPLETE]

每轮的 `task` 由 Supervisor 改写：拼接原任务 + 上一轮输出 + 继续指令。

---

## 注释块 5（原文件第 517-557 行）

SupervisorNode — 监督者节点

在编排图中作为一个节点存在，被 Orchestrator 调度执行时：
1. 接收当前任务（从 `state.input` 或上一节点输出）
2. 通过 `AssignmentStrategy` 选择子 Agent
3. 调用子 Agent 的 `AgentLoop::run`
4. 收集子 Agent 输出，写入 `state.messages`
5. 返回 `Continue`（让 Orchestrator 按边查找下一节点）或 `Done`

# 使用示例

```rust,ignore
use agent_runtime::supervisor::{SupervisorNode, SubAgentSpec, SupervisorConfig};

let specs = vec![
    SubAgentSpec {
        id: "coder".into(),
        name: "代码专家".into(),
        description: "处理代码编写、调试、重构任务".into(),
        system_prompt: "你是一个专业的代码工程师".into(),
        tools_whitelist: None,
        max_iterations: Some(20),
    },
    SubAgentSpec {
        id: "writer".into(),
        name: "文档专家".into(),
        description: "处理文档撰写、翻译、润色任务".into(),
        system_prompt: "你是一个专业的技术文档工程师".into(),
        tools_whitelist: None,
        max_iterations: Some(15),
    },
];

let node = SupervisorNode::with_default_strategy(
    "supervisor",
    "任务监督者",
    specs,
    backend,
    tool_bus,
    SupervisorConfig::default(),
);
```

---

## 注释块 6（原文件第 467-476 行）

`SupervisorNode::new` 参数说明：

- `id`：节点 ID（在 Orchestrator 中唯一）
- `name`：节点名称（调试/日志用）
- `specs`：子 Agent 规格列表
- `strategy`：任务分配策略
- `backend`：LLM 后端访问器（共享给所有子 Agent）
- `tool_bus`：工具总线（共享给所有子 Agent）
- `config`：Supervisor 配置

---

## 模块职责一句话

Supervisor 监督者模式：中央协调者通过 AssignmentStrategy（LLM/轮询/负载均衡）将任务分配给子 Agent 执行并汇总结果，支持多轮协调与 [TASK_COMPLETE] 提前终止。

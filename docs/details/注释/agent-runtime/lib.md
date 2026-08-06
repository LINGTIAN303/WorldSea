# lib.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/lib.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-41 行）

# Agent Runtime — Agent 编排框架 Rust 版

阶段 1.3：AgentLoop + ToolBus + GenaiBackend 已落地，ReAct 循环可用。
阶段 2.1：Tree of Thoughts 已落地（ToTNode + BeamSearchStrategy + LLM 评分/目标检查）。
阶段 2.4：Supervisor Pattern 已落地（SupervisorNode + LlmAssignmentStrategy）。
阶段 2.5：Router Pattern 已落地（RouterNode + LlmRoutingStrategy / KeywordRoutingStrategy）。

本 crate 对应 `packages/agent-core/src/orchestrator/` 的 TS 实现，
提供 Rust trait 映射与具体实现。

## 三层架构位置

```text
┌────────────────────────────────────────────┐
│  编排框架层（ToT/GoT/Multi-Agent/...）      │  ← 阶段 2 实现
├────────────────────────────────────────────┤
│  Agent loop 层（ReAct/Plan/Reflection）     │  ← 本 crate 提供 trait + AgentLoop
├────────────────────────────────────────────┤
│  LLM 通信层（genai / 自研）                 │  ← 阶段 1.2 实现（GenaiBackend）
└────────────────────────────────────────────┘
          Memory Pattern 横切所有层
```

## 模块组织

- [`types`]：核心数据结构（State/Message/PlanItem/...）
- [`backend`]：LLM 后端访问器 trait（`NodeBackendAccessor`）+ `PromptResponse`
- [`memory`]：记忆访问器 trait（`MemoryAccessor`）
- [`node`]：节点接口（`OrchestratorNode` trait、`NodeContext`、`NodeResult`）
- [`event`]：编排事件枚举（`OrchestratorEvent`）
- [`orchestrator`]：编排器接口（`Orchestrator` trait、`OrchestratorEdge`、运行选项/结果）
- [`tool`]：工具与工具总线（`Tool` trait、`ToolBus` trait、`SimpleToolBus`）— 阶段 1.3
- [`agent`]：AgentLoop ReAct 循环实现 — 阶段 1.3
- [`supervisor`]：Supervisor Pattern（SupervisorNode/SubAgentSpec/AssignmentStrategy）— 阶段 2.4
- [`router`]：Router Pattern（RouterNode/RoutingStrategy/LlmRoutingStrategy）— 阶段 2.5
- [`tree_of_thoughts`]：Tree of Thoughts（ToTNode/BeamSearchStrategy/ScoringStrategy）— 阶段 2.1
- [`llm`]：genai 通信层（`GenaiBackend`、`stream_simple`、`get_model`）— 阶段 1.2（feature `llm-genai`）

## 设计原则

- **轻量**：核心只定义 trait，具体实现按需启用 feature
- **可迁移**：接口设计直接映射阶段 0 的 TS 接口
- **解耦**：不依赖 pi-agent-core，可包装任何 LLM 后端
- **异步优先**：所有 trait 方法使用 `async_trait`，为 ToT/GoT 并行做准备

---

## 模块职责一句话

Agent Runtime crate 入口：声明模块组织（agent/backend/memory/node/event/orchestrator/tool/supervisor/router/ToT/GoT 等）与公共导出，呈现三层架构位置与设计原则。

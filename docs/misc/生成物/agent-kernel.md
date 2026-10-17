# 阅读包：agent-kernel

> 生成物（`node scripts/architecture/context.mjs agent-kernel`）——**可能滞后于代码**，实时口径以命令输出为准。
> kind: rust · roots: crates/agent-kernel/src · manifest: crates/agent-kernel/Cargo.toml

## 文件清单（54 个 / 共 28397 行）

| 行数 | 文件 |
|---|---|
| 4973 | crates/agent-kernel/src/agent/tests.rs |
| 1821 | crates/agent-kernel/src/agent/mod.rs |
| 1340 | crates/agent-kernel/src/llm/genai_backend.rs |
| 1338 | crates/agent-kernel/src/orchestrator.rs |
| 1186 | crates/agent-kernel/src/confirmation.rs |
| 978 | crates/agent-kernel/src/event.rs |
| 875 | crates/agent-kernel/src/scenario.rs |
| 867 | crates/agent-kernel/src/loop_control.rs |
| 859 | crates/agent-kernel/src/agent/tools.rs |
| 829 | crates/agent-kernel/src/retention.rs |
| 757 | crates/agent-kernel/src/llm/manifest.rs |
| 689 | crates/agent-kernel/src/tool.rs |
| 688 | crates/agent-kernel/src/event_bus.rs |
| 681 | crates/agent-kernel/src/long_task.rs |
| 658 | crates/agent-kernel/src/llm/stream.rs |
| 597 | crates/agent-kernel/src/mcp.rs |
| 558 | crates/agent-kernel/src/memory.rs |
| 550 | crates/agent-kernel/src/backend.rs |
| 488 | crates/agent-kernel/src/agent/interaction.rs |
| 484 | crates/agent-kernel/src/anchor.rs |
| 468 | crates/agent-kernel/src/llm/error.rs |
| 455 | crates/agent-kernel/src/agent/input.rs |
| 411 | crates/agent-kernel/src/types.rs |
| 400 | crates/agent-kernel/src/sub_agent_pool.rs |
| 398 | crates/agent-kernel/src/agent/request_snapshot.rs |
| 368 | crates/agent-kernel/src/a2ui.rs |
| 328 | crates/agent-kernel/src/long_task_tests.rs |
| 321 | crates/agent-kernel/src/permission_rules.rs |
| 318 | crates/agent-kernel/src/context_budget.rs |
| 315 | crates/agent-kernel/src/pipeline.rs |
| 304 | crates/agent-kernel/src/agent/loop_control.rs |
| 301 | crates/agent-kernel/src/node.rs |
| 274 | crates/agent-kernel/src/agent/compaction_summary.rs |
| 225 | crates/agent-kernel/src/tool_context.rs |
| 216 | crates/agent-kernel/src/agent/llm.rs |
| 210 | crates/agent-kernel/src/agent/config.rs |
| 193 | crates/agent-kernel/src/agent/memory.rs |
| 174 | crates/agent-kernel/src/alias.rs |
| 167 | crates/agent-kernel/src/llm/config.rs |
| 140 | crates/agent-kernel/src/raw_context.rs |
| 132 | crates/agent-kernel/src/router_decider.rs |
| 126 | crates/agent-kernel/src/agent/hooks.rs |
| 125 | crates/agent-kernel/src/agent/prompt_sections.rs |
| 123 | crates/agent-kernel/src/tool_hook.rs |
| 115 | crates/agent-kernel/src/llm/model.rs |
| 103 | crates/agent-kernel/src/sandbox.rs |
| 100 | crates/agent-kernel/src/env_scrub.rs |
| 90 | crates/agent-kernel/src/agent/state.rs |
| 85 | crates/agent-kernel/src/workspace_partition.rs |
| 72 | crates/agent-kernel/src/agent/long_task.rs |
| 38 | crates/agent-kernel/src/lib.rs |
| 34 | crates/agent-kernel/src/agent/backend_bridge.rs |
| 27 | crates/agent-kernel/src/agent/error.rs |
| 25 | crates/agent-kernel/src/llm/mod.rs |

## 公开契约面（src/lib.rs 的 pub 项）

- pub mod a2ui
- pub mod agent
- pub mod alias
- pub mod anchor
- pub mod backend
- pub mod confirmation
- pub mod context_budget
- pub mod env_scrub
- pub mod event
- pub mod event_bus
- pub mod llm
- pub mod long_task
- pub mod loop_control
- pub mod mcp
- pub mod memory
- pub mod node
- pub mod orchestrator
- pub mod pipeline
- pub mod raw_context
- pub mod retention
- pub mod router_decider
- pub mod sandbox
- pub mod scenario
- pub mod sub_agent_pool
- pub mod tool
- pub mod tool_context
- pub mod tool_hook
- pub mod types
- pub mod workspace_partition
- pub mod permission_rules

## 依赖与被依赖

- 依赖（requires）：（无）
- 被依赖：agent-patterns · agent-runtime

## 测试位置（1 个）

- crates/agent-kernel/src/long_task_tests.rs（328 行）

## 文档指针（5 处）

- docs/details/ARCHITECTURE.md
- docs/details/架构/orchestration-matrix.md
- docs/details/注释/agent-runtime/agent.md
- docs/details/注释/agent-runtime/mcp.md
- docs/details/注释/README.md

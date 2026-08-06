# 大文件拆分计划：测试分离 + 数据型拆分

status: 执行中

## 目标

对超长代码文件做第一轮拆分，两类：

- **A 测试分离**：Rust 文件内联 `#[cfg(test)] mod tests` 迁出为同目录独立文件（`#[path]` 方式，保持私有成员访问，零断言改动）
- **B 数据型拆分**：`packages/agent-runtime/src/skills/registry.ts` 的 `SKILL_REGISTRY` 巨型数组（81–1344 行）按类别拆入 `skills/data/`，逻辑保留

## 拆分原则

1. 测试模块 >300 行即迁出；`#[path = "xxx_tests.rs"] mod tests;` 保持私有访问
2. 只搬代码不改行为；Rust `pub` 面与 TS 导出签名完全不变
3. 数据/逻辑分离：静态元数据数组独立成 data 文件，逻辑文件 import 合并
4. 注释文档同步：被拆源文件注释文档头部追加"拆分记录"；迁出的测试/数据文件若含 ≥10 行注释块则抽取生成文档并登记 `docs/details/注释/README.md`

## A 类：测试分离文件清单（agent-runtime 7 + agent-commands 4）

| 文件 | 总行数 | 测试起始行 | 迁移后生产行数 |
|---|---|---|---|
| crates/agent-runtime/src/agent.rs | 2420 | 1705 | ~1700 |
| crates/agent-runtime/src/supervisor.rs | 1631 | 846 | ~845 |
| crates/agent-runtime/src/tree_of_thoughts.rs | 2040 | 1576 | ~1575 |
| crates/agent-runtime/src/multi_agent.rs | 1717 | 1536 | ~1535 |
| crates/agent-runtime/src/router.rs | 1116 | 587 | ~585 |
| crates/agent-runtime/src/long_task.rs | 1007 | 680 | ~680 |
| crates/agent-runtime/src/graph_of_thoughts.rs | 1192 | 1095 | ~1095 |
| crates/agent-commands/src/lib.rs | 1200 | 695 | ~695 |
| crates/agent-commands/src/terminal.rs | ~1052 | 607 | ~607 |
| crates/agent-commands/src/subagent.rs | ~780 | 481 | ~480 |
| crates/agent-commands/src/loop_control.rs | ~700 | 382 | ~382 |

> 注：agent.rs / tree_of_thoughts.rs / multi_agent.rs 生产代码本身仍 >1000 行，属"生产逻辑拆分"（后续轮次讨论，本次不做）。

## B 类：registry.ts 拆分

- `SKILL_REGISTRY`（81–1344 行）按技能类别拆 `packages/agent-runtime/src/skills/data/`：creation（创作）/ analysis（分析）/ system（系统运维）/ communication（沟通协作）/ worldbuilding（世界构建）/ other（其余）
- registry.ts 保留逻辑函数（getEnabledSkills / toggleSkill / resolveToolNames / buildSkillIndexPrompt 等），`import { ... } from './data/xxx'` 合并
- 导出签名不变（SKILL_REGISTRY / SkillMeta 等对外 API 一致）

## 验收

1. 每个 crate `cargo test` 全过（不只 check）+ `cargo check`
2. registry.ts 拆分后 `vue-tsc --noEmit` 通过，`skills/registry.ts` 导出 API 不变
3. 注释文档同步完成（拆分记录 + 新文件注释块抽取 + README 登记）
4. 测试文件命名 `*_tests.rs` 与源文件同目录

## 排除

- vendor / memory-archive 不动
- 生产代码 >1000 行的逻辑拆分（agent.rs 1700 等）留待后续轮次

## 执行结果（2026-08-06）

- **agent-runtime 测试分离**：7 文件测试模块迁出（agent_tests.rs 628 / supervisor_tests.rs 684 / tree_of_thoughts_tests.rs 410 / multi_agent_tests.rs 157 / router_tests.rs 470 / long_task_tests.rs 291 / graph_of_thoughts_tests.rs 90），`#[path]` 方式，cargo test 170 passed + 集成 5 passed
- **agent-commands 测试分离**：4 文件迁出（lib_tests.rs 505 / terminal_tests.rs 64 / subagent_tests.rs 441 / loop_control_tests.rs 121），cargo test 通过
- **registry.ts 数据拆分**：1662 → 409 行，52 个技能元数据按 6 类拆入 skills/data/（creation/analysis/development/communication/worldbuilding/other），SKILL_REGISTRY 顺序与导出 API 不变，typecheck 相对基线零新增错误
- **事故记录**：agent-runtime 拆分时子代理误用 PowerShell 脚本（UTF-8 无 BOM 中文被 GBK 解码）导致 7 源文件被截断，工作区未提交的注释抽取成果回退；已通过重做注释抽取（48 块复用既有文档）+ cargo test 全过恢复。教训：源文件批量搬移禁用 shell 脚本，必须用工具级编辑操作

## 第二轮：生产逻辑拆分（agent.rs / tree_of_thoughts.rs / multi_agent.rs）

| 文件 | 拆后行数 | 拆分目标 |
|---|---|---|
| src/agent.rs | ~1800 | `src/agent/` 目录：mod.rs（AgentLoop 主结构 + run 核心）+ config.rs（AgentLoopConfig）+ state.rs（AgentState/Snapshot）+ error.rs + loop_control.rs（emit_* 循环控制事件）+ memory.rs（load_memory_context/prompt 构建）+ llm.rs（call_llm_with_retry）+ tools.rs（execute_tool_* 串并行）+ interaction.rs（steer/trim/update_model 等交互）+ long_task.rs（心跳 + CheckpointProvider） |
| src/tree_of_thoughts.rs | ~1467 | `src/tree_of_thoughts/`：mod.rs（ToTNode 主逻辑）+ node.rs（ThoughtNode/Status）+ strategies.rs（Exploration/Scoring/GoalCheck 三 trait + 三个 LLM 实现 + PromptTemplates）+ config.rs + error.rs |
| src/multi_agent.rs | ~1414 | `src/multi_agent/`：mod.rs（MultiAgentNode 主逻辑）+ types.rs（AgentRole/Spec/Message/Topology）+ blackboard.rs（SharedBlackboard）+ strategies.rs（Synthesis/GoalCheck trait+impl）+ config.rs + error.rs |

约束：
- `pub mod xxx;` 指向目录 mod.rs，lib.rs re-export 不变 → 对外 API 完全不变
- impl 拆分：子模块 `impl AgentLoop`（同 crate 子模块可访问父模块私有字段）
- 测试文件 `*_tests.rs` 移入目录 `tests.rs`，`#[path]` 相对路径调整
- 每个子模块自备 use（从原文件头部 use 分发）
- **禁止 shell 脚本搬移**，工具级 Read/SearchReplace/Write 逐段操作
- 注释文档：子模块新 ≥10 行注释块追加文档；README 登记

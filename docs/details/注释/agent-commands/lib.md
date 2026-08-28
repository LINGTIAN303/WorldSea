# lib.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/lib.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 lib_tests.rs

## 注释块 1（原文件第 1-22 行）

# agent-commands — Agent 命令层（服务层）

把 `agent-runtime` 的 AgentLoop 能力封装为可被 Tauri 前端调用的命令服务。

## 架构定位
- 本 crate 是**纯逻辑命令层**，不依赖 tauri，可独立 `cargo test`。
- Tauri 命令绑定（`#[tauri::command]`）在 `apps/tauri/src-tauri` 端做薄包装，
  通过 manage 一个 [`AgentCommandService`] 实例，再调用本 crate 的方法。

## 会话管理
[`AgentCommandService`] 内部持有 `session_id -> Arc<AgentLoop>` 映射，用
`tokio::sync::Mutex` 保护。AgentLoop 的方法全部为 `&self`（内部 Arc 共享状态），
因此取到 `Arc<AgentLoop>` 后即可跨 await 调用，无需回写。

## Phase 5.1 说明
当前使用 [`MockBackend`] 占位 LLM 后端，打通"send_message → run → 响应"链路。
5.2 接入真实 genai 后端时，仅替换 `new_agent` 中的 backend 构造即可。

## Phase 5.4 说明
`new_agent` 已改用 [`GenaiBackend`]（真实 LLM 后端），从注入的
[`RuntimeProviderConfig`] 构造。前端通过 `set_provider_config` 命令写入
Provider 配置（含 API Key），`get_provider_config` 回显真实配置。

## 编排路径消息收口（X1 修复，2026-08-28）

**整体语义**：编排引擎（plan_execute / tot / got / supervisor / multi）复用会话的
LLM backend 与 ToolBus，但**不触碰会话 AgentLoop 的消息历史**——编排过程经
orchestration_trace 事件呈现，历史里只有终稿。因此 `send_message` 的两处编排早退
路径（`run_mode_prefix` 前缀分流、判型 is_complex）统一经 `finalize_orchestration_turn`
收口，对齐 react 路径语义：

1. 用户消息（保留原文含 / 前缀，刷新后前端用户行显示一致）+ 终稿回复追加进环
   （kernel `AgentLoop::append_messages`，不触发执行）；
2. 回写 `meta.message_count`（侧栏「N 条」与 react 同口径 = 环内消息总数，含 system）；
3. `persist_messages` 写穿 messages 表（刷新/重启恢复源）。

**重启计数派生**：`restore_sessions` 的 message_count 改为从 messages 表实际恢复条数
派生——sessions 表的 message_count 列仅创建期写入、不随 persist 更新，读列值会「重启归 0」。
**空终稿**：reply 为空只入环用户消息，避免空 assistant 轮污染上下文。

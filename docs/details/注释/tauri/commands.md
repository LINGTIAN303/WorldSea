# commands.rs 详细注释文档（tauri）

> 来源：`apps/tauri/src-tauri/src/commands.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-13 行）

# Tauri 命令层 — Agent 主链路 14 命令

Phase 5.1：在 `apps/tauri/src-tauri` 端做薄包装，通过 `manage` 一个
[`AgentCommandService`] 实例，把 `agent-commands` 的纯逻辑方法暴露为
`#[tauri::command]`，供 WebView 前端 `invoke` 调用。

命令签名与 Web 端 `useAgent` 接口对齐（newSession / sendMessage / abort /
steer / clearHistory / trimContext / getState / getMessages / isStreaming /
updateModel / updateThinkingLevel / getProviderConfig / setProviderConfig /
getHeartbeat / ...），此处为当前已注册的主链路子集。

P2 新增：Deep Phase 事件转发 — 订阅 AgentLoop 的 DeepPhaseChanged 事件，
通过 Tauri 事件系统 `agent:event:deep_phase_changed:{session_id}` 发送到前端
（事件名带 sessionId 后缀，与前端 useAgentRust 监听一致）。

## 注释块 2（原文件第 698-708 行）

创建 LoopController 实例并注册到 registry

# 参数
- `task_id`：任务 ID（与 `LongTaskRecord.task_id` 对齐，前端生成，建议前缀 `lc_`）
- `config`：可选 LoopControlConfig（None=使用默认配置）。仅无会话绑定时生效。
- `session_id`：可选会话 ID。若提供且会话存在，注册该会话 `AgentLoop` 内建的
  `LoopController`（与自动驱动共享同一实例，消除"内建自动 vs 命令层手动"双轨）；
  此时 `config` 被忽略（以 AgentLoop 内建配置为准）。

创建条目后订阅本文件顶部的 TauriEventListener，`check` 广播的 LoopEng* 事件
会转发到前端 `loop_control:event:{task_id}`。

---

## 补充（2026-09-22，S3-e2 会话分支命令面）

新增四命令（薄包装 `AgentCommandService`，`invoke_handler` 已注册）：
`fork_session(session_id, request_seq)` / `rewind_session(session_id, request_seq)` /
`create_checkpoint(session_id)` / `list_checkpoints(session_id, limit?)`
（末者同时注入 `State<LongTaskRepository>`——统一检查点视图 = 会话锚点 + 活跃任务断点）。

**事件通道**：会话分支三事件（`conversation_forked` / `conversation_rewound` /
`checkpoint_created`）经 emitter 转发到**专用通道** `agent:event:session_branch:{session_id}`
（07 口径：无 turnModel 归约规则的新事件不并入动作段；前端展示随 UX 排期）。

# commands.rs 详细注释文档（tauri）

> 来源：`apps/tauri/src-tauri/src/commands.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-13 行）

# Tauri 命令层 — Agent 主链路 14 命令

Phase 5.1：在 `apps/tauri/src-tauri` 端做薄包装，通过 `manage` 一个
[`AgentCommandService`] 实例，把 `agent-commands` 的纯逻辑方法暴露为
`#[tauri::command]`，供 WebView 前端 `invoke` 调用。

命令签名与 Web 端 `useAgent` 接口对齐（newSession / sendMessage / abort /
resumeTask / switchSession / getProviderConfig / updateModel /
updateThinkingLevel / clearHistory / getSessionList / getSessionMessages /
getUsage / getHeartbeat / ...），此处为其中已落地的主链路子集。

P2 新增：Deep Phase 事件转发 — 订阅 AgentLoop 的 DeepPhaseChanged 事件，
通过 Tauri 事件系统 `agent:event:deep_phase_changed` 发送到前端。

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

# useTerminalRust.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/terminal/composables/useTerminalRust.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-22 行）

# useTerminalRust — Tauri 端终端服务适配器

通过 Tauri `invoke` 调用 Rust 命令层（`apps/tauri/src-tauri/src/commands.rs`
中的 `terminal_*` 命令），把后端终端工具（`crates/agent-commands/src/terminal.rs`
的 `TerminalService`）暴露为前端可直接调用的方法。

与 Agent 工具总线解耦：本服务独立持有 `ShellSessionManager`，
前端直接执行命令 / 管理持久化会话，不经过 AgentLoop。

## 命令参数约定

后端命令取 `serde_json::Value` 参数，键名与工具参数一致（snake_case）：
- `executeCommand`: `{ command, cwd?, env?, timeout_ms? }`
- `createSession`:  `{ shell?, cwd? }`
- `execSession`:    `{ session_id, command, timeout_ms? }`
- `inputSession`:   `{ session_id, data }`
- `destroySession`: `{ session_id }`

## 状态设计

模块级单例（与 useAgentRust / useLongTaskRust 一致），多次调用返回同一份
响应式状态与方法，避免多组件各自维护 shells / sessions / 输出。

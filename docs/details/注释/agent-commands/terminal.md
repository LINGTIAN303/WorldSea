# terminal.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/terminal.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 terminal_tests.rs

## 注释块 1（原文件第 1-15 行）

# 终端工具（terminal tools）

注册到 Agent 的工具总线，使 LLM 可在 ReAct 循环中执行 shell 命令。

功能对齐 TS 端 `packages/agent-runtime/src/tools/terminal-tools.ts`：
- `execute_command`：单次命令执行（返回 stdout/stderr/exit_code）
- `detect_shells`：检测可用 Shell
- `shell_session_create` / `shell_session_exec` / `shell_session_input` /
  `shell_session_destroy` / `shell_session_list`：持久化 Shell 会话

## 设计
- 所有工具共享一个 [`ShellSessionManager`]（全局会话注册表），
  因此持久化会话在多个 Agent 会话间保持有效。
- 会话管理用 `tokio::sync::Mutex` + `HashMap`，进程用 `tokio::process`。
- Windows 默认 `cmd.exe`，Unix 默认 `/bin/sh`。

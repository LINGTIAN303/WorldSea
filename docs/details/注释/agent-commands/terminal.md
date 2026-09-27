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

## 补充（2026-09-18）：E3 沙箱接线与文案口径

> 本节为手工维护的增量说明（非注释块迁移），配套 [sandbox.md](sandbox.md) 与
> [03-E3 真沙箱设计方案](../../../plans/已完成/2026-09-18-工作区与环境对齐dsh/03-E3真沙箱设计方案.md)。

- **三通路**：命令族（`execute_command` / `bash` / `powershell`）与 PTY 会话族（`shell_session_*`）
  在 Agent 路径（携带 `ToolContext.sandbox` 戳记）走受限通路；终端面板路径（无 ctx）与 Unix 走普通通路。
- **fail-closed（D3）**：受限通路构造 / 授予 / 启动任一失败 → 拒绝执行或拒绝创建会话，绝不静默裸跑。
- **审计元信息**：命令族 `__meta.sandbox`（E3-1 起）；PTY `create` / `exec`（E3-4 起）；
  被沙箱拒绝时附 `__meta.sandbox_denied` + 结果 `sandbox_hint`（前端工具行显示「沙箱拒绝」徽标）。
- **D9**：受限模式拒绝 `bash` 工具（Windows 经 WSL）与 wsl/bash 形态 PTY 会话（WSL 服务拒绝受限令牌）。
- **文案口径**：错误统一「沙箱不可用（…fail-closed：已拒绝…）」句式；拒绝提示为
  「沙箱拒绝：…（当前沙箱模式 <mode>）」。

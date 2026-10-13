# proc_quiet — 隐藏子进程控制台窗口

> 源文件：`apps/tauri/src-tauri/src/proc_quiet.rs`

## 问题

主程序以 `windows_subsystem = "windows"` 编译（GUI 模式，无控制台）。此时 spawn 控制台程序（node / icacls / pwsh / cmd 等），Windows 会为子进程分配一个**新的控制台窗口**，表现为终端窗口闪现。

## 方案

`hide_console(&mut Command)` 在 spawn 前为命令设置 `CREATE_NO_WINDOW`（0x08000000）创建标志，子进程不再分配控制台。非 Windows 平台为空实现。

## 接入约定

- 所有「stdout 已 piped 或 null 的后台子进程」spawn 前都应调用 `hide_console`；
- 需要与用户交互的控制台进程不受此约束（当前无此场景）。

## 接入点（2026-10-10）

dsh_shell 的 node 宿主、LSP server、Office 的 LibreOffice 转换、acl_fix 的 pwsh 与 3 处 icacls 调用，共 6 处 spawn 点。

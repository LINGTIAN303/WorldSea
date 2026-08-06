# TerminalView.vue 详细注释文档（tauri）

> 来源：`apps/tauri/src/terminal/components/TerminalView.vue` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 2-12 行）

# TerminalView — 终端界面

支持单次命令执行 + 持久化 Shell 会话管理 + 可用 Shell 检测展示。
通过 `useTerminalRust` 调用 Rust 命令层（`terminal_*`）。

## 交互

- 底部输入框执行命令，↑/↓ 切换历史
- 选中某个会话时，输入框的命令改在会话中执行（保持工作目录/上下文）
- 右侧面板创建/销毁会话、展示可用 Shell

# Node.js 原生执行适配器 — 详细注释

> 源文件：apps/cli/src/cli/node-adapter.ts

## 注释块 1（原文件第 1-14 行）

Node.js 原生执行适配器

用于 serve.ts（Node.js 后端）环境，直接用 child_process 执行命令，
不依赖 WebSocket 客户端（避免"连自己"的死循环）。

核心方法：
  - executeCommand: 一次性命令执行（child_process.exec）
  - createSession / execInSession / destroySession: 持久 shell 会话（spawn）

PTY 能力为简化实现（不依赖 node-pty 原生模块）：
  - spawn 交互式 shell，通过 stdin/stdout 通信
  - 不支持真正 PTY 的终端控制（resize/颜色等），但满足工具执行需求

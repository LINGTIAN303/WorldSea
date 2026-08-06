# vite.config.ts 详细注释文档（tauri）

> 来源：`apps/tauri/vite.config.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 9-20 行）

Tauri 端 Vite 配置（Phase 5 独立构建）

设计原则：
1. 通过 Tauri IPC 调用 Rust 命令（不走 HTTP/WS）
2. WASM 后端用于算法降级（当 Tauri 命令不可用时，如开发期 hot reload）
3. 不需要 /api/* 代理（Tauri 端通过 IPC 直接访问系统能力）
4. Tauri dev 由 tauri.conf.json 的 beforeDevCommand 触发此 Vite 服务器

端口：5175（避免与 Web 端 5174、主项目 5173 冲突）
后端连接：Tauri IPC（TauriExecutionAdapter）

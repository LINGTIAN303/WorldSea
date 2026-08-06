# vite.config.ts 详细注释文档（web）

> 来源：`apps/web/vite.config.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 9-20 行）

Web 端 Vite 配置（Phase 5 独立构建）

设计原则：
1. 所有后端能力通过 CLI serve 中转（/api/* → CLI serve）
2. 不依赖根目录的自定义插件（worldsmithServerLauncher / localFilePlugin / customProxyPlugin）
3. WASM 后端用于算法降级（当 CLI serve 不可用时）
4. LLM API 代理由 CLI serve 处理，Web 端不重复配置

端口：5174（避免与主项目 5173、Tauri 端 5175 冲突）
后端连接：VITE_CLI_SERVE_PROXY_URL 环境变量（默认 http://localhost:3100）

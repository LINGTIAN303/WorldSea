# CLI Agent Server 模式 — 详细注释

> 源文件：apps/cli/src/commands/serve.ts

## 注释块 1（原文件第 1-24 行）

CLI Agent Server 模式（Phase 4 整合版）

`worldsmith serve` 启动 HTTP + WebSocket 服务器，
将 CLI 的本地能力（shell、git、文件、lint/test/build 等）暴露给 Web 端。
同时整合原 worldsmith-server 的 Python 微服务桥接能力（crawl4ai/markitdown/turbovec）。

HTTP API:
  GET  /health                健康检查
  GET  /api/capabilities      查询可用工具列表
  POST /api/tools/:name       调用指定工具
  POST /api/prompt            发送 prompt（SSE 流式响应）
  GET  /api/services/status   Python 服务状态（可选，需启用 PythonBridge）
  POST /api/crawl             网页抓取（可选，需启用 crawl4ai）
  POST /api/crawl/batch       批量抓取（可选，需启用 crawl4ai）
  POST /api/convert           文件转 Markdown（可选，需启用 markitdown）
  POST /api/vector/add        添加向量（可选，需启用 turbovec）
  POST /api/vector/search     搜索向量（可选，需启用 turbovec）
  POST /api/vector/delete     删除向量（可选，需启用 turbovec）

WebSocket:
  /ws  流式事件推送（工具执行进度、输出、状态变更）+ PTY 管理 + 命令执行
  鉴权：URL query 参数 ?token=xxx（AUTH_TOKEN=dev 时免鉴权）

# Python 微服务路由 — 详细注释

> 源文件：apps/cli/src/serve/python-routes.ts

## 注释块 1（原文件第 1-15 行）

Python 微服务路由 — 原生 http 实现

Phase 4 迁移：整合 worldsmith-server/routes/{crawl,convert,vector-search}.ts 三个文件。
将 express 路由改写为原生 http handler，与 serve.ts 架构一致。

端点清单：
  POST /api/crawl            单 URL 抓取（crawl4ai）
  POST /api/crawl/batch      批量抓取（crawl4ai）
  POST /api/convert          文件转 Markdown（markitdown）
  POST /api/vector/add       添加向量（turbovec）
  POST /api/vector/search    搜索向量（turbovec）
  POST /api/vector/delete    删除向量（turbovec）
  GET  /api/services/status  查询各 Python 服务状态

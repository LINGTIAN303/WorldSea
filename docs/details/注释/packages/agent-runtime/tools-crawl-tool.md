# crawl-tool.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/crawl-tool.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

```
深度网页爬取工具

优先使用本地 Crawl4AI 后端服务（支持 JS 渲染、反检测、结构化提取），
后端不可用时自动降级到 Jina Reader API。

工具分工：
- Firecrawl MCP（mcp_firecrawl-keyless_*）：优先用于网页搜索、整站爬取、地图扫描。
- web_crawl：用于 JS 渲染页面、反检测、批量单页抓取或本地 Crawl4AI 可用时的深度抓取。
- web_fetch：Jina Reader 单页快速兜底，适合静态内容、后端不可用的最后选择。
```

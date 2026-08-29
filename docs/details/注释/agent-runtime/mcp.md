# mcp.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-kernel/src/mcp.rs`（2026-08-25 crate 重组前为 `crates/agent-runtime/src/mcp.rs`，现经 agent-runtime 聚合壳 `pub use` 转发）中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-17 行）

# MCP 工具适配器 — 把 MCP 服务器工具包装为 `Tool` trait

对应 TS 版 `worldsmith-agent/src/mcp/mcp-adapter.ts` 的 `MCPToolAdapter`。

## 设计
- `McpCaller` trait：抽象 MCP 服务器调用入口（HTTP/SSE/stdio 等传输层由上层注入）
- `McpTool`：实现 `Tool` trait，持有 `server_id` + `tool_name` + `Arc<dyn McpCaller>`
- `McpToolAdapter`：把 `McpToolInfo`（元数据）转换为 `McpTool` 实例

## 工具命名规则
与 TS 版一致：`mcp_{server_id}_{tool_name}`
- 不同 server_id 下同名工具天然不冲突
- 前缀 `mcp_` 便于在日志/事件中识别

## 阶段边界
- **阶段 1.4（本模块）**：仅提供 trait 与适配器，不实现具体传输层
- **阶段 1.5+**：在 Tauri 集成时实现 `McpCaller` 的 HTTP/SSE 传输

---

## 注释块 2（原文件第 115-128 行）

MCP 工具 — 包装远程 MCP 服务器上的工具为本地 `Tool` trait 对象

# 字段
- `full_name`：预存的完整工具名（含 `mcp_{server_id}_` 前缀）
  预存是为了让 `name() -> &str` 能直接返回引用，避免每次构造新 String
- `server_id`：所属 MCP 服务器 ID
- `tool_name`：MCP 服务器上的原始工具名
- `description`：工具描述
- `input_schema`：参数 JSON Schema
- `caller`：MCP 服务器调用入口

# 构造方式
通过 [`McpToolAdapter::adapt`] 创建，确保 `full_name` 与 `server_id`/`tool_name` 一致。
`McpTool::new` 也公开，便于自定义场景手动构造。

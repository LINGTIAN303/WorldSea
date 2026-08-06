# tool.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/tool.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-18 行）

# 工具与工具总线

对应 TS 版 `packages/agent-core/src/bus/` 的 ToolBus。
阶段 1.3 提供最小可用实现，阶段 1.4 扩展 MCP/别名/按服务器注销。

## 阶段划分
- **阶段 1.3**：`Tool` trait + `ToolBus` trait + `SimpleToolBus`（仅内部工具注册/调用）
- **阶段 1.4（本模块扩展）**：
  - MCP 服务器工具批量注册（`register_mcp_tools` / `unregister_mcp_server`）
  - 别名系统（`resolve_alias`，调用前透明映射旧名→新名）
  - 工具调用前自动解析别名（`call_tool` / `get_by_name` 内置）

## 设计原则
- **异步优先**：`Tool::execute` 使用 `async_trait`，为 IO 密集型工具（文件/网络/数据库）做准备
- **Arc 共享**：工具以 `Arc<dyn Tool>` 注册，可在多个 Agent/节点间共享
- **JSON Schema**：参数定义用 `serde_json::Value` 承载 JSON Schema，与 OpenAI/Anthropic 工具规范对齐
- **错误隔离**：单个工具执行失败不会影响 ToolBus 稳定性
- **向后兼容**：`ToolBus` trait 新增方法均带默认实现，不破坏现有实现者

---

## 注释块 2（原文件第 40-51 行）

参数 JSON Schema（OpenAI/Anthropic 工具规范格式）

示例：
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "文件路径" }
  },
  "required": ["path"]
}
```

---

## 注释块 3（原文件第 57-69 行）

工具接口 — 所有工具实现此 trait

实现示例：
- `ReadFileTool`：读取本地文件
- `WriteFileTool`：写入本地文件
- `RunCommandTool`：执行 shell 命令
- `SearchCodebaseTool`：调用检索引擎

# 注册到 ToolBus
```rust,ignore
let mut bus = SimpleToolBus::new();
bus.register(Arc::new(ReadFileTool::new())).await;
```

---

## 注释块 4（原文件第 300-309 行）

按白名单过滤工具视图的 ToolBus 包装器

用于子 Agent 编排：当 `SubAgentSpec.tools_whitelist` 指定时，把子 Agent
看到的工具集限制为白名单内的工具，实现子 Agent 工具隔离（阶段 1.4 扩展点）。

# 行为
- `list_all` / `get_by_name` / `call_tool` / `count` 仅对白名单内工具生效
- `register` / `unregister` / `register_mcp_tools` / `unregister_mcp_server`
  透传到内层总线（子 Agent 通常不注册工具，透传保证完整性）
- 白名单为空集合时等价于"无任何工具"

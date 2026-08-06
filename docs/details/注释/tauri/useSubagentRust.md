# useSubagentRust.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/subagent/composables/useSubagentRust.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-21 行）

# useSubagentRust — Tauri 端子 Agent 规格管理适配器

通过 Tauri `invoke` 调用 Rust 命令层中的 `subagent_*` 命令，把后端
`AgentCommandService` 的子 Agent 规格管理能力（`crates/agent-commands/src/lib.rs`）
暴露为前端可直接调用的方法：查看 / 注册（同名按 id 覆盖） / 删除规格。

规格注册表在后端跨会话共享（`Arc<RwLock<Vec<SubAgentSpec>>>`），因此
前端这里注册的规格，对**所有**会话的主 Agent 都立即可见（`list_sub_agents` /
`delegate_to_sub_agent`）。

## 参数契约

后端 `subagent_register_spec` 直接反序列化 `SubAgentSpec`（agent-runtime 类型，
字段为 snake_case：`system_prompt` / `tools_whitelist` / `max_iterations`）。
Tauri v2 仅对顶层命令参数做 camelCase 转换，嵌套结构体按 serde 字段名匹配，
因此前端传入对象需使用 snake_case 键名。

## 状态设计

模块级单例（与 useTerminalRust / useAgentRust 一致），多次调用返回同一份
响应式状态与方法，避免多组件各自维护规格列表。

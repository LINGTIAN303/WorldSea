# SubAgentView.vue 详细注释文档（tauri）

> 来源：`apps/tauri/src/subagent/components/SubAgentView.vue` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 2-12 行）

# SubAgentView — 子 Agent 规格管理界面

提供子 Agent 规格的查看 / 注册 / 删除能力，使用户能在桌面端配置主 Agent
可委派的子 Agent 专长（`delegate_to_sub_agent` / `list_sub_agents`）。
通过 `useSubagentRust` 调用 Rust 命令层（`subagent_*`）。

## 交互

- 左侧：规格列表（ID / 名称 / 描述 / 最大迭代），可删除
- 右侧：新增 / 编辑表单（编辑时按 id 覆盖）

# SubAgentSection.vue 详细注释文档（tauri）

> 来源：`apps/tauri/src/agent/components/SubAgentSection.vue` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 2-12 行）

# SubAgentSection — 子 Agent 委派过程展示

订阅 `useAgentRust().subAgents`（由 Rust `agent:event:subagent:{session_id}`
事件驱动维护），实时展示主 Agent 委派给子 Agent 的任务状态：
- `running`：委派执行中（蓝色 pulse 闪烁指示 + 实时运行耗时）
- `completed`：委派完成（绿色，展示输出字符数与耗时）
- `error`：委派失败 / 超时（红色，错误信息过长时可展开）

仅做展示，不发起任何调用；状态由模块级单例 `useAgentRust` 统一维护。

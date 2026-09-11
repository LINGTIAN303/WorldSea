
> 承接迭代主题 2/4。主 Agent 有 `clear_agent_pool` 重置上下文，但子 Agent 实例在池中**跨委派累积上下文**，此前无任何方式查看/重置——一个行为异常或上下文膨胀的子 Agent 会一直"带病"复用下去。本轮补齐：查看实例池状态 + 清空单个/全部实例。

### 决策点 50：`SubAgentManager` 新增 `list_instances` / `clear_instance` / `clear_instances`，实例池对外暴露
**选择**：新增 `SubAgentInstanceInfo`（`sub_agent_id` / `name` / `message_count` / `is_streaming`）供查询返回；`clear_instance(id) -> bool`（移除单个，不存在返回 false）、`clear_instances() -> usize`（清空全部，返回数量）。清空即从 `agents: RwLock<HashMap>` 移除，下次委派按最新规格懒加载重建（全新上下文）。
**理由**：实例池本就是 `RwLock<HashMap>`，`remove`/`clear` 是最小改动；`message_count` 用 `agent.get_runtime_messages().len()` 展示累积规模、`is_streaming` 标记流式占用，帮助用户判断"哪些实例该清"。

### 决策点 51：`list_instances` 先收集快照、释放读锁后再查询消息数，避免持锁 await 阻塞写锁
**实测发现**：初版在 `read().await` 块内逐实例 `get_runtime_messages().await`，读锁长时间不释放，会阻塞 `get_or_create_agent`/`clear_*` 的写锁路径（`delegate` 卡在 Double-check 处）。
**选择**：先 `{ let agents = read().await; ... 收集 (id,name,Arc<AgentLoop>) ... }` 释放读锁，再在锁外逐个查询消息数/流式状态。
**理由**：消除"读锁内 await 阻塞写锁"的潜在死锁窗口；快照阶段只克隆 `Arc`（零拷贝），代价可忽略。

### 决策点 52：服务级按会话隔离实例池（`subagent_managers: Mutex<HashMap<session_id, Arc<SubAgentManager>>>`），清空/列出以会话为边界
**选择**：`AgentCommandService` 新增 `subagent_managers`，`new_agent` 创建会话时把 `SubAgentManager` 存入；`list_subagent_instances(session_id)` / `clear_subagent_instances(session_id)` 从该表取管理器再操作；`delete_session` 时同步移除条目。
**理由**：子 Agent 实例按会话隔离（不同会话各自累积上下文），操作必须限定在本会话；`delete_session` 清理由既有的 `subagent_managers.remove` 承接，无泄漏。

### 决策点 53：前端复用 `useAgentRust.currentSessionId` 定位当前会话，实例管理区只在有会话时可用
**选择**：`SubAgentView.vue` 新增「子 Agent 实例」区，`hasSession()` 判断 `agent.currentSessionId?.value`：无会话则提示"先创建会话"并禁用清空按钮；有会话则 `refreshInstances(sid)` 拉取、`clearInstances(sid)` 清空（`confirm` 二次确认）。
**理由**：实例操作强依赖会话，前端必须知道当前会话 id；`useAgentRust` 已维护 `currentSessionId`，直接复用避免重复维护会话状态。

## 影响范围（迭代主题 15）
- `crates/agent-commands/src/subagent.rs`：`SubAgentInstanceInfo` + `list_instances`/`clear_instance`/`clear_instances` + 3 个单测。
- `crates/agent-commands/src/lib.rs`：`subagent_managers` 会话隔离 + `list_subagent_instances`/`clear_subagent_instances` + `delete_session` 清理 + 导出类型 + 单测。
- `apps/tauri/src-tauri/src/commands.rs` + `lib.rs`：`subagent_list_instances` / `subagent_clear_instances` 命令。
- `apps/tauri/src/subagent/composables/useSubagentRust.ts`：`SubAgentInstanceInfo` + `instances`/`instancesBusy`/`instanceMsg` + `refreshInstances`/`clearInstances`。
- `apps/tauri/src/subagent/components/SubAgentView.vue`：实例管理 UI（列表 / 流式徽章 / 清空按钮 / 空态与无会话提示）。

## 验证方式（迭代主题 15）
- `cargo test --lib`（crates/agent-commands）：41/41 通过（含 `list_instances_after_delegate` / `clear_instance_removes_single` / `clear_instances_removes_all` / `subagent_instances_empty_until_delegation` / `subagent_instances_guard_requires_existing_session` / `delete_session_removes_subagent_manager`）。
- `cargo check`（apps/tauri/src-tauri）：通过。
- `npx vue-tsc --noEmit`（apps/tauri）：通过。


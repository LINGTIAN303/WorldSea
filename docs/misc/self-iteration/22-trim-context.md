## 迭代主题 22：上下文窗口管理，补 `trim_context` 无入口 + 长对话超限风险

> 延续"有 API 无入口"模式。`trim_context` 命令存在（`AgentLoop` 已实现），但 `AgentCommandService` 未暴露、Tauri 未注册、useAgentRust 未封装、UI 无控件。长对话消息累积易超出模型 context window，需补齐全链路。

### 决策点 68：对话头部加「压缩上下文」按钮，保留最近 8 条消息
**选择**：在 `App.vue` 对话头部「清空」按钮旁新增「压缩」按钮，点击调用 `trimContext(total - 8)`（保留最近 8 条），状态栏弱提示"上下文已压缩，保留最近 8 条消息"2.5s。按钮 `:disabled="backend.messages.length <= TRIM_KEEP_COUNT"`。
**理由**：8 条是兼顾上下文连续性与窗口控制的经验值；弱提示避免打断用户；禁用状态防误操作（消息不足 8 条时压缩无意义）。

### 决策点 69：全链路实现 `trim_context`
**选择**：
1. **Rust 服务层**：`AgentCommandService` 新增 `trim_context(session_id, up_to_index)`，调用 `AgentLoop.trim_context`，移除后用 `agent.get_messages().len()` 刷新会话 `meta.message_count`。
2. **Tauri 命令**：新增 `trim_context` 命令（`session_id` + `up_to_index` 参数），注册到 invoke_handler。
3. **TS 封装**：`useAgentRust` 新增 `trimContext(upToIndex)`（先 `ensureSession` 再 invoke，随后 `refreshMessages()` 同步本地消息与缓存）+ `refreshMessages()`（回源 `get_messages` 覆盖本地状态）。
4. **UI**：复用 steer/clear 的弱提示模式（`trimmed` ref + `setTimeout` 2.5s 自动清除），`.status` 显示优先级 `steered || trimmed || streaming/就绪`。

**理由**：`trim_context` 从头部移除旧消息、保留尾部新消息，是"压缩上下文但保留最近对话连续性"的标准做法；`refreshMessages` 复用既有 `get_messages` 回源，避免 trim 后前端消息与后端不一致；`setTimeout` 弱提示与迭代 20/21 语义一致。

### 代价（迭代主题 22）
- Mock 后端下 trim 无可见差异（消息本就少）；真实 LLM 长对话下"压缩前后 context window 变化"需接入真实模型后验证（记录待办，不阻塞 UI/链路交付）。
- `up_to_index` 由前端按 `total - 8` 计算，`AgentLoop.trim_context` 需对越界入参做安全裁剪（`min(up_to_index, len)`）——前端已用 `disabled` 防 `<=8` 误触，后端裁剪作双保险。

## 影响范围（迭代主题 22）
- `crates/agent-commands/src/lib.rs`：`trim_context` 方法 + 刷新 message_count。
- `apps/tauri/src-tauri/src/commands.rs` + `lib.rs`：`trim_context` 命令 + 注册。
- `apps/tauri/src/agent/composables/useAgentRust.ts`：`refreshMessages` / `trimContext` 封装 + 导出。
- `apps/tauri/src/App.vue`：对话头部「压缩」按钮 + `.trim` 样式 + `trimmed` 状态弱提示。

## 验证方式（迭代主题 22）
- `cargo check`（crates/agent-commands）：通过。
- `cargo check`（apps/tauri/src-tauri）：通过（新增命令注册）。
- `npx vue-tsc --noEmit`（apps/tauri，cwd=apps/tauri）：通过。
- 浏览器实测：消息 >8 条时「压缩」可用、点击后状态栏出现弱提示并在 2.5s 后消失、消息被裁剪为最近 8 条（真实 LLM 下 context window 见效果）。


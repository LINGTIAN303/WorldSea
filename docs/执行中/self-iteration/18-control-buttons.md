## 迭代主题 18：对话输入/控制区补齐（停止生成 + 清空对话）

> 承接迭代主题 16/17 的"有 API 无入口"模式。`abort`（中断生成）与 `clearHistory`（清空历史）命令与 `useAgentRust` 封装早已实现，但对话区**没有任何控件**能触发——生成中只能干等 ReAct 循环跑完（`sending` 期间发送按钮禁用，无取消路径），也无法一键清空当前对话。本轮补齐对话控制入口。

### 决策点 59：输入栏发送按钮在生成中切换为「停止」按钮，接入 `abort`
**选择**：`input-bar` 的发送按钮在 `sending || backend.isStreaming` 时文案变为「停止」、样式切换为危险色，`@click` 改调 `onStop`（`backend.abort()`）；生成结束后恢复「发送」。`onStop` 内 try/catch 捕获错误写入 `error`。
**理由**：`abort` 是控制面最关键的"后悔药"——ReAct 多轮工具循环可能很长，用户需要随时中断；复用既有 `backend.abort()`（内部已把 `isStreaming` 置 false），零后端改动。发送/停止共用一个按钮位，避免在极简输入栏多塞一个按钮，符合用户"极简 + 弱提示"偏好。

### 决策点 60：对话头部新增「清空」按钮，接入 `clearHistory`，无消息时禁用
**选择**：`chat-header` 的 `.header-actions` 中新增「清空」文字按钮，`:disabled="backend.messages.length === 0"`，`@click="onClear"` 调 `backend.clearHistory()`。
**理由**：`clearHistory` 已实现但无入口；清空是低频但必要的操作，头部放文字按钮不占输入栏空间。`disabled` 空态弱化提示，符合"弱提示"偏好。**不改动 `currentSessionId`**——清空仅重置该会话消息，会话仍保留，与 Rust `clear_history` 语义一致。

### 代价（迭代主题 18）
- 「停止」仅中止当前 `run` 的循环（`abort` 语义），不重置已产生的消息；上一轮的流式内容保留在消息区，属预期行为。
- 清空对话无二次确认（复用迭代主题 17 的取舍：极简取向，误清影响可视、可重发），本轮不引入 confirm 弹窗。

## 影响范围（迭代主题 18）
- `apps/tauri/src/App.vue`：`onStop`/`onClear` 处理函数 + 输入栏发送/停止切换 + 头部「清空」按钮 + 样式。
- 后端零改动，`useAgentRust.ts` 零改动（`abort`/`clearHistory` 已暴露）。

## 验证方式（迭代主题 18）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。
- 后端零改动，agent-commands / tauri `cargo check` 基线保持绿色。

---


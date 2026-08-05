## 迭代主题 16：主对话「思考级别（深度模式）」选择器

> 承接路线图「待办」中的「深度模式」缺口。Rust 侧 `update_thinking_level` 命令与前端 `useAgentRust.updateThinkingLevel` 已实现，但整个对话 UI **没有任何控件**能触发它——思考级别能力"有 API 无入口"，用户无法在界面切换深度模式。本轮补齐对话页头部选择器。

### 决策点 54：composable 新增响应式 `thinkingLevel` 状态，成功更新后同步本地值
**选择**：`useAgentRust` 新增 `thinkingLevel = ref<ThinkingLevel>('off')`，`updateThinkingLevel` 在 `invoke` 成功后同步 `thinkingLevel.value = level`；并在返回对象中导出 `thinkingLevel`。
**理由**：选择器需要展示"当前级别"，此前无任何状态可读。同步用"成功后回写"而非"乐观更新"——只有 Rust 确认成功才更新，避免界面显示与后端实际不一致。

### 决策点 55：对话页头部用原生 `<select>` 呈现思考级别，流式发送期间禁用
**选择**：在 `App.vue` 的 `chat-header` 右侧新增「思考级别」下拉（off→关闭 / minimal→极简 / low→低 / medium→中 / high→高 / xhigh→极高），`@change` 调 `backend.updateThinkingLevel(level)`；`sending` 或 `isStreaming` 时禁用。
**理由**：思考级别是会话级配置，放头部最直观；原生 `<select>` 零依赖、语义清晰，符合本项目"不新增依赖"的取向。流式中禁用避免运行期改配置导致状态漂移。

## 影响范围（迭代主题 16）
- `apps/tauri/src/agent/composables/useAgentRust.ts`：`thinkingLevel` ref + `updateThinkingLevel` 同步 + 返回对象导出。
- `apps/tauri/src/App.vue`：chat-header 新增思考级别 `<select>` + `onThinkingLevelChange` 处理 + 样式。

## 验证方式（迭代主题 16）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。

## 迭代主题 17：对话侧边栏会话管理 UI（新建 / 删除会话）

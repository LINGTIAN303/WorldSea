
> 承接迭代主题 16 的"有 API 无入口"模式。`newSession`/`deleteSession` 命令与 `useAgentRust` 封装早已实现，但对话侧边栏**没有任何控件**能触发它们——会话只能由 `onMounted` 自动建一个，`deleteSession` 完全无法在 UI 触发。本轮补齐会话管理的用户侧入口。

### 决策点 56：侧边栏头部加「新建会话」按钮，接入 `newSession`
**选择**：`sidebar` 顶部新增 `.sidebar-head`（标题 + 「＋ 新建」按钮），`onNewSession` 调 `backend.newSession('WorldSea 桌面端测试助手')`（与 `onMounted` 自动建会话用同一签名）。
**理由**：会话是"多会话并行"的基础，必须能手动开新会话；复用既有 `newSession` 命令，零后端改动。

### 决策点 57：每条会话项改为「切换按钮撑满 + 删除按钮右对齐」，删除按钮悬浮显现
**选择**：会话项由 `li @click` 整体可点改为内部两个独立按钮——`.session-switch`（`flex:1` 撑满，点击切换）+ `.session-del`（`×`，默认 `opacity:0`，`li:hover` 时显现，hover 变红）。`onDeleteSession(id)` 调 `backend.deleteSession(id)`。
**理由**：**避免点击删除误触切换**（删除按钮若在 `li` 内，冒泡会先触发 `switchSession`，删除后还可能切到已删会话）；删除是破坏性操作，默认隐藏、hover 显现符合用户"弱提示优于强提示"偏好，降低误删率。

**代价**：`deleteSession` 删除当前会话时会把 `currentSessionId` 置 null、清空本地消息（既有行为），用户需重新新建/切换；删除无二次确认（会话 id 为短 hash，误删影响小，且列表继续展示剩余会话，符合极简取向）。

### 决策点 58：清理 `useAgentRust.ts` 第 276 行过期 TODO 注释
**选择**：会话消息缓存（`sessionMessagesCache`）其实早已完整实现（`newSession`/`switchSession`/`deleteSession`/`prompt`/`handleStreamEvent`/`upsertMsgInSession` 全部接入），原"待办：会话消息缓存"注释为过期残留，改为描述性注释。
**理由**：避免后来者误以为该能力缺失而重复实现；与代码实际状态对齐。

## 影响范围（迭代主题 17）
- `apps/tauri/src/App.vue`：`onNewSession`/`onDeleteSession` 处理函数 + 侧边栏「新建」按钮 + 会话项拆分（切换/删除）+ 样式。
- `apps/tauri/src/agent/composables/useAgentRust.ts`：过期 TODO 注释修正（无逻辑改动）。

## 验证方式（迭代主题 17）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。
- 后端零改动，agent-commands / tauri `cargo check` 基线保持绿色。

---


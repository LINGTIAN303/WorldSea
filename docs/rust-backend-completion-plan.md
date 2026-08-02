# Rust Agent 后端补全执行计划（P0 + P1）

> 目标：补全 Rust 后端，使其在**基础对话 + 会话持久化 + 多会话管理**层面完整替代 TS 后端。
> 决策记录（2026-07-25）：
> - 范围：P0 持久化收尾 + P1 功能完整（不含 P2 长任务/深度模式/A2UI/Router 等高级能力）
> - 工具系统：保持混合桥接（Rust 原生 IO 工具 + FrontendToolBridge 反向调用 TS 业务工具）
> - 深度模式/长任务：前端复用 TS 渲染逻辑，Rust 后端只推送 tool_call 事件

> **2026-08-02 执行完成标注**：
> - ✅ **P0 会话持久化已完成**（阶段 2.5，批次 1-4）：`commands/session.rs` 6 个命令注册 + `persistence.rs` SessionRepository（save/load/list/delete/update_title/toggle_pin + total_usage 持久化）+ `useAgentRust.ts` 对接（switchSession/newSession/dispose/autoSave 防抖）
> - ✅ **P1-5 已实现且更彻底**：`useAgent.ts` 不再通过 `settingsStore.agentBackend` 开关，直接返回 `useAgentRustAdapter()`（Rust 后端成为主应用唯一 Agent 后端，TS 后端经 `provideAgentBackend` 注入保留）
> - ⏳ **待补**：端到端实测（浏览器会话切换/重启持久化验证）、Rust 长任务 failTask 终态闭环（2026-08-02 收敛后干净环境重测）

---

## 现状速查（已完成的基础设施）

| 组件 | 文件 | 状态 |
|------|------|------|
| SessionRepository（SQLite 持久化层） | `src-tauri/src/agent_bridge/persistence.rs` | ✅ 完整（save/load/list/delete/update_title/toggle_pin） |
| session.rs 命令文件 | `src-tauri/src/commands/session.rs` | ✅ 已编写 6 个命令，**但未注册** |
| AppState.session_repository 字段 | `src-tauri/src/state.rs` | ✅ OnceLock 已就绪 |
| lib.rs setup 钩子 | `src-tauri/src/lib.rs` 行 58-92 | ✅ 已在 app_data_dir 初始化 SessionRepository |
| agent.rs 15 个 cmd_agent_* 命令 | `src-tauri/src/commands/agent.rs` | ✅ 已注册 |
| FrontendToolBridge（混合工具桥接） | `src-tauri/src/agent_bridge/tool_bridge.rs` | ✅ 完整 |
| useAgentRust.ts 前端适配器 | `src/agent/composables/useAgentRust.ts` | ⚠️ RustAgentBackend 完整，但 useAgentRustAdapter 的 switchSession/newSession 是占位 |

---

## P0 任务：持久化收尾（最小可替代）

### P0-1: commands/mod.rs 声明 session 模块

**文件**：`src-tauri/src/commands/mod.rs`
**改动**：在 `pub mod agent;` 后添加 `pub mod session;`

```rust
// 改动后（约行 35-36）
pub mod agent;
pub mod session;
```

**验证**：`cargo check` 不报 `unresolved module` 错误

---

### P0-2: lib.rs 注册 6 个 cmd_session_* 命令

**文件**：`src-tauri/src/lib.rs`
**位置**：`invoke_handler!` 宏内，`commands::agent::cmd_agent_tool_result` 之后（约行 278）
**改动**：添加 6 行

```rust
// 在 commands::agent::cmd_agent_tool_result, 之后添加：
commands::session::cmd_session_save,
commands::session::cmd_session_load,
commands::session::cmd_session_list,
commands::session::cmd_session_delete,
commands::session::cmd_session_update_title,
commands::session::cmd_session_toggle_pin,
```

**验证**：`cargo check` 通过；前端 `invoke('cmd_session_list')` 不报 "command not found"

---

### P0-3: useAgentRust.ts 对接 cmd_session_save/load

**文件**：`src/agent/composables/useAgentRust.ts`

#### 3a. 添加类型导入与 SessionRecord 镜像类型

在文件头部 import 区（约行 53-71）添加：

```typescript
// Rust 端 SessionRecord / SessionSummary 镜像（对应 persistence.rs）
export interface RustSessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  pinned: boolean
}

export interface RustSessionRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  pinned: boolean
  providerConfig: RustProviderConfig
  messages: AgentMessage[]
  thinkingLevel?: string
  systemPrompt?: string
}

export interface RustSaveSessionRequest {
  id: string
  title: string
  providerConfig: RustProviderConfig
  messages: AgentMessage[]
  thinkingLevel?: string | null
  systemPrompt?: string | null
  pinned?: boolean | null
}
```

#### 3b. 替换 switchSession 占位

**位置**：useAgentRustAdapter 内，约行 1454-1464（当前是 `console.warn` + 忽略 sessionId）

```typescript
async function switchSession(sessionId: string): Promise<void> {
  // 1. 保存当前会话到 SQLite
  if (currentSessionId.value) {
    await autoSaveCurrentSession()
  }

  // 2. 销毁当前 Rust Agent
  if (backend.value) {
    backend.value.dispose()
    backend.value = null
  }

  // 3. 从 SQLite 加载目标会话
  let record: RustSessionRecord
  try {
    record = await invoke<RustSessionRecord>('cmd_session_load', { sessionId })
  } catch (err) {
    console.error('[useAgentRust] switchSession: 加载会话失败', err)
    // 加载失败时回退到新建会话
    await newSession()
    return
  }

  // 4. 用 record.providerConfig 创建新 Rust Agent
  cachedProviderConfig.value = record.providerConfig
  await inner.init(sessionId, record.providerConfig, {
    thinkingLevel: (record.thinkingLevel as ThinkingLevel) ?? 'off',
    systemPrompt: record.systemPrompt ?? undefined,
  })

  // 5. 写回 AgentLoop 内部 messages（恢复 ReAct 上下文）
  if (record.messages.length > 0 && backend.value) {
    // 转换 AgentMessage[] → OrchestratorMessage[]
    // 注意：Rust 端 OrchestratorMessage 与前端 AgentMessage 结构有差异，
    // 简化策略：只恢复 user/assistant 文本消息，tool_calls 丢失可接受（历史不重放）
    const runtimeMessages = record.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: m.content,
      }))
    backend.value.setRuntimeMessages(runtimeMessages)
  }

  // 6. 恢复前端状态
  inner.messages.value = record.messages
  currentSessionId.value = sessionId
  isPinned.value = record.pinned

  // 7. 重置 usage（历史 usage 已保存在 record 中，新轮次从 0 开始）
  totalUsage.value = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } }
}
```

#### 3c. 替换 newSession 占位

**位置**：约行 1426-1452

```typescript
async function newSession(): Promise<void> {
  // 1. 保存当前会话
  if (currentSessionId.value) {
    await autoSaveCurrentSession()
  }

  // 2. 销毁当前 backend
  if (backend.value) {
    backend.value.dispose()
    backend.value = null
  }

  // 3. 重置状态
  inner.messages.value = []
  totalUsage.value = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } }
  isPinned.value = false
  currentSessionId.value = crypto.randomUUID()

  // 4. 用缓存的 providerConfig 初始化新 Agent
  await ensureInitialized()
}
```

#### 3d. 替换 dispose（保存最后状态）

**位置**：约行 1466-1471

```typescript
function dispose(): void {
  // 保存最后状态到 SQLite（fire-and-forget，不阻塞 dispose）
  if (currentSessionId.value && inner.messages.value.length > 0) {
    void autoSaveCurrentSession().catch(err => {
      console.error('[useAgentRust] dispose 时保存会话失败', err)
    })
  }
  inner.dispose()
}
```

#### 3e. 新增 autoSaveCurrentSession 辅助函数

在 useAgentRustAdapter 内部（switchSession 之前）添加：

```typescript
/**
 * 自动保存当前会话到 SQLite
 * 调用 cmd_session_save，包含 messages / providerConfig / usage 等
 */
async function autoSaveCurrentSession(): Promise<void> {
  if (!currentSessionId.value || !cachedProviderConfig.value) return
  if (inner.messages.value.length === 0) return

  const title = inner.messages.value[0]?.content?.slice(0, 50) || 'Untitled Session'
  const req: RustSaveSessionRequest = {
    id: currentSessionId.value,
    title,
    providerConfig: cachedProviderConfig.value,
    messages: inner.messages.value,
    thinkingLevel: inner.thinkingLevel.value ?? 'off',
    systemPrompt: null,
    pinned: isPinned.value,
  }
  try {
    await invoke('cmd_session_save', { req })
  } catch (err) {
    console.error('[useAgentRust] autoSaveCurrentSession 失败', err)
  }
}
```

#### 3f. 暴露 isPinned 与 currentSessionId ref

确保 useAgentRustAdapter 的 return 对象包含：
```typescript
return {
  // ...已有字段
  currentSessionId,
  isPinned,
  switchSession,
  newSession,
  dispose,
  // ...其他
}
```

---

### P0-4: 新增 autoSaveSession 逻辑（agent_end 事件触发）

**文件**：`src/agent/composables/useAgentRust.ts`

**位置**：`ensureInitialized` 方法内，subscribe 事件监听处（约行 1247-1278，已有 usage 累加逻辑）

**改动**：在 `case 'agent_end'` 分支后触发 autoSave

```typescript
// 在 ensureInitialized 的 backend.subscribe 回调内
if (event.type === 'agent_end') {
  // agent_end 时自动保存（防抖：避免连续多轮快速触发）
  void scheduleAutoSave()
}

// 新增防抖保存（文件顶部或 useAgentRustAdapter 内）
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleAutoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    void autoSaveCurrentSession().finally(() => {
      autoSaveTimer = null
    })
  }, 2000) // 2 秒防抖
}
```

---

### P0-5: cargo check 验证

```bash
cd src-tauri && cargo check
```

**预期**：无错误，可能有 unused warnings（可接受）

---

## P1 任务：功能完整

### P1-1: generateTitleIfNeeded 对接 cmd_session_update_title

**文件**：`src/agent/composables/useAgentRust.ts`

**位置**：useAgentRustAdapter 内，sendMessage 之后或 agent_end 事件后

**改动**：首轮对话后生成标题并更新到 SQLite

```typescript
import { generateTitle } from './useTitleGen'

let titleGenerated = false

async function generateTitleIfNeeded(): Promise<void> {
  if (titleGenerated) return
  if (inner.messages.value.length < 2) return // 至少 1 轮对话（user + assistant）

  const firstUserMsg = inner.messages.value.find(m => m.role === 'user')
  if (!firstUserMsg) return

  try {
    const title = await generateTitle(firstUserMsg.content, cachedProviderConfig.value)
    if (title && currentSessionId.value) {
      await invoke('cmd_session_update_title', {
        sessionId: currentSessionId.value,
        title,
      })
      titleGenerated = true
    }
  } catch (err) {
    console.error('[useAgentRust] generateTitleIfNeeded 失败', err)
  }
}

// 在 agent_end 事件后调用
if (event.type === 'agent_end') {
  void scheduleAutoSave()
  void generateTitleIfNeeded()
}
```

**注意**：`generateTitle` 函数已存在于 `useTitleGen.ts`，TS 后端也在用。Rust 适配器复用即可。

---

### P1-2: 会话列表 UI 对接 cmd_session_list

**文件**：`src/agent/composables/useAgentRust.ts`

**改动**：新增 `loadSessionList` 方法并暴露

```typescript
const sessionList = ref<RustSessionSummary[]>([])

async function loadSessionList(): Promise<void> {
  try {
    sessionList.value = await invoke<RustSessionSummary[]>('cmd_session_list')
  } catch (err) {
    console.error('[useAgentRust] loadSessionList 失败', err)
    sessionList.value = []
  }
}

// return 中暴露
return {
  // ...
  sessionList,
  loadSessionList,
  // ...
}
```

**UI 对接**：调用方（如 SpaceChat.vue 或会话列表组件）在 onMounted 时调 `loadSessionList()`，切换会话时调 `switchSession(id)`。

**注意**：UI 组件的具体改动需根据当前会话列表组件的实现来确定，可能是 `SessionList.vue` 或 `SpaceChat.vue` 内联列表。执行时先 grep 找到调用 `listSessions` 的组件。

---

### P1-3: 置顶/删除对接

**文件**：`src/agent/composables/useAgentRust.ts`

```typescript
async function togglePin(sessionId?: string): Promise<void> {
  const id = sessionId ?? currentSessionId.value
  if (!id) return
  const newPinned = !isPinned.value
  try {
    await invoke('cmd_session_toggle_pin', { sessionId: id, pinned: newPinned })
    if (id === currentSessionId.value) {
      isPinned.value = newPinned
    }
    // 刷新列表
    await loadSessionList()
  } catch (err) {
    console.error('[useAgentRust] togglePin 失败', err)
  }
}

async function deleteSession(sessionId: string): Promise<void> {
  try {
    await invoke('cmd_session_delete', { sessionId })
    // 如果删除的是当前会话，切到新会话
    if (sessionId === currentSessionId.value) {
      await newSession()
    }
    await loadSessionList()
  } catch (err) {
    console.error('[useAgentRust] deleteSession 失败', err)
  }
}

// return 中暴露
return {
  // ...
  togglePin,
  deleteSession,
  // ...
}
```

---

### P1-4: totalUsage 持久化到 SQLite

**问题**：当前 `totalUsage` 只存 localStorage，会话切换/重启后丢失历史累计。

**方案**：在 `autoSaveCurrentSession` 时把 usage 写入 messages 的 metadata（或单独字段）。

**改动**：扩展 `RustSaveSessionRequest`（前端镜像）和 `SaveSessionRequest`（Rust 端）。

#### 前端改动（useAgentRust.ts）

```typescript
export interface RustSaveSessionRequest {
  id: string
  title: string
  providerConfig: RustProviderConfig
  messages: AgentMessage[]
  thinkingLevel?: string | null
  systemPrompt?: string | null
  pinned?: boolean | null
  // 新增：usage 持久化
  totalUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost: { input: number; output: number; total: number }
  } | null
}
```

#### Rust 端改动（persistence.rs）

在 `SaveSessionRequest` 结构体添加 `total_usage` 字段（serde 默认值），在 `SessionRecord` 和 sessions 表添加 `total_usage TEXT` 列。

**注意**：这需要数据库 migration（ALTER TABLE）。由于 sessions 表是新表（agent_sessions.db），且当前无生产数据，可直接修改 `init_schema` 的 CREATE TABLE 语句，无需 migration 文件。

```rust
// persistence.rs SaveSessionRequest 添加
#[serde(default)]
pub total_usage: Option<serde_json::Value>,

// SessionRecord 添加
pub total_usage: Option<serde_json::Value>,

// init_schema 修改 CREATE TABLE
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    provider_config TEXT NOT NULL,
    messages TEXT NOT NULL,
    thinking_level TEXT,
    system_prompt TEXT,
    total_usage TEXT  -- 新增
);

// save / load 方法同步更新 total_usage 字段
```

**加载时恢复**：switchSession 中 `totalUsage.value = record.totalUsage ?? 默认值`

---

### P1-5: settingsStore 默认 agentBackend='rust'

**文件**：`src/stores/settingsStore.ts`

**改动**：将 `agentBackend` 字段默认值从 `'ts'` 改为 `'rust'`

```typescript
// 找到 agentBackend 字段定义，修改默认值
agentBackend: 'rust' as 'ts' | 'rust',
```

**注意**：执行时先 grep 确认字段位置和当前默认值。这是让 Rust 后端成为默认选择的关键配置。

---

### P1-6: 前端 vue-tsc 类型检查 + 端到端验证

```bash
# 前端类型检查
cd frontend && npx vue-tsc --noEmit

# 后端编译
cd src-tauri && cargo check

# 端到端验证（手动）
# 1. 启动 Tauri dev
# 2. 切换到 Rust 后端（settingsStore 默认已是 rust）
# 3. 新建会话 → 发消息 → 验证流式响应
# 4. 切换到另一会话 → 验证历史消息加载
# 5. 切回原会话 → 验证消息恢复
# 6. 关闭重启 → 验证会话列表持久化
# 7. 置顶/删除会话 → 验证 UI 更新
```

---

## 风险与回滚

### 风险点

1. **OrchestratorMessage 与 AgentMessage 结构差异**：switchSession 恢复 runtime messages 时，tool_calls 等复杂结构可能丢失。**缓解**：只恢复文本消息，工具调用历史不重放（Agent 不会重新执行已完成的工具）。

2. **autoSave 频繁触发性能**：每次 agent_end 都保存全量 messages 到 SQLite。**缓解**：2 秒防抖；messages 通常 < 100 条，序列化 < 10KB，性能可接受。

3. **providerConfig 中 api_key 不持久化**：persistence.rs 已 `#[serde(skip_serializing)]` api_key，加载后需前端重新注入。**缓解**：switchSession 时从 settingsStore 重新获取 api_key 填充 cachedProviderConfig。

4. **数据库 schema 变更**：P1-4 新增 total_usage 列。**缓解**：agent_sessions.db 是新库无生产数据，直接改 CREATE TABLE + DROP 旧库重建。

### 回滚方案

- 任何步骤出错可回退到 `agentBackend: 'ts'`（settingsStore 修改一行）
- session.rs 命令注册失败不影响 agent.rs 已有能力
- useAgentRust.ts 改动可通过 git revert 回滚

---

## 执行顺序建议

为减少上下文占用，按以下顺序分批执行：

**批次 1（后端，最小上下文）**：P0-1 + P0-2 + P0-5（cargo check）
- 只改 2 个 Rust 文件
- 验证后端编译通过

**批次 2（前端持久化）**：P0-3 + P0-4
- 改 useAgentRust.ts
- 不验证，留到批次 4 一起验证

**批次 3（P1 增强）**：P1-1 + P1-2 + P1-3 + P1-4 + P1-5
- 继续改 useAgentRust.ts + settingsStore + persistence.rs

**批次 4（验证）**：P1-6
- vue-tsc + cargo check + 端到端

**批次 5（收尾）**：更新 project_memory.md

每批次完成后可压缩上下文，下一批次从本文档继续。

---

## 关键文件路径速查

| 文件 | 用途 |
|------|------|
| `src-tauri/src/commands/mod.rs` | 声明 session 模块 |
| `src-tauri/src/lib.rs` | 注册命令到 invoke_handler |
| `src-tauri/src/commands/session.rs` | 6 个 session 命令（已写好） |
| `src-tauri/src/agent_bridge/persistence.rs` | SessionRepository（P1-4 需扩展 total_usage） |
| `src/agent/composables/useAgentRust.ts` | 前端适配器（主要改动集中在此） |
| `src/agent/composables/useTitleGen.ts` | generateTitle 函数（P1-1 复用） |
| `src/stores/settingsStore.ts` | agentBackend 默认值（P1-5） |
| `worldsmith-agent/src/bridge-types.ts` | IAgentBackend 接口定义（参考） |

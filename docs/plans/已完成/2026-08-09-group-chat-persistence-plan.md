# 群聊会话持久化（Rust 参与者会话标识 + 映射恢复）— 实施计划

> status: 已完成
> 日期：2026-08-09
> 决策：用户已选 **群聊会话持久化（Rust 侧）**——UI 元数据保持 Dexie（IndexedDB），Rust 侧新增参与者会话的类型标识 + participantId↔rustSessionId 映射持久化；恢复语义为**可继续发言**（重建 coordinator/引擎 + 复用既有 Rust 会话）
> 目标：解决「双轨并存无关联键」——重启后能按群聊 id 找回参与者 Rust 会话并复用，不再产生孤儿会话；群聊参与者会话不出现在单聊侧边栏
>
> **完成记录（2026-08-09）**：T1 `session_store.rs` 加 `SessionKind` 枚举 + `SessionRecord.kind` + `group_chat_sessions` 关联表（group_id+participant_id→session_id，外键级联）+ trait 三方法（save/load/delete_group_participant(s) + load_sessions_by_kind）+ 补列迁移（kind 缺省 chat）；T2 `lib.rs` 抽 `new_session_with_kind`，新增 `create_group_session_participant`（kind='group'+写映射）/`list_group_session_participants`/`delete_group_session_participants`，`list_sessions` 加 kind 过滤；T3 commands.rs 三个新命令注册 + `list_sessions` 默认 `Some(Chat)` 过滤（单聊侧边栏不污染）；T4 `RustGroupChatBackend.ts` 新增 `createOrAttachRustGroupChatBackend`（有映射 attach 复用、无则 create 写映射）+ `attachRustGroupChatBackend`（恢复模式，dispose 不删会话）+ `listGroupParticipantSessions`/`deleteGroupParticipantSessions` 辅助，create 持久化群聊默认 cleanupOnDispose=false（映射级联避免 attach 到已删会话）；T5 前端接入——GroupChatCoordinator/GroupChatEngine（含 moderator）/AgentPrivateChat 三处改 `createOrAttach` + 传 groupId，useCasualChatEngine `createAgents` 传 groupInfo.id，GroupChatList.confirmDeleteGroup 级联清理，GroupChatView.onSelectGroup meeting 恢复重建 coordinator；T6 验证——cargo check 通过、agent-commands 65 测试全过（含新增 kind 过滤 + 映射级联 2 测试）、typecheck 0 错误、浏览器冒烟群聊模式无 vite-error-overlay/.group-chat-layout 正常挂载。

---

## 1. 背景与关键结论

### 1.1 现状（调研确认，2026-08-09）

- **群聊 UI 元数据**（GroupSession/CasualGroupSession/ChatAgent）存 Dexie/IndexedDB 三表（`apps/tauri/src/space/group-chat/GroupSessionManager.ts`，库 `worldsea-group-chat` v3）
- **参与者 LLM 通道已桥 Rust**（commit 81e3a23）：`RustGroupChatBackend.ts` 每参与者 `invoke('new_session')` 建独立 Rust AgentLoop 会话，`send_message` 自动写穿 sessions.db（`crates/agent-commands/src/lib.rs` L400-439）
- **核心缺口**：
  1. `participantSessionMap` 是模块级内存 Map（`RustGroupChatBackend.ts` L88），重启后丢失 → 无法按群聊找回参与者会话
  2. `SessionRecord`/`SessionInfo` 无会话类型字段（`session_store.rs` L16-26）→ 群聊参与者会话以普通会话身份出现在单聊侧边栏（SessionSidebar 全量渲染）
  3. 恢复路径不重建 coordinator/引擎：`GroupChatList.onSelect`（L197-221）只 `loadSession` 填 store，meeting 旧会话只读、casual 惰性首次发言才 `createAgents` 新建会话（`useCasualChatEngine.ts` L466-510）
  4. 参与者会话 dispose 时 `delete_session` 删除（`RustGroupChatBackend.ts` L321-325）——正常生命周期会被清理，但异常退出/未 dispose 会残留

### 1.2 方案结论

- **UI 元数据保持 Dexie**（用户已确认）——群聊会话头/消息/Agent 注册不动
- **Rust 侧新增三件事**：
  1. `sessions` 表加 `kind` 列（'chat'|'group'，缺省 'chat'）+ 补列迁移（复用 session_store.rs L109-114 模式）
  2. 新增 `group_chat_sessions` 关联表（group_id + participant_id + rust_session_id），持久化映射
  3. 新命令：`create_group_session_participant`（建参与者会话 + 写映射）/ `list_group_session_participants`（按 group_id 查映射）/ `delete_group_session_participants`（按 group_id 级联删）
- **前端**：`RustGroupChatBackend` 支持 attach 恢复模式（给定既有 rustSessionId 复用而非新建）；`GroupChatList.onSelect` 恢复路径重建 coordinator/引擎并复用会话
- **单聊侧边栏过滤**：`list_sessions` 默认只返回 `kind='chat'`（避免群聊参与者会话污染）

---

## 2. 架构

```
Rust SQLite（sessions.db）
├── sessions 表（+kind 列）            ← 单聊会话 kind='chat' / 群聊参与者 kind='group'
├── messages 表（不变）                 ← 会话消息
└── group_chat_sessions 表（新增）       ← group_id + participant_id + rust_session_id
        PK (group_id, participant_id)

AgentCommandService（crates/agent-commands）
├── create_group_session_participant(group_id, participant_id, system_prompt, provider_config, model_id)
│        → new_session(kind='group') + 写 group_chat_sessions 映射
├── list_group_session_participants(group_id)
│        → Vec<{ participant_id, session_id }>
└── delete_group_session_participants(group_id)
         → 级联 delete_session + 清映射行

Tauri 命令层（src-tauri/src/commands.rs + lib.rs）
└── 3 个新命令注册

前端（apps/tauri/src/space/group-chat）
├── RustGroupChatBackend.ts
│    ├── createRustGroupChatBackend(options)  ← 新增 groupId 参数，创建时走新命令（写映射）
│    └── attachRustGroupChatBackend(sessionId, participantId, name)  ← 恢复模式：不 new_session，直接 listen 既有会话
├── GroupChatCoordinator / GroupChatEngine
│    └── start 时若已存在映射则 attach，否则 create
└── GroupChatList.onSelect / useCasualChatEngine
     └── 恢复路径：list_group_session_participants → attach 复用 → 可继续发言
```

**生命周期**：
- 创建：`onStart`/`ensureEngine` → `create_group_session_participant`（kind='group' + 映射）→ 内存 `participantSessionMap` 照旧
- 恢复：`onSelect`（Dexie 已有 session）→ `list_group_session_participants(group_id)` → 逐参与者 `attachRustGroupChatBackend(sessionId)` 复用
- 销毁：`onNewGroupChat`/`dispose` → `delete_group_session_participants(group_id)`（级联删参与者 Rust 会话 + 映射）+ Dexie 删会话头

---

## 3. 任务分解（文件级）

### T1：Rust session_store + 关联表

**文件**：`crates/agent-commands/src/session_store.rs`
**内容**：
1. `SessionRecord` 加 `kind: SessionKind` 字段（`#[serde(default)]`，枚举 `'chat'|'group'`，derive Serialize/Deserialize/Clone/PartialEq）
2. `sessions` 表补列迁移：`ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'`（幂等）
3. 新增 `group_chat_sessions` 表：
   ```sql
   CREATE TABLE IF NOT EXISTS group_chat_sessions (
       group_id        TEXT NOT NULL,
       participant_id  TEXT NOT NULL,
       session_id      TEXT NOT NULL,
       PRIMARY KEY (group_id, participant_id),
       FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
   )
   ```
4. trait 新增 3 方法：`save_group_participant(group_id, participant_id, session_id)` / `load_group_participants(group_id) -> Vec<(String, String)>` / `delete_group_participants(group_id)`
5. `load_sessions` 返回带 kind；新增 `load_sessions_by_kind('chat')`（单聊侧边栏过滤用）
6. 单测：映射 roundtrip + 级联删除

### T2：AgentCommandService 新命令

**文件**：`crates/agent-commands/src/lib.rs`
**内容**：
1. `create_group_session_participant(group_id, participant_id, system_prompt, provider_config, model_id)`：
   - 调 `new_session` 后写 kind='group'（或 new_session 加 kind 参数）
   - `store.save_group_participant(...)` 写映射
   - 返回 `SessionInfo`（含 rustSessionId）
2. `list_group_session_participants(group_id) -> Vec<GroupParticipantSessionInfo{participant_id, session_id}>`
3. `delete_group_session_participants(group_id)`：查映射 → 逐 `delete_session` → 清映射行
4. `list_sessions` 加 `kind` 过滤参数（默认 'chat'）——**单聊侧边栏不污染的关键**
5. `new_session` 增加可选 `kind` 参数（默认 'chat'），写穿时带 kind

### T3：Tauri 命令层注册

**文件**：`apps/tauri/src-tauri/src/commands.rs` + `lib.rs`
**内容**：3 个新命令（`create_group_session_participant` / `list_group_session_participants` / `delete_group_session_participants`）+ `list_sessions` 加 kind 参数；lib.rs L63 的 `invoke_handler` 注册

### T4：RustGroupChatBackend attach 恢复模式

**文件**：`apps/tauri/src/space/group-chat/rust/RustGroupChatBackend.ts`
**内容**：
1. `createRustGroupChatBackend(options)` 增加 `groupId?: string`——传 groupId 时改走 `create_group_session_participant` 命令（建会话 + 写映射），否则 `new_session`
2. 新增 `attachRustGroupChatBackend(sessionId, participantId, name)`：不 new_session，直接 `listen('agent:event:stream:'+sessionId)` + 注册映射 + 返回 backend（restore 用）
3. `dispose()` 增加选项：dispose 只清监听与内存映射，是否 `delete_session` 由调用方（删除群聊时）决定——避免恢复后 dispose 误删

### T5：前端恢复接入

**文件**：`GroupChatView.vue` + `GroupChatList.vue` + `useCasualChatEngine.ts` + `GroupChatCoordinator.ts` + `GroupChatEngine.ts`
**内容**：
1. `GroupChatList.onSelect`（meeting）：`loadSession` 后触发恢复——调用新恢复入口重建 coordinator 并 attach 参与者会话
2. `GroupChatCoordinator`：新增 `restore(session, providerConfig)` 静态/工厂方法——`list_group_session_participants` → 逐参与者 `attachRustGroupChatBackend`
3. `useCasualChatEngine`：`ensureEngine` 前先查映射，有则 attach 复用，无则 createAgents
4. `onNewGroupChat`/群聊删除：调用 `delete_group_session_participants` 级联清理
5. `GroupChatView.onStart`：`createGroupSession` 后把 groupId 传给 coordinator（Dexie session.id 即 group_id）

### T6：验证

- `cargo check`（agent-commands / src-tauri）
- `pnpm typecheck` 0 错误
- Rust 单测：映射 roundtrip + 级联删除 + kind 过滤
- 浏览器冒烟：单聊侧边栏不含群聊参与者会话；群聊创建后 `list_group_session_participants` 可见映射；删除群聊级联清理
- 真实 LLM 恢复验证需桌面冒烟（二期）

---

## 4. 风险与边界

| 风险 | 说明 | 处置 |
|---|---|---|
| 补列迁移非幂等 | 列已存在时 ALTER 报错 | 沿用 L109-114 `let _ =` 忽略模式 |
| 旧库残留 group 会话 | 迁移前已存在的参与者会话无 kind | 迁移后 kind 缺省 'chat'，残留 group 会话会出现在单聊侧边栏（既有行为），用户手动删即可；新会话不受影响 |
| dispose 误删恢复会话 | attach 恢复后 dispose 会 delete_session | T4 dispose 拆为「仅清内存」与「级联删」两模式 |
| 多开群聊同 participantId | 内存 Map 按 participantId 键冲突 | 映射键改为 `${groupId}:${participantId}` 或依赖 Rust 侧 PK (group_id, participant_id) 去重 |
| Dexie 会话头与 Rust 映射不一致 | 删 Dexie 会话但 Rust 会话残留 | 删除路径统一走 `delete_group_session_participants` 先清 Rust 再删 Dexie |

---

## 5. 验收标准

- [ ] `sessions` 表含 kind 列，群聊参与者会话 kind='group'，单聊侧边栏（list_sessions）只见 kind='chat'
- [ ] `group_chat_sessions` 表持久化 group_id↔participant_id↔rust_session_id 映射，重启后 `list_group_session_participants` 可查到
- [ ] 从群聊列表点进旧群聊可继续发言（参与者会话被 attach 复用，历史上下文延续）
- [ ] 删除群聊后参与者 Rust 会话被级联清理（`delete_group_session_participants`）
- [ ] typecheck 0 错误；cargo check + Rust 单测通过；单聊会话列表回归正常

---

## 6. 后续（二期）

- 真实 LLM 恢复验证（桌面冒烟 + API Key）
- 群聊会话头/消息整体迁 Rust SQLite（若用户后续决策）
- group 会话孤儿清理工具（异常退出残留检测）

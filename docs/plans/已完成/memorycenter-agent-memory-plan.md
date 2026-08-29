# MemoryCenter 召回集成计划（增强 WorldSmith Agent 记忆系统）

> **状态**：已完成（2026-08-30 实况核对后归档。阶段 0-5 全部落地：MemoryCenterAccessor 实现于 `crates/agent-memory/src/lib.rs`、trait 实际位于 `crates/agent-kernel/src/memory.rs`（2026-08-25 crate 重组后，文内 `crates/agent-runtime/src/memory.rs` 锚点过期，对外路径 `agent_runtime::memory` 语义未变）、注入接线 `crates/agent-commands/src/lib.rs` with_memory_root、5 个 memory_* 命令注册完好。阶段 4 声明的前端形态（MemoryPanel.vue/useMemoryCenterRust.ts）已被后续重构替换为 `apps/tauri/src/space/panels/MemoryShelf.vue`）
> **创建日期**：2026-08-06
> **最近更新**：2026-08-06 新增「八、历史积压清理」与「九、转方向说明」两节，编号重排为 1-11 连续
> **决策人**：用户
> **关联**：`crates/agent-runtime/src/memory.rs`（MemoryAccessor trait）、`docs/plans/agent-orchestration-roadmap.md`（Memory 横切模式）

---

## 一、背景与结论

**结论：召回 MemoryCenter 作为 WorldSmith Agent 记忆后端，方向正确、时机成熟。**

关键事实链：
1. WorldSmith 的 [MemoryAccessor](file:///d:/本地化AI/DeepSeek_Home/worldsmith/crates/agent-runtime/src/memory.rs) trait 已定义，`Orchestrator` 有 `with_memory()` 注入点，但**无任何实现**（默认 `Option=None`）。
2. 自研 `@worldsmith/memory-archive`（TS/IndexedDB）是 MemoryCenter 的**早期实验**，且 roadmap 明确标注"未与 Agent loop 深度集成"。
3. MemoryCenter 是独立演进的成熟记忆库，具备三级周期归档、完整对话无损归档、4 维评分淘汰、冲突检测、17 类标签、BM25+语义混合检索等 WorldSmith 缺失能力。
4. `memory-center-core` 自带 SQLite（rusqlite）/文件树/缓存存储，契合 WorldSmith 的 SQLite 单二进制约束。

## 二、已确认决策

| 决策点 | 选择 | 说明 |
|--------|------|------|
| 依赖引入方式 | **vendor 复制** | 将 `memory-center-core` + `memory-center-core-logic` 复制进 WorldSmith `crates/`，从此独立演进，不再依赖外部项目 |
| 适配层位置 | **新增 `crates/agent-memory`** | 承载 `MemoryAccessor` trait 的实现，边界清晰，符合模块化约束 |
| 存储后端（当前） | **SQLite** | 用 `memory-center-core` 自带 SqliteStorage，符合单二进制约束 |

## 三、待决策项（后续综合）

| 待决策项 | 现状 | 倾向 | 说明 |
|----------|------|------|------|
| 存储后端最终形态 | 当前 SQLite | 用户倾向**文件树** | MemoryCenter 的 Storage trait 可插拔，SQLite 与 LocalStorage（文件树）都支持。具体形态待 RecallRetrieve 全链路验证后综合决定，不阻塞 vendor 与适配层开发 |

## 四、集成架构（MemoryCenter 作为 MemoryAccessor 后端）

```
AgentLoop / Orchestrator
        │  with_memory(Arc<dyn MemoryAccessor>)   ← 已有注入点
        ▼
crates/agent-memory  (新增)
   └─ MemoryCenterAccessor  implements MemoryAccessor
        ├─ recall  ↔ memory-center retrieve / semantic_search
        ├─ inject  ↔ memory-center render_prompt
        ├─ archive ↔ memory-center archive
        ├─ get_archive_boundary ↔ archive boundary
        └─ load_chunk ↔ memory-center retrieve(hook_id)
        │
        ▼
crates/vendor/memory-center-core  (vendor 复制)
   └─ (依赖) crates/vendor/memory-center-core-logic
        │
        ▼
Storage trait（可插拔）
   ├─ SqliteStorage（当前） / LocalStorage（文件树，待决策）
   └─ CachedStorage（moka 缓存）
```

设计原则：
- AgentLoop 调用层**零改动**——只走既有 `MemoryAccessor` trait 与 `with_memory()` 注入。
- vendor 的 core 保留可插拔 Storage trait，SQLite 与文件树并存，待决策项确定后仅切换 Storage 构造。
- 适配层屏蔽 MemoryCenter 内部类型，输出对齐 `MemoryAccessor` 的数据结构（`MemoryRecallResult` / `MemoryArchiveResult` 等）。

## 五、阶段规划（渐进式，避免全量替换风险）

```
阶段 0  vendor 复制：memory-center-core + core-logic 进 crates/vendor/，调整依赖路径 ✅ 已完成（2026-08-06）
        - 源文件复制自 D:\本地化AI\MemoryCenter\crates\
        - Cargo.toml 已扁平化 workspace 依赖（WorldSmith 无根 workspace，各 crate 独立编译）
        - 保留 native feature（jieba-rs + dashmap），去掉 WASM 相关 feature
        - 依赖版本对齐 workspace 定义：rusqlite 0.32 / jieba-rs 0.7 / moka 0.12 / dashmap 6.1 / r2d2 0.8 / r2d2_sqlite 0.25
        - cargo check 两个 crate 独立编译通过 ✅
阶段 1  适配层：新增 crates/agent-memory，实现 MemoryAccessor trait ✅ 已完成（2026-08-06）
        - lib.rs 实现 MemoryCenterAccessor，映射五个 trait 方法到 MemoryCenter 的 Retriever/Archiver
        - 依赖 agent-runtime（trait）+ vendor/memory-center-core（存储/检索/归档）
        - cargo check 0 errors；4 个单测通过（archive+recall / top_k / inject 去重 / load_chunk）
        - 关键点：trait 方法返回 std::result::Result<_, MemoryError>，避免与 crate 级 Result 别名冲突
阶段 2  注入：Orchestrator/AgentLoop 构造处调 with_memory()，让桌面/后端生效 ⚠️ 见下方说明
        完成（2026-08-06）：
        - AgentLoop 增加 memory 字段 + with_memory()/memory()（agent-runtime/src/agent.rs）
        - AgentCommandService.new_agent 为每会话构造 MemoryCenterAccessor 并注入 AgentLoop
          （agent-commands/src/lib.rs build_memory_accessor + Cargo.toml 依赖 agent-memory/memory-center-core）
        - Tauri setup 传 app_data/worldsmith/memory 给 with_memory_root，桌面启用记忆
          （apps/tauri/src-tauri/src/lib.rs）
        - 验证：agent-commands cargo check 0 errors + 60 单测通过；tauri cargo check 通过
        ⚠️ 说明：DefaultOrchestrator 为 #[allow(dead_code)] 的 roadmap 预留结构（run 未实现，
          未接入 AgentLoop 主链路），其 with_memory 注入点已存在但暂不注值——待编排框架
          接入后（roadmap 阶段 1.x）再接线，避免为未运行代码做无用注入。
阶段 3  验证：单测 + 集成测，确认 ReAct 循环内 recall/inject/archive 闭环 ✅ 已完成（2026-08-06）
        - MemoryAccessor trait 增 record_turn(user_message, assistant_message) 默认空实现
          （agent-runtime/src/memory.rs），归档喂入数据源
        - MemoryCenterAccessor 实现 record_turn（转 MessageTurn 调 push_turn）+ archive 加
          should_archive 阈值检查（对齐 MemoryCenter 语义，避免每轮碎片归档）
        - AgentLoop 织入：memory_context 字段缓存注入文本；run() 中 user 消息后
          load_memory_context()（recall+inject）→ build_prompt_options 拼入
          system_prompt_override（backend 跳过 messages 中 system，记忆只能走 override）；
          run 结束后 record_turn + archive(SessionEnd)（弱提示）
        - agent-commands 归档阈值 2000 token（默认 400K 过大，会话内几乎不触发归档）
        - 验证：agent-runtime 增 2 集成测（记忆注入 system prompt + 无记忆跳过），170 单测 +
          5 集成测通过；agent-memory 增 record_turn→archive→recall 闭环单测，5 通过；
          agent-commands 59 + 1 通过；tauri cargo check 通过
阶段 4  前端迁移：ArchivePanel 等 UI 从 TS memory-archive 切到新后端 ✅ 已完成（2026-08-06）
        - 后端命令：AgentCommandService 增会话级 memory_list/recall/archive/load_chunk/boundary
          （agent-commands/src/lib.rs）+ CommandError::From<MemoryError>
        - Tauri 命令：commands.rs 增 memory_* 五个 #[tauri::command]，lib.rs 注册进 generate_handler
        - 前端：useMemoryCenterRust.ts（invoke memory_* 命令 + 响应式状态，Rust 类型镜像）
          + MemoryPanel.vue（列表/检索/详情/归档 4 视图 MVP）
        - 接线：App.vue 增「记忆」tab，挂载 MemoryPanel（传当前会话 sessionId，会话隔离）
        - 验证：agent-commands / agent-runtime / tauri cargo check 通过；前端 typecheck 通过
        - 说明：管理功能（标签/置顶/删除/回收站/定时归档/合并）留待后续迭代，MVP 聚焦核心闭环
阶段 5  清理：确认稳定后清理 TS 版 memory-archive ✅ 已完成（2026-08-08 复核：apps/web 已删除，"Web 端保留"理由失效，阶段 5 视为完成）
        - Tauri 端：删除 apps/tauri/src/memory-archive/（TauriFsOperations.ts 孤立文件，
          无任何引用），移除 tauri tsconfig.json / vite.config.ts 的 @worldsmith/memory-archive
          路径映射。vue-tsc typecheck 通过 ✅
        - Web 端：原保留决策（apps/web 依赖 TS memory-archive 的 ArchivePanel/archive 视图等
          十几个组件，且 Web 聊天后端未接通，无法回退 Rust 记忆）已随 **apps/web 删除（2026-08-08）**
          失效；TS memory-archive 仅保留于 packages/memory-archive 供既有消费方使用
```

---

## 八、历史积压清理（优先级 1，转入 Agent 完整性迭代前的收尾）

> 触发背景：用户方向调整为「**清理历史积压 → 全新主题 → UI/后端体验优化 → Agent 完整性迭代(Harness 工程化)**」。
> 本节记录每一项积压的审计结论与处置结论（7 点清单通过后再处置）。

### ① Tauri 命令层缺口审计 ✅ 已完成（2026-08-06，仅记录，未处置）

**结论：Rust 注册 54 条命令，TS 侧 invoke 了 102 条不同命令，共 50 条缺口**——缺口命令完全未在 Rust 端定义（crates/agent-commands/src 也无对应模块）。

| 分类 | 数量 | 明细 |
|------|------|------|
| cmd_algo_*（算法/布局/图分析） | 18 | segment_intersect / find_all_intersections / point_in_polygon / polygon_area / convex_hull / aabb_intersects / obb_intersects / force_layout / grid_layout / layout_unified / radial_layout / tree_layout / dijkstra_path / connected_components / pagerank / community_detection / (共18项) |
| cmd_check_* + validate_plugin（健康检查） | 3 | cmd_check_storage_health / cmd_check_plugin_health / cmd_validate_plugin_manifest |
| cmd_retrofit_*（修复/重构会话） | 3 | cmd_retrofit_begin_session / cmd_retrofit_redirect / cmd_retrofit_request_repair |
| workflow_*（工作流引擎） | 26 | list / get / create / update / delete / export / import / dry_run / run / run_sync / pause / resume / cancel / skip_to / status / list_runs / get_run / node_result / node_chunk / node_heartbeat / node_cancel_ack / list_node_types / get_node_schema / register_node_type / unregister_node_type / get_setting / set_setting / purge_runs_now（共26项，TS侧workflowApi.ts定义了完整 CRUD + 执行控制） |

另外还有 **2 条 Rust 注册但 TS 未使用的冗余命令**：
- `is_streaming` — Tauri 用前端流式事件维护 `isStreaming`，不走轮询 invoke
- `cmd_long_task_list_all` — 前端仅用到 list_running，list_all 未接线

**处置建议（非阻塞，需决策）**：
- 缺口 50 条：**短期不补齐**。对应 UI 面板（workflow 设计器/插件健康页/改造工具/图分析）要么未挂载要么 roadmap 规划中；Agent 主链路与记忆闭环不依赖。
- 冗余 2 条：**短期保留**，删除需全 workspace grep 确认无 dead_code 告警风险。
- 长期：在 workflow / plugin / retrofit 功能进入 MVP 开发阶段时，按 「新增 Rust 命令 → 注册 generate_handler → TS invoke 接回」顺序补入，**禁止 TS 侧先行新增未注册命令到主分支**。

### ② 会话数据持久化 ✅ 已完成（2026-08-06，核查 + 处置落地）

**核心结论：核查发现桌面端会话/消息不持久化、删除会话不清理孤儿记忆；本轮已全部落地。**

> 下述「核查明细」为处置前的事实记录（保留作背景）；「处置落地」为本轮实现。

**核查明细（处置前）**：
- **桌面端会话/消息（重构后丢失）**：`AgentCommandService` 的 `sessions`/`meta` 纯内存，无 SQLite 落盘；旧结构 `SessionRepository` 随重构删除，全 `crates/` 零命中。
- **删除会话不清理记忆（孤儿数据隐患）**：`delete_session` 只移除内存，不删记忆 SQLite 行。
- **Web 端（正常）**：Dexie/IndexedDB，删除会话级联清理图片。

**处置落地**：
- **会话持久化存储层**：新增 [`session_store.rs`](d:\本地化AI\DeepSeek_Home\worldsmith\crates\agent-commands\src\session_store.rs) — `SessionRepository` trait + `SqliteSessionRepository`（`sessions` 表 + `messages` 表，WAL 模式，消息级联删除）。4 个单测通过（save/load 往返、消息替换、级联删除、跨重启持久化）。
- **服务层写穿**：`AgentCommandService` 增 `session_store` 字段 + `with_session_store`；`new_session`/`send_message`/`clear_history`/`trim_context`/`delete_session` 各操作写穿（弱提示，失败仅记日志）。
- **启动恢复**：`restore_sessions` 从存储加载全部会话经 `AgentLoop::restore_state` 重建（system 去重），Tauri `lib.rs` 启动时创建 `sessions.db` + 注入 + 调用恢复。
- **孤儿记忆清理**：`MemoryAccessor` 增 `delete_by_session_id`，`MemoryCenterAccessor` 实现为枚举 Daily/Weekly/Monthly 三档，先删记忆文件再删索引钩子（防幽灵摘要）。含单测。
- **前端**：`useAgentRust` 已通过 `list_sessions`/`get_messages` 透明消费恢复结果，**无需改动**。
- **TL 缺口**：沿用写穿 + 启动恢复，**不注册 `cmd_session_save`**（无独立保存入口语义，避免与写穿重复）。

### ③ Web 端 memory-archive 清理 ✅ 已完成（2026-08-06，评估结论：保留，不清理）

**核心结论：Web 端 memory-archive 是活代码，不可删。**

核查明细：
- import 图谱命中 **25 个文件**，其中核心 UI 被主界面真实挂载：
  - `agent/AgentChat.vue` → `ArchivePanel.vue` + `ChunkViewer.vue`（Web 聊天主界面的记忆面板）
  - `agent/AgentOverlay.vue` → `AgentSessionPanel.vue`
  - `ArchivePanel.vue` 内部再挂 `archive/{HookList,Search,Stats,Trash,Merge}View.vue` + `ArchiveConfigPanel.vue`
  - 核心库 `memory-archive/`（index/useMemoryArchive/useArchiveTriggers/archiveToolsRegistry/adapters/*）被 `useChatMetrics`/`useChatSession`/`useProjectSwitcher`/`SessionSidebar` 等引用
- **Web 聊天后端未接通 Rust**（`AgentChat.vue` 仍走 TS 后端），Web 端唯一记忆实现就是这套 TS memory-archive，**删除即破坏 Web 聊天记忆功能**。
- 与阶段 5 结论一致：**待 Web 聊天接入 Rust 后端后再迁移清理**，本次不删。

### ④ 桌面冒烟验证 🔲 待执行（依赖 LLM 配置）

验证用例：
1. 宽松配置 + 心跳正常（new_session 不报错，get_heartbeat 非 null）
2. LoopControlStatus 面板（若存在）刷新正常
3. 记忆跨轮次 recall：首轮发送 `记住 X` 后 user 归档 → 次轮聊 Y → 用「记忆」tab 检索 X 能命中

## 九、转方向说明

> 本节由 2026-08-06 用户决策创建：**记录完成后转方向**，新方向见用户后续输入。
>
> 上方 ②③④ 项积压若转方向后不属于当前主题，可挂起留待后续清理阶段集中处理。

## 十、风险与权衡

| 风险 | 说明 | 缓解 |
|------|------|------|
| vendor 双轨演进 | 复制后 WorldSmith 内副本与 MemoryCenter 分叉 | 约定冲突时以哪边为准；必要时用 git 子模块替代 |
| 依赖面膨胀 | core-logic 引入 rusqlite/jieba-rs/moka/dashmap 等 | 仅引 core + core-logic，跳过 MCP/HTTP/Python 层，控依赖面 |
| 存储后端未定 | SQLite 与文件树二选一未决 | Storage trait 可插拔，先实现 SQLite 全链路，文件树作为备用切换 |
| 前端旧 UI 残留 | TS memory-archive 组件短期并存 | 阶段 4/5 逐步迁移与清理 |

## 十一、验证标准

- `cargo check`（agent-memory / agent-runtime / tauri）0 errors
- 单测：MemoryCenterAccessor 的 recall/inject/archive/get_archive_boundary 映射正确
- 集成测：ReAct 循环内真实归档 + 检索闭环（`#[ignore]` 标注真实 LLM 用例）
- 桌面端冒烟：会话内记忆跨轮次 recall 生效
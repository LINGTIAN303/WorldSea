# MemoryCenter 召回集成计划（增强 WorldSmith Agent 记忆系统）

> **状态**：执行中（阶段 4 已完成前端迁移）
> **创建日期**：2026-08-06
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
阶段 5  清理：确认稳定后归档/移除 TS 版 memory-archive
```

## 六、风险与权衡

| 风险 | 说明 | 缓解 |
|------|------|------|
| vendor 双轨演进 | 复制后 WorldSmith 内副本与 MemoryCenter 分叉 | 约定冲突时以哪边为准；必要时用 git 子模块替代 |
| 依赖面膨胀 | core-logic 引入 rusqlite/jieba-rs/moka/dashmap 等 | 仅引 core + core-logic，跳过 MCP/HTTP/Python 层，控依赖面 |
| 存储后端未定 | SQLite 与文件树二选一未决 | Storage trait 可插拔，先实现 SQLite 全链路，文件树作为备用切换 |
| 前端旧 UI 残留 | TS memory-archive 组件短期并存 | 阶段 4/5 逐步迁移与清理 |

## 七、验证标准

- `cargo check`（agent-memory / agent-runtime / tauri）0 errors
- 单测：MemoryCenterAccessor 的 recall/inject/archive/get_archive_boundary 映射正确
- 集成测：ReAct 循环内真实归档 + 检索闭环（`#[ignore]` 标注真实 LLM 用例）
- 桌面端冒烟：会话内记忆跨轮次 recall 生效
## 迭代主题 10：子 Agent 规格 SQLite 持久化（重启不丢失）

> 子 Agent 规格注册表默认只在内存（`Arc<RwLock<Vec<SubAgentSpec>>>`），应用重启后用户在前端「子 Agent」标签页配置的规格会全部丢失。本轮把规格持久化到 SQLite，应用重启后自动加载，注册/删除写穿。

### 决策点 39：以 JSON 整条存规格，而非逐列拆字段

**背景**：`SubAgentSpec`（id/name/description/system_prompt/tools_whitelist/max_iterations）已 derive `Serialize/Deserialize`。持久化有两条路线：
- **A. 逐列拆字段**：`sub_agent_specs(id, name, description, system_prompt, tools_whitelist, max_iterations, ...)`。每次给 `SubAgentSpec` 增删字段都要跑一次 `ALTER TABLE` 迁移，且 `tools_whitelist`/`max_iterations` 是 Option/嵌套结构，需额外序列化。
- **B. JSON 整条存**：单表 `sub_agent_specs(id TEXT PK, spec_json TEXT, updated_at INTEGER)`，`spec_json` 存整条 `SubAgentSpec` 的 JSON。

**选择 B**。理由：`SubAgentSpec` 未来增删字段时**零 schema 迁移**——旧 JSON 反序列化缺字段走 serde 默认，新 JSON 直接入库；用 sqlx 0.8（与 agent-runtime 的可选 sqlite 特性对齐）。

### 决策点 40：存储层抽象为 `SubAgentSpecStore` trait，SQLite 实现返回 `Arc<Self>`

**选择**：定义 `SubAgentSpecStore` trait（`load_all`/`upsert`/`remove`），SQLite 实现 `SqliteSubAgentSpecStore`。`new(path)` 返回 `Arc<Self>`，用 WAL 日志模式（读写不互斥，适合"低频写 + 高频读"的规格注册表），`max_connections=5`；另提供 `new_in_memory()`（单测用，`max_connections=1` 保证同 Pool 内数据跨查询可见，模拟"重启后仍能读到"）。

**理由**：trait 抽象便于单测用内存实现验证业务逻辑、不经真实 DB；返回 `Arc<Self>` 让 `AgentCommandService` 直接持有 `Arc<dyn SubAgentSpecStore>` 共享引用。

### 决策点 41：持久化层可选（`Option<Arc<dyn SubAgentSpecStore>>`），`None` 保持纯内存

**选择**：`AgentCommandService` 新增 `subagent_store: Option<Arc<dyn SubAgentSpecStore>>`。构造提供两个入口：`default()`（`None`，行为与改造前完全一致，单测/无持久化场景）与 `with_subagent_store(store)`（`Some`，启动时 `load_all` 装入内存注册表）。

**理由**：不破坏既有构造路径；持久化是增强而非替换，纯内存模式零回归。

### 决策点 42：写穿缓存——先改内存注册表（释放锁）再写库，DB I/O 不阻塞读锁

**背景**：规格注册表是跨会话共享的 `Arc<RwLock<Vec<SubAgentSpec>>>`。若在持写锁的代码块内执行 DB I/O，写入慢时其他会话的读会被阻塞。

**选择**：`register_subagent_spec`/`remove_subagent_spec` 采用写穿模式：先在 `{ }` 作用域内改内存注册表（释放写锁），再在锁外执行 `store.upsert/remove`。DB 失败仅 `tracing::warn` 记录"仅内存生效"，不阻断主流程。

**理由**：DB I/O 是慢路径，不应阻塞高频读锁；写穿失败降级为纯内存，核心功能不受影响。

### 决策点 43：Tauri 在 `setup` 中初始化 SQLite，库文件放应用数据目录，用 `block_on` 安全初始化异步存储

**选择**：`apps/tauri/src-tauri/src/lib.rs` 的 `.setup(|app| ...)` 中：
1. `app.path().app_data_dir()` 定位应用数据目录，`create_dir_all` 确保存在。
2. `db_path = app_data.join("subagent_specs.db")`。
3. 用 `tauri::async_runtime::block_on` 包裹异步初始化（`SqliteSubAgentSpecStore::new` + `AgentCommandService::with_subagent_store`），成功后 `app.manage(svc)`。

**理由**：`setup` 是同步上下文，需 `block_on` 才能安全调用异步构造函数；库文件放应用数据目录（非临时目录）才能跨重启持久。

**代价**：`setup` 内的 `block_on` 会阻塞窗口首帧（初始化 DB + 建表极快，毫秒级，可接受）。若未来需要懒加载，可改为 `OnceLock` 延后到首个命令调用时初始化，本迭代不做。

## 影响范围（迭代主题 10）
- `crates/agent-commands/Cargo.toml`：新增 `sqlx`（sqlite + runtime-tokio）与 `tempfile`（dev）。
- `crates/agent-commands/src/subagent_store.rs`：`SubAgentSpecStore` trait + `SqliteSubAgentSpecStore` 实现 + 2 个单测。
- `crates/agent-commands/src/lib.rs`：`subagent_store` 字段 + `with_subagent_store` 构造 + 注册/删除写穿 + 持久化单测。
- `apps/tauri/src-tauri/src/lib.rs`：`setup` 初始化 SQLite 并注入服务。

## 验证方式（迭代主题 10）
- `cargo test --lib`（crates/agent-commands）：29/29 通过，含新增 `subagent_store::tests::upsert_load_remove_roundtrip`、`subagent_store::tests::persists_across_restart`、`tests::subagent_specs_persist_through_store`、`tests::remove_subagent_spec_persists_through_store`。
- `cargo check`（apps/tauri/src-tauri）：通过。
- `pnpm exec vue-tsc --noEmit`（apps/tauri）：通过（持久化对前端透明，命令层无改动）。


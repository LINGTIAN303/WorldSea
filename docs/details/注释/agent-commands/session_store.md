# session_store.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/session_store.rs` 的模块级与长注释块，按主题归并至此。
> 代码内原位置保留一行简要注释 + 本文件相对路径。
> **同域文件**：`session_branch.rs`（分支存储与收敛原语）· `session_fork.rs`（分叉执行链）同属会话族，
> 设计与裁定依据见 [04 会话模型草案](../../../plans/2026-09-21-ZCode能力内化方向探究/04-会话模型草案.md)。

---

## 一、定位与分层

会话持久化是**可选层**：未注入 `SessionRepository` 时命令层纯内存运行（测试与轻量场景）；
注入后会话头 / 消息 / 日志 / 快照全部写穿 SQLite（WAL 模式：读写不互斥，适配
「低频写 + 高频读」的会话列表场景）。

存储面按用途分四组：

| 组 | 表 | 事实源地位 |
|---|---|---|
| 会话头 | `sessions` | 装配面（提示词段 / 场景 / 工作区 / 项目锚点） |
| 消息三层 | `session_log` / `session_live` / `session_events` | **不可变日志 + 活跃视图 + 事件流**（见 §二） |
| 请求快照 | `request_snapshots` / `request_blobs` | 任一请求的结构级重建链（见 §三） |
| 会话分支 | `session_forks` / `session_checkpoints` / `session_branch_ops` | 分叉 / 回滚 / 检查点（见 §四） |

**FK 级联**：除 `request_blobs`（内容寻址去重池，可跨会话复用）外，全部子表
`REFERENCES sessions(id) ON DELETE CASCADE`——删会话即全链清理，`delete_session`
无需任何额外清理代码（sqlx 默认开启 `PRAGMA foreign_keys`）。

---

## 二、三层模型：不可变日志 / 活跃视图 / 事件流

```
session_log    只增不改不删；每条消息**版本**只写一次，带稳定坐标 log_offset
session_live   活跃视图：position → log_offset 游标（可重写）
session_events 每次同步追加一条事件（initial / append / trim / revise / noop）
```

- **坐标稳定性是锚点机制的前提**：`log_offset` 在整个会话生命周期内只分配一次、
  永不复用、永不修改。旧 `messages` 表式全量替换快照做不到这一点（同一位置在不同
  时刻指向不同消息），故在 A1 丙2 阶段 B 改为本模型（`messages` 表降级为历史留痕，
  一次性迁移后不再读写）。
- **裁剪 = 解除引用**：从视图移除的消息只删 `session_live` 游标行，日志内容与坐标
  完整保留（「已移出视图」≠「已删除」）。日志面板据此区分活跃 / 已移出。
- **replace_messages 的「首尾夹逼」**：新视图与旧视图逐字比对，前缀与后缀段沿用旧坐标、
  仅中段新分配坐标——同一内容在日志里天然去重，只有真正的新版本才落新行。
  事件类型由 (新增数, 移出数) 组合推出：`revise` / `append` / `initial` / `trim` / `noop`。
- **视图同步是单事务**：分配坐标 → 追加日志 → 重写游标 → 追加事件，四步原子提交；
  崩溃不会留下「日志有、视图没有」的半状态。

---

## 三、请求快照与结构级重建（08 重建链）

每次请求派发前采集「除消息以外的一切 + 视图增量」（阶段 3 · ④，D9-D14 裁定）：

- **视图增量判据**：上条快照视图是当前视图的**前缀**（逐字段等值比对，**不是哈希**——
  假前缀会静默损坏重建结果，宁可多记一次全量）→ `Appended`（只记新增）；否则 `Full`（全量）。
- **重建规则**（`reconstruct_request_view`）：按序号升序，`Full` 重置基底、`Appended`
  拼接增量；**链不完整**（增量先于任何全量）或目标序号缺失 → `None`——**拒绝重建，
  绝不给出错误结果**（宁可说「重建不了」）。分叉 / 回滚的锚点即建立在此之上。
- **落库路径**：命令层监听器在派发前把快照行**同步**追加进会话 WAL 文件，异步批量
  落库（`request_snapshot.rs`）；崩溃后下一次装载补齐。`request_blobs` 按内容哈希
  去重系统提示词与工具 schema（同提示词跨会话只存一份）。
- **幂等**：整条快照的内容摘要作幂等键（`UNIQUE (session_id, snapshot_digest)`），
  WAL 重放不会产生重复行，也不占用新序号。

---

## 四、会话分支：分叉 / 回滚 / 检查点（S3 会话族）

**锚点 = 请求边界（`request_seq`）**，复用重建链坐标，不新造第二套游标（ZD1-1）。

| 操作 | 语义 | 落库形态 |
|---|---|---|
| 分叉 `fork` | 子会话初始视图 = 父会话在 `request_seq` **派发时**的消息视图（含该请求输入、不含其响应及之后）；父会话零影响；不携带工具会话 / 长任务状态（ZD1-5） | 新 `sessions` 行 + 视图写入（坐标独立从 0 起）+ `session_forks` 来源记录 |
| 回滚 `rewind` | 向活跃视图追加一条 replace（回退到目标边界视图），**日志不删**——可再回退、可再前行（ZD1-2：默认域 conversation） | `session_live` 游标重写 + `session_events` 追加 |
| 检查点 `checkpoint` | 手动 + 每 N 请求自动（ZD1-4，N=10）；= 锚点指针 + 保留策略（手动 + 自动合并计数，保留最近 50） | `session_checkpoints` 行（kind：manual / auto） |

**事务括号（沿用压缩锁范式）**：三类操作先落 mark（`session_branch_ops`，payload 携
定位信息）→ 执行 → 成功清 mark。**mark 未清 ⇔ 操作未提交**（调用方从未收到成功）。

**装载期冷修复**（`reconcile_residue`，经 `restore_sessions` 接入且**先于**空会话清理与
会话装载——顺序有意义：否则半成品子会话会被重建为内存幽灵）：

- `fork` 残留 ⇒ **撤销半成品子会话**（内容可由父快照重放，删除无信息损失；
  留存则会成为无来源记录的幽灵会话）。行不存在（崩溃于建行之前）只清 mark。
- `rewind` / `checkpoint` 残留 ⇒ 只清 mark，不撤销数据——终态自洽（视图回退无损、
  检查点为单行插入），撤销反而引入新风险。
- 收敛幂等；失败不阻断恢复（warn 留档）；`reconcile_branch_ops`（单会话、只清 mark）
  保留为低层原语。

---

## 五、派生缓存与写穿矫正

两个「列只是缓存」的例外（事实源在别处）：

- **`workdir`**：事实源 = `workspaces.root`（经 `workspace_id` 关联）。写路径恒双写；
  读路径（`list_sessions` / `restore_sessions`）**实体优先**；启动期对不一致的存量
  **写穿矫正**（否则每次读都要内存矫正、DB 永远脏）。
- **`message_count`**：仅创建期写入、不随消息更新（X1 缺陷）→ 恢复时从实际恢复的
  消息数**派生**，不读列值（避免重启后「归 0」）。

**场景主权自愈**：历史脏数据（跨场景残留 workdir）恢复时按领地判定矫正回本场景根，
并 `ensure_workspace` 实体化后两参写穿（防重启反复回退）。

---

## 六、已知边界（随批登记）

- **工作区回滚不纳入内核**（ZD1-3）：写作数据（实体 store）回滚由领域层另立项。
- **分支操作 mark 只在进程存活期间有意义**：装载时一律视为崩溃残留（保守语义）。
- **检查点是「指针」不是「快照」**：只记 `request_seq` 坐标，内容由日志 + 快照链承载。
- **统一检查点视图（S3-f 合并裁定）**：会话锚点与长任务断点经 `list_checkpoint_refs`
  合并为单一概念面（`CheckpointRef`，`agent-engine::contracts::checkpoints`）——
  存储各归其位（锚点表 / `long_tasks`），保留策略天然分治；任务断点在引入会话绑定前
  `session_id = None`（引用式，快照本体不搬家）。
- **命令可见面（S3-e2 已接线）**：`fork_session` / `rewind_session` / `create_checkpoint` /
  `list_checkpoints` 四命令（Tauri 薄包装）+ 内存态同步（fork 建子 AgentLoop 并继承
  Provider 配置；rewind 同步 `restore_state`，**运行中拒绝**——`rewind_guard`）+
  三事件经总线广播（前端通道 `agent:event:session_branch:{session_id}`）。
  前端交互（分叉/回滚/检查点 UI）与 `forked_from` 展示随 UX 排期。
- 不做多端 replayable 投影 / 跨设备同步（04 §四）。

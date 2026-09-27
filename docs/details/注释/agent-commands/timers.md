# timers.rs / timer_tools.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/timers.rs` 与 `src/timer_tools.rs` 的模块级与长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 立项：`docs/plans/已完成/2026-09-18-对话区对齐dsh/03-对照与建议清单.md` §三 S1（设计与验收）· §七 D6-D9（拍板）。

---

## 一、为什么需要（S1 需求来源）

Agent 遇到「需要等一会儿」的场景时此前只有两条烂路：**忙等轮询**（消耗轮次且浪费）
或**直接放弃**。用户追加需求把这件事收敛成一个工具族：

| 能力 | 说明 |
|---|---|
| 倒计时唤醒 | 设置 N 秒后自动唤醒本会话继续干活（不阻塞当前任务） |
| 后台输出捕获 | 倒计时期间捕获指定 PTY 会话的输出，到点随唤醒一并送达 |
| 提醒事项 | 设定时挂 `note`，到点载荷带上（提醒「为何等待」） |

**关键判断：这不是新体系，而是组合既有原语**——唤醒走 inbox `FollowUp`（空闲即新开一轮 /
运行中入队待准入）、会话实例表常驻、PTY 输出缓冲本就有游标式增量读（`read_from`）。
本批只补三样东西：**持久化记录**（跨重启）、**到点调度**、**模型可见的三件套工具**。

---

## 二、数据模型与状态机（`session_timers` 表）

```
pending ──(到点认领 claim_timer_fired)──> fired
   └────(用户取消 cancel_timer)─────────> cancelled
```

- **一次性**：不做周期（dsh `every_seconds` 留二期）
- **认领即触发**：`claim_timer_fired` 是原子 `UPDATE ... WHERE status='pending'`，
  `rows_affected == 1` 才算认领成功——这是**幂等的唯一闸门**：
  - 重启后装配扫描（`restore_and_arm`）与运行期后台任务可能同时到达 → 只有一个赢
  - 重复装配（同会话被恢复两次）不会重复唤醒
- **FK 级联**：`session_id REFERENCES sessions(id) ON DELETE CASCADE`——会话删除时
  定时器随清理，与 messages / session_log 同口径（`delete_session` 无需新增清理代码）
- **cursors 快照**：`set_timer` 时记录各 watch 会话 `SessionOutputBuf::end()`（绝对字节偏移），
  到点用 `read_from(cursor)` 取「倒计时期间新增」——不重读历史、不吞并发写入

**为什么存 JSON 列而不是子表**：watch 与 cursors 是**设定时一次写定的不可变快照**，
不参与查询/更新（无「按会话查 watch」需求），存 JSON 最简且与既有 `prompt_sections` 同风格。
`timer_from_row` 对坏 JSON 容错（退化为空集合），不阻断读取。

---

## 三、唤醒载荷与来源标记（跨层契约）

载荷是**纯函数** `build_wake_payload`（契约测试锁定），结构：

```
[定时唤醒] 定时器到点（timer-xxx）（补投：应用重启后到期）
设置时间：…｜倒计时：30s｜到期：…
提醒事项：<note>
后台输出捕获（watch 会话，自设定时刻起的增量）：
--- session-a ---
<clean_ansi 后的输出；超限则尾部截断并标注；会话已销毁则标注>
--- 以上为定时器自动投递；请基于捕获内容继续你之前的任务（…）。
```

**来源标记链路**（这是本批唯一跨三层的新契约）：

```
TimerRunner::fire_if_pending
  → submit_input_with_meta(FollowUp, text, { input_kind: "timer", timer_id, … })
  → InputItem.meta（inbox 携带）
  → consume_admitted_inputs：assemble_input_meta(kind, custom)  ← 自定义覆盖内建语义串
  → OrchestratorMessage.meta = { input_kind: "timer", … }
  → 前端 rebuildFromMessages 读 meta.input_kind → TurnUserMessage.inputKind
  → flatRowToStreamItem 写入 msg.metadata → UserRow 判定 isTimer → 定时唤醒行
```

**为什么用 meta 覆盖 `input_kind` 而不是新增字段**：`input_kind` 本就是「来源语义」槽
（followup / steer / inject），timer 是第四种来源；`meta` 是自由 map，加键零类型改动，
且前端已有一条 `meta` 透传通道（`RustMessage.meta` → `AgentMessage.metadata`）。

---

## 四、护栏与失败语义

| 项 | 口径 | 理由 |
|---|---|---|
| 倒计时范围 | `10..=86400` 秒 | 下限防「设 1 秒等于没等」；上限 24h 防「忘了的定时器」 |
| 每会话未到期上限 | 8 | 防模型批量设定时器堆积 |
| watch 会话不存在 | `ArgsParse` fail loud（附现有会话清单） | 到点才报「已销毁」太晚；设定时就让模型改 |
| 子代理内调用 | `TIMER_UNAVAILABLE` 失败结果（三件套一致） | 定时器属主会话；子代理共享父总线、无独立 session 实例（同 ask 的 `ASK_UNAVAILABLE` 口径） |
| 无 store（未配置持久化） | 三件套不注册 | 无持久化则跨重启语义不成立，注册只会误导 |
| 认领失败 | 静默跳过（不注入、不报错） | 幂等路径的正常分支（已触发/已取消） |

---

## 五、已知边界（如实登记，未处置）

1. **watch 只覆盖 Agent 侧 PTY 会话池**：`ShellSessionManager` 在 `new_agent` 内按会话创建
   （本批已提升为可注入，终端工具与定时器同源）；**前端终端面板是另一份独立池**
   （`TerminalService`，Tauri 单例），二者不互通 → 模型无法捕获「用户在面板里跑的」会话。
   要打通需把面板会话纳入同一池或新增跨池查询接口（另立项）。
2. **无「周期定时」**：一次性（拍板 D8）；周期需求另议。
3. **到点唤醒不保证「立刻」**：`FollowUp` 运行中会入队等下一轮准入——这是**有意**的
   （不打断进行中的 LLM 调用）。
4. **载荷体积**：捕获段按会话 ≤2000 字符（尾部截断）+ 总 watch 数受上限约束，
   不会撑爆上下文；超限有显式标注。
5. **后台任务的 Arc 保留期**：`arm` 的 spawn 任务持 `Arc<TimerRunner>`（内含 `Arc<AgentLoop>`），
   最长存活到 `fire_at`（≤24h）。会话提前删除时**正确性不受影响**（记录已随 FK 级联清理 →
   认领必然失败 → 不注入），但 `AgentLoop` 实例会被多留到到点。若将来成为问题，
   可在 `fire` 前加「会话是否仍存在」的短路（当前不做：认领闸门已保证正确性，属内存优化）。
6. **`snapshot_cursors` 的 TOCTOU**：设定时刻取游标与写入记录之间若有新输出，该段输出
   会计入「倒计时期间增量」（误差 = 毫秒级）；不影响语义（载荷本就声明「自设定时刻起」）。

---
status: 执行中
---

# VibeCoding 编排模式链路落地执行

> 依据：[VibeCoding编排模式链路设计.md](./VibeCoding编排模式链路设计.md)（V1.0 设计定稿）
> 本文档跟踪设计 → 代码的落地进度与关键实现决策；设计本身不在本文重复。

## 落点决策（已定）

| 决策 | 结论 | 理由 |
|---|---|---|
| M1 骨架落点 | `crates/agent-patterns/src/orchestrator/` 新模块 | 不新增 crate（架构变更需确认，模块化最小侵入）；async-trait/tokio/serde 依赖已齐 |
| 与现有 7 模式的关系 | M1 不触碰 got/multi_agent/plan_execute/reflective/router/supervisor/tot；统一改造（适配为 OrchestratorNode）属 M3 | 骨架先行，模式适配逐个迁移，风险最低 |
| LlmHandle 归属 | orchestrator 模块自定义 trait（设计 §8.5），M5 再做 kernel Backend → LlmHandle 适配器 | 骨架自包含可测；上层只认 trait |

## 阶段进度

- [x] **M1 骨架**（2026-08-29 完成）：OrchestratorNode / Port / NodeResult / Blackboard / DefaultOrchestrator（端口路由、预算门、Spawn 挂接、快照恢复、终局三分）＋ Single Agent 端到端验收
- [x] **M2 循环层**（2026-08-29 完成）：Tool Use / ReAct / Self-Refine / Reflection / Plan-and-Execute 六循环全部落地（依赖序 Tool Use → ReAct → 其余），三分终止全分支测试通过
- [x] **M3 框架层**（2026-08-29 **全部完成**，13 模式齐）：一/二/三批（CompositeNode；车道并发+wait-set；作用域前缀；Router/Multi-Agent/Supervisor）+ **尾批 `tot.rs`（§6.1 树搜索：expand/evaluate/prune/select + `tot.tree` + 分数饱和提前收敛 + 候选打磨内嵌 Self-Refine）、`got.rs`（§6.2 split→并发车道→merge→evaluate 环回，`got.graph`/`got.phase` 状态机）、`loop_engineering.rs`（§6.6 四闸门：局部预算门 best-effort / ConvergePolicy 收敛门 / compact 压缩门 / 指数退避门包 inner）**
- [x] **R14 修复**（2026-08-29 完成）：toolresult 角色名三态兼容 + 2 条回归用例（vitest 263/263 + vue-tsc 0）
- [x] **M4 横切**（2026-08-30 完成）：`memory_store.rs` LayeredMemoryStore（四层存储/关键词跨层召回/before 召回注入/after 空条目裁量/`archive_run` 终局归档点（情景+程序性）/快照往返宿主持久化契约）+ RouterNode `with_few_shot_provider` 从程序性记忆动态加载（§6.5/7.4 闭环）
- [x] **M5 通信层**（2026-08-30 完成）：`genai_adapter.rs` KernelBackendLlm（kernel `NodeBackendAccessor` → orchestrator `LlmHandle`；用量口径统一 Option<u32>→Usage+llm_calls=1；全链路 Single Agent 端到端验证「换 Provider 上层零改动」）
- [x] **前端行段模型 v2**（2026-08-29 完成）：`ActionSegment.rowKind` 六类（搜索/终端/文件/命令/工具/其他）数据层分类 + ToolRow 分类行卡（kind-* 视觉：终端/命令等宽命令主显、文件/搜索/工具分色）+ 3 条分类用例；浏览器回源冒烟实证（命令段等宽、kind-command/kind-tool 分布正确）

## M1 实现记录（已落地）

- 落点：`crates/agent-patterns/src/orchestrator/`（types / error / blackboard / context / handles / node / graph / executor / single_agent / tests + mod），lib.rs 挂载
- **测试 19/19 全绿**（agent-patterns 全量 120/120）；覆盖：Single Agent 端到端（M1 验收）、Branch 谓词路由、Loop 回边、预算门治理终止、取消、Retryable 重试（上限内/超限）、Spawn 挂接 + return_map 回接、快照间隔 + resume 步号连续、记忆前后钩子
- 与设计的偏差（记录备查）：
  1. `restore(&self)` 而非 `&mut self`——节点以 `Box<dyn>` 存图，有状态节点用内部可变性；执行器持不可变引用即可级联恢复
  2. M1 Spawn 为「作用域栈」顺序挂接（子图与父图共享黑板与台账）；车道并发 + wait-set 留 M3（只扩执行器就绪集合调度，不动节点契约）
  3. `after` 钩子每节点边界必调（空条目也调），沉淀与否由记忆层裁量——与 4.2 第 4 步语义一致
  4. `LlmHandle` M1 只含 `complete`；classify / react_step / propose_tool_call / complete_stream 随 M2 各模式需要逐个上（避免为不存在的调用者预建签名）
- 测试过程中发现并修正的执行器缺陷：取消令牌原先在 `run()` 内新建导致注入失效（现 `with_cancel()` 注入，与节点共享同一份）

## 下一步接续点（压缩后从这里继续）

0. **M4 横切**（下一片首选）：MemoryHandle 四层记忆（工作/情景/语义/程序性）存储实现 + before 钩子召回注入 + 任务终局归档点（设计 §7）；Router 的 few-shot 从程序性记忆加载（router.rs 已留 with_few_shot 槽位）
1. **M5 通信层**：GenaiAdapter（agent-kernel Backend → orchestrator LlmHandle 适配器，Provider 矩阵/降级链/计量）
2. **R6 已立项**：[2026-08-30-R6动作段持久化计划.md](./2026-08-30-R6动作段持久化计划.md)（待启动——后端转发/持久化载体/前端回源/路由 JSON 口径统一四部分）；**旧 kernel 7 模块双轨收口——含义已还原（2026-08-30 Harness 会话分析）**：M3 的"统一改造（适配为 OrchestratorNode）属 M3"实际执行变为骨架内重写 → patterns **顶层旧 7 模块**（got/supervisor/tot/multi_agent/plan_execute/reflective/router + shared，投放线 5 编排命令在用）与 **orchestrator/ 骨架原生 13 模式**（未接命令层）并行双轨。**终局已拍板**（Harness 调研 2026-08-30：渐进收拢到骨架、切一个废一个）；旧模块保留至骨架接命令层完成（物理约束，非拍板项）；施工计划见 [04-方案.md](./编排模式投放设计/04-方案.md) 尾部「编排双轨收拢施工计划」（S1 骨架接投放契约适配层 → S2 双跑对齐 → S3 逐命令切换 → S4 废弃旧模块）。**S1 执行时机已拍板（2026-08-31 用户确认开工）**：试点 = Plan-and-Execute；S2 观测口径 = 事件序列/产物/run_store 三项全对齐；M3-RK1 口径矛盾已核实（见 04-方案，05 台账「已解决」为正确口径）。**进度（2026-08-31）**：S1 ✅ 完成（B 轨 observer/seed/黑板快照 + 命令层 run_plan_execute_b + 事件桥 + 产物翻译；patterns 164 + commands 109 全绿）；S2 代码 ✅ 完成（内部方法 run_plan_execute_dual + DualRunComparison 报告；真机双跑待桌面实例+Key → 待测清单 T10）；S3/S4 待 T10 对齐通过后实施
3. 冒烟环境：温度参数 R15 已临时绕过（localStorage 0.7/0.9/8192）；测试用新会话
1. M4 横切（MemoryHandle 四层记忆）、M5 通信层（kernel Backend → LlmHandle 适配器）
2. 观察项（冒烟发现，待用户决定）：① shell 工具 `exit_code≠0` 目前判 completed（后端约定只认顶层 error 键），`head` exit 1 显示 ✓+exit 1 徽标组合略矛盾，建议 parseToolResult 增 exit_code≠0 → failed；② 浏览器模式路由后偶发静默停走（R4 SSE 范畴，桌面端待复验）
3. 冒烟环境注意：温度参数 R15 已临时绕过（localStorage 0.7/0.9/8192）；旧会话固化坏参数会 400，测试用新会话

## 验收记录

- 2026-08-29 M1：`cargo test`（agent-patterns）120/120 全绿；Single Agent 端到端验收通过（见 §M1 实现记录）
- 2026-08-29 M2：`cargo test`（agent-patterns）**141/141 全绿**（orchestrator 40/40 = M1 19 + ToolUse 5 + ReAct 5 + 收尾 11）。M2 全六循环落地：
  - 首批：`tools.rs`（ToolSpec/ToolCall/Observation/ToolHandle/TraceEntry）、`tool_use.rs`（直接回答 Done / 瞬态重试 / Fatal 上抛 / max_calls 治理性完成）、`react.rs`（回边循环 / max_turns / 连续 3 次失败 Fatal 且成功清零）、`m2_tests.rs`（10）
  - 收尾：`self_refine.rs`（版本键 `refine.draft@k` + ObjectiveSignal 客观指标：初稿达标 / 版本链 / 停滞 Fatal / 轮次上限）、`reflection.rs`（actor–critic 双角色独立 prompt：一次通过 / 修订后通过 / 震荡 Fatal / 轮次上限）、`plan_execute.rs`（`pne.plan`/`pne.cursor` + inner 黑盒执行器：顺序执行 / 失败重规划 / 超上限 Fatal）、`m2b_tests.rs`（11）
  - 实现决策：P&E 的 make_plan/assess/replan 与 Reflection 的 critic 均走 `complete` + JSON 约定（LlmHandle 保持 §8.5 方法集不膨胀）；测试中发现并修复 assess_step 丢用量上报的缺陷（纪律 5）
- 2026-08-29 M3 首批 + R14：
  - `composite.rs`：CompositeNode 经 `ctx.pending` 呈递子图（复用 M1 作用域栈——黑板与句柄天然直通），`exit_map` 映射 `return_port_map`；子图工厂幂等重建（Spawn 需所有权）；`outputs` 构造期定形（修 OnceLock 跨实例串端口缺陷）。**修复执行器嵌套回接缺陷**：子图终止回接只查最外层父图，现从剩余作用域由内向外查（嵌套组合任意深度）。快照聚合扩展到活跃作用域内全部子图节点（设计 4.6；已知限制：跨作用域同名 id 覆盖，后续以作用域前缀消除）
  - `m3_tests.rs`（4）：子图黑盒端到端 / 嵌套组合 / 内层快照聚合 / 构图失败 Fatal
  - **R14 修复**（前端）：turnModel.ts 角色三态兼容（`'toolresult'` serde lowercase 实际值）+ `RustMessage.role` 类型 + `rustMsgToTsMsg` 映射 + 2 条回归用例；验证 vitest **263/263** + vue-tsc exit=0
  - 汇总：agent-patterns **145/145**（orchestrator 44/44 = M1 19 + M2 21 + M3 4）；前端 vitest 263/263（R14 修复后）
- 2026-08-29 前端行段模型 v2：`classifyActionRowKind`（turnModel.ts，前缀/名单规则：shell_session_*→terminal、execute_command/git_*/pkg_*等→command、*search/graph_find_path→search、file_*/fs_*/read_file 等→file、entity_/notebook_ 等业务工具→tool、未知→other）；ActionSegment/FlatRow/ToolCallView 全链透传 rowKind（实时/回源同源单点）；ToolRow `kind-*` 行卡（终端/命令/文件等宽命令与路径主显，角标五色分类，仅动呈现不改行结构）；stream.css kind 段。验证：vitest **266/266**（turnModel 36 含 3 条分类用例）+ vue-tsc exit=0；浏览器回源冒烟：kind-command×4 / kind-tool×1 分布正确、命令段等宽主显、R14 后历史行恢复真实状态
- 2026-08-29 M3 二批（车道并发 + wait-set）：`SubgraphRequest` 改 enum（Single/Lanes）+ `LaneSpec`；executor 增 `run_lane`（车道执行：钩子照挂/Retryable 上限重试/局部 join 计数/终局端口返回）+ `join_futures`（零依赖 poll_fn 手写并发 join）+ Spawn Lanes 分支（黑板分身→并发→`merge_from` 汇合合并→return_map 回父图；车道 Fatal 端口→整链失败终局；`max_concurrency` 分批）；`Graph::with_joins/join_expect` 计数式 wait-set；**route 语义扩展**：`route_all` fan-out 多目标（修掉 M1 单目标丢失分支的缺陷）+ Branch 谓词组互斥（谓词命中胜出、兜底不生效——保持原 Branch 语义）；fan-out 构图校验放宽（同端口多边合法）。测试 +2（双车道并发合并 / 车道内 wait-set 汇合）。agent-patterns **147/147**（orchestrator 46/46）；agent-kernel 回归零影响
- 2026-08-29 M3 三批（作用域前缀 + Router/Multi-Agent/Supervisor）：Scope 增 `prefix`（`挂接节点#序::`），快照表与 join 计数 key 限定化（resume 取末段还原）；`router.rs` RouterNode（classify JSON + 置信度阈值 + low-conf 兜底 + route.choice 审计留痕 + few-shot 槽位，无 Loop 端口）与 AggregateNode（ma.results.* 收集合并）；`multi_agent.rs` MultiAgentNode（decompose JSON → Lanes 工厂派发，聚合交父图 AggregateNode，定向重跑留上层）；`supervisor.rs` SupervisorNode（决策 JSON 驱动派发/动态入队/角色目录内联黑盒工人/重派上限，sup.queue 全量入快照）。测试 +3。agent-patterns **150/150**（orchestrator 49/49）
- 2026-08-29 M3 尾批（TOT/GoT/Loop Engineering，**13 模式全部齐**）：`tot.rs`（ThoughtTree/`tot.tree`；expand `{"candidates":[…]}` → evaluate `{"score":…}` 独立评分器；top-b 剪枝；分数饱和提前收敛 + 深度上限；candidate_refiner 槽位内嵌 Self-Refine）；`got.rs`（phase 状态机 split→await-merge→await-evaluate + 父图环回边 Out→自身；车道工厂 Spawn 并发；merge `{"merged":…}` 解析）；`loop_engineering.rs`（ConvergePolicy 可插拔 + RoundConverge；局部预算门 >= 语义 best-effort 交付；compact_keep 压缩门；指数退避门 + attempts 上限）。测试 +6（m3c_tests）。agent-patterns **156/156**（orchestrator 55/55）
- 2026-08-30 M4+M5 + exit_code：
  - M4 `memory_store.rs`：LayeredMemoryStore（四层 `[Layer;4]`、`recall_keyword` 跨层关键词召回、`procedural_few_shot`、`archive_run` 终局归档点（RunReport→情景+程序性）、snapshot/restore 宿主持久化契约）；实现 MemoryHandle（before 召回注入/after 空条目不沉淀——沉淀裁量在记忆层）；RouterNode `with_few_shot_provider` 动态加载程序性记忆（设计 6.5 闭环）。MemEntry/MemLayer 补 serde（快照契约）
  - M5 `genai_adapter.rs`：KernelBackendLlm 包 kernel `NodeBackendAccessor`（trait 实名修正：Backend→NodeBackendAccessor；mock 补齐 steer/get_messages/set_messages/trim_context 四个必实现方法）；complete 映射 + 用量口径统一；端到端「换 Provider 上层零改动」验证（设计 8.4 分层验收）
  - exit_code≠0 判 failed（前端 parseToolResult：error 键 || __meta.exit_code≠0）
  - 汇总：agent-patterns **161/161**（orchestrator 60/60 = 前量 55 + M4 4 + M5 1）；前端 vitest **267/267** + vue-tsc 0
- 2026-08-30 实时流视觉冒烟（浏览器模式新会话）：深度思考回合 12 步骤·12 段推理全跑通（R4 未复发）；**实时态行卡分类实证**——kind-command×8（本回合全为 shell 命令，归类正确）、失败行 `✗ 执行失败[已失败]`（exit_code≠0 新判定实时生效）与成功行 `✓ exit 0 · 0.0s` 并存、推理/过程文本/命令交错、失败自适应重试循环完整；新观察项：路由器 JSON 决策泄漏为过程文本段（已并入 R6 立项口径统一节）。R6 立项文档落档
- 2026-08-30 桌面端实证 + R6 第一部分：桌面 shell（cargo run 连 5175 前端，app.emit 传输层）新会话回合全链路跑通（4 步骤·6 段推理，exit 0.9s/0.3s/2.4s 命令行卡全成功、推理/过程文本交错）——**桌面与浏览器双端实时行卡视觉均实证**。R6 第一部分完成：commands.rs `action_event_payload`（六类映射）+ `emit_stream_action`（流通道注入 type=action_event）+ A2UI 归 AgentEvent 分支；cargo check 通过；前端消费与持久化为第二/三部分（见 R6 计划进度节）

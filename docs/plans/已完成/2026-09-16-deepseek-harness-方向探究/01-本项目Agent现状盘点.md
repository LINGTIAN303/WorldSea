# 本项目 Agent 现状盘点（方向探究 · 共同基础）

> status: 已完成
> 性质：本文件是方向探究的**共同基础事实**——无论最终走[提取融合](02-提取融合方向.md)还是[以其为基](03-以其为基方向.md)，事实与边界都以本文为准。
> 取证方式：四路只读探索（代码盘点 + 文档核对），关键结论均附文件路径；未改任何代码。
> 关联：既有 [deepseek-harness 调研与借鉴方案](../../../misc/deepseek-harness-调研与借鉴方案.md)（Compaction 子系统专章，持续增长型）——本文与其互补，不重复。

---

## 零、结论速览

| 问题 | 结论 |
|---|---|
| 自研 Agent 规模 | Rust 自有 crate ≈ 6.2 万行（内核 2.1 万）；Tauri 壳 1.1 万；前端 Agent ≈ 6.9 万；TS 残留 3 万行**仍在活跃引用** |
| 主链路 | `useAgentRust.ts`（3347 行）→ 186 个 Tauri 命令 → `AgentCommandService`（3997+ 行）→ agent-kernel `AgentLoop` → genai backend |
| 可替换面（引擎层） | ReAct 循环、LLM 后端、工具总线 + FrontendToolBridge 双执行栈、编排骨架（agent-patterns）、MCP 实现、Skills 协议栈、会话压缩实现 |
| 硬边界（不可替代，外部引擎不认识） | 实体/芽系统、A2UI 呈现层、八文件规则体系、场景装配、长期记忆底座、群聊引擎 |
| 需桥接面 | 数据桥（Agent 动作→领域 store）、领域工具、事件协议转换、场景→引擎配置翻译 |
| 计划文档影响 | **可能作废 6 份**（编排线）；**需重写 3 份**（A1 记忆系统 / 权限与沙箱 / Harness 差距调研）；**部分保留 8 份** |

---

## 一、Agent 实现全貌（单次发送的完整链路）

### 1.1 链路分层

```text
[UI 层]
  AgentSpace.vue（消息流容器）+ AgentMessageList.vue（609 行）
  行段渲染：packages/shared-ui/src/agent/stream/rows/（ToolRow / ProcessSummaryRow 等）
      │
[TS Agent 门面]  apps/tauri/src/agent/composables/
  useAgentRust.ts（3347 行，唯一在用的 Agent composable）
  职责链：并发门控 → /compact 直通 → ensureModelKey → setupStreamListener
          → 造 user 消息 + 开轮次 → safeInvoke('send_message')
  useAgent.ts（19 行）= useAgentRust 的 re-export 芽
      │
[跨界点 ①：Tauri invoke]
  transport.ts（89 行）统一封装 invoke / invokeRpc / listen
  桌面走 IPC；另有浏览器直连的 [HTTP-BRIDGE]（http_bridge/rpc.rs，SSE 事件）
      │
[命令层]  apps/tauri/src-tauri/src/
  lib.rs 注册 186 个 #[tauri::command]（commands.rs 96 个）
  关键入口：commands.rs:1171 send_message（先 ensure_emitter_registered 再转发服务层）
      │
[服务层]  crates/agent-commands/src/lib.rs
  AgentCommandService（3997+ 行，118 个 pub 方法）
  装配集中：new_agent（:1661-1885）→ 建 GenaiBackend → SimpleToolBus → 注册
            terminal/fs/记忆/工作区/子 Agent/场景 extra/MCP → 逐项 with_* 注入 AgentLoop
  主链路 send_message:3544：classify_pipeline（3s 超时降级 Query）→ 一律走 agent.run（react）
      │
[内核循环]  crates/agent-kernel/src/agent/mod.rs
  run:596（RunPhase 五站位：BeforeReact/AfterUserMessage/OnToolCall/AfterReact/AfterRun）
  → run_react_loop:1162：步预算 → LoopController.check_all → build_prompt_options
    （agent/memory.rs:92：场景 prompt ∪ 静态 ∪ 记忆 ∪ 管线指引）→ backend.set_messages → call_llm_with_retry
      │
[LLM 层]  crates/agent-kernel/src/llm/
  genai_backend.rs（底层 genai 0.7.0-beta.16，native-tls）
  exec_chat_stream 流式聚合；ServiceTarget 直构；多 Key 降级；provider 元数据在 manifest.rs（689 行）
      │
[工具执行]
  ToolBus trait（tool.rs:91）→ SimpleToolBus（:182）/ 场景门控 WhitelistToolBus（:314）
  串并行分流（agent/tools.rs:370-424）；结果统一裁剪 clamp_tool_result_with（:85，保头 3/5 + 保尾 2/5）
      │
[跨界点 ②：事件回传]
  OrchestratorEvent（event.rs:80，60+ 变体）→ TauriAgentEventEmitter（commands.rs:31-418）
  → 前端监听 → turnModel.ts 归约（Turn/FlatRow/ActionSegment）→ shared-ui 行段组件
```

### 1.2 事件通道清单（跨界契约）

`commands.rs` 持有的通道：`agent:event:stream:{sid}`（十变体 + action_event/tool_delta/file_change/step_budget_warning）、`agent:event:trace:{sid}`、`agent:event:orchestration_trace:{sid}`、`agent:event:orch:{sid}`、`agent:event:orch_supervisor:{sid}`、`agent:event:orch_multi:{sid}`、`agent:event:a2ui:{sid}`、`agent:event:subagent:{sid}`、`agent:event:plan_created | plan_update | plan_replanned:{sid}`、`agent:confirm:{sid}`、`agent:session_title_updated`、全局 `agent:tool_call`（前端桥）。

前端消费的唯一归约器是 `packages/shared-composables/src/agent/turnModel.ts`，`ActionKind` 8 类（tool/subagent/plan/a2ui/confirm/phase/router/reflection，`turnModel.ts:28-36`）。

---

## 二、模块与规模清单

### 2.1 Rust 侧（crates/）

| 模块 | 职责 | 关键文件 | 规模（约行） |
|---|---|---|---|
| agent-kernel | 底座：执行契约 node.rs / 宿主引擎 orchestrator.rs / 最小闭环 agent/** / 资源服务 / 工程横切（loop_control·long_task） | `crates/agent-kernel/src/`（47 文件） | 21206 |
| └ 内核循环 | ReAct 循环、RunPhase、上下文预算与折叠压缩 | `agent/mod.rs` 1282；`agent/tools.rs` 701；`agent/memory.rs` 165 | — |
| └ LLM | genai 后端、流、provider manifest | `llm/genai_backend.rs` 1057；`llm/manifest.rs` 689；`llm/stream.rs` 604 | — |
| └ 安全 | HITL 三层确认、v2 规则引擎、工具生命周期钩子 | `confirmation.rs` 765；`permission_rules.rs` 284；`tool_hook.rs` 107 | — |
| └ 场景 | 5 场景（world/novel/general/coding/design）身份 prompt / 工具白名单 / 记忆档位 | `scenario.rs` 718 | — |
| agent-commands | 命令服务层：会话装配 / 编排行 / 终端 PTY / FS 工具 / 记忆工具 / 会话持久化 | `crates/agent-commands/src/`（23 文件） | 16413 |
| └ AgentCommandService | 服务面（118 个 pub 方法） | `lib.rs` 3997+ | — |
|  会话存储 | SQLite 会话库（不可变日志 + 活跃视图） | `session_store.rs` 2126 | — |
| agent-patterns | 统一骨架 Orchestrator（13 模式节点：tot/got/react/plan_execute/reflection/self_refine/supervisor/multi_agent/router/loop_engineering…） | `crates/agent-patterns/src/`（49 文件） | 13404 |
| agent-runtime | **纯聚合壳**：`pub use agent_kernel::*` + 旧路径转发 | `crates/agent-runtime/src/lib.rs` | 91 |
| agent-memory | MemoryAccessor 适配层（recall/inject/archive/治理/衰减/外置原文） | `crates/agent-memory/src/`（9 文件） | 7788 |
| agent-index | 工作区文件混合检索（BM25+jieba / 向量 / 边界感知分块） | `crates/agent-index/src/`（4 文件） | 2585 |
| worldsea-skills-store | 技能包 sha256/zip/版本纯逻辑（无 Tauri 依赖） | `crates/worldsea-skills-store/src/lib.rs` | 483 |
| vendor（记忆底层） | 记忆底层（core/logic/llm/models，非本仓原创） | `crates/vendor/` | 25130 |

### 2.2 Tauri 壳与前端

| 层 | 规模 | 说明 |
|---|---|---|
| Tauri 壳 | 11236 行（24 文件） | 186 命令 + 托盘/单实例/HTTP 桥 + 装配 |
| └ frontend_tool_bridge.rs | 378 行 | Rust→前端工具桥，**仅 7 个**（entity_create/update/delete、content_search、load_skill×3） |
| 前端 Agent | ≈69100 行 | `apps/tauri/src/agent` 17715（51 文件）/ `src/space` 31052（120 文件，含群聊）/ `src/subagent` 1678 / `packages/shared-composables/src/agent` 5649 / `packages/shared-ui/src/agent` 13050（70 文件） |
| TS 包残留 | 30274 + 6968 行 | `packages/agent-runtime/src`（136 文件）+ 技能 md/yaml（83 文件）；`packages/agent-core/src` 4808（21 文件）——**二者仍在活跃引用**（`apps/tauri/vite.config.ts:43` 的 `@agent/*` 别名） |

### 2.3 关键接口面

| 接口 | 内容 |
|---|---|
| 命令面 | 186 个 Tauri 命令；Agent 主链 96 个；`AgentCommandService` 118 个 pub 方法 |
| SQLite 表 | `sessions`（含 kind/plan/workdir/workspace_id/project_id/scene_id）、`messages`（**遗留，已不读写**）、`session_log`（不可变追加日志）、`session_live`（活跃视图游标）、`session_events`（规模三元组）、`group_chat_sessions`、`workdirs`、`workspaces`（`(root, scene_id)` 复合唯一） |
| 旁路库 | `subagent_specs.db`、`long_tasks.db`、`entities.db`、`secure_store.db`、`mcp.db`、`permission_rules.json`、记忆三库（`memories.db/memory_ext.db/memory_vec.db`，按 project 分片）、工作区索引库 |
| 场景装配 | `Scenario` trait（`scenario.rs:156-186`）：`build_system_prompt` / `tool_ids` / `builtin_skills` / `workspace_hint` / `memory_policy` / `extra_system_prompt_blocks` |
| LLM 接入 | `ProviderConfig::{Cloud, Local, Custom}` → `infer_api_type()` 决定 AdapterKind；`llm/manifest.rs` 静态注册 provider 与模型窗口；支持热切换 |

---

## 三、可替换面 vs 硬边界（核心判断）

### 3.1 可替换 / 可丢弃（引擎层——外部引擎能覆盖的）

| 现有实现 | 位置 | 性质说明 |
|---|---|---|
| ReAct 循环 + RunPhase | `crates/agent-kernel/src/agent/mod.rs` | 通用执行循环，外部引擎有等价物 |
| LLM 后端 | `crates/agent-kernel/src/llm/` | genai 适配层，可被等价 provider 体系替代 |
| 工具总线 + FrontendToolBridge 双执行栈 | `crates/agent-kernel/src/tool.rs` + `apps/tauri/src-tauri/src/frontend_tool_bridge.rs` + `packages/agent-runtime/src/tools/` | "Rust 总线缝合 TS 工具"的双执行栈是现行架构特有的债 |
| 编排骨架（13 模式节点） | `crates/agent-patterns/src/` | 通用编排，外部引擎有节点/流程机制 |
| MCP 实现 | `apps/tauri/src-tauri/src/mcp_client.rs` + `crates/agent-kernel/src/mcp.rs` | 通用协议客户端 |
| Skills 协议栈 | `packages/agent-runtime/src/skills/` | SKILL.md 是开放标准，双方同源 |
| 上下文压缩实现 | `crates/agent-kernel/src/agent/mod.rs` `enforce_context_budget` | 已有专章调研（见 misc 调研文档） |

### 3.2 硬边界（不可替代——外部引擎不认识，必须自留）

| 资产 | 位置 | 为什么必须自留 |
|---|---|---|
| 实体 / 芽系统 | `packages/entity-core/` + `apps/tauri/src/sprouts/official/`（28 目录） | 世界观领域的数据模型、视图扩展、28 个官方芽；与 Agent 引擎正交 |
| A2UI 呈现层 | `packages/shared-ui/src/agent/blocks/`（20 个 Block*.vue） | 结构化块的渲染契约（实体卡/列表/交互工具卡），引擎侧只认文本与工具事件 |
| 八文件规则体系 | `useAgentRust.ts` 常量组 + `agent/rules/WORLDSEA.md` + `packages/agent-runtime/src/tools/world-rules.ts` | 用户可见、可编辑的产品面；含 WORLD.md 节奏型注入（依赖实体写工具出口钩子） |
| 场景装配 | `crates/agent-kernel/src/scenario.rs` + `apps/tauri/src/space/chat/scenes.ts` + `sessions.scene_id` | "选场景决定 prompt/工具/记忆策略/工作区根"是独有会话契约（含 scenes_root 主权） |
| 长期记忆底座 | `crates/agent-memory/` + `crates/agent-index/` + 4 个 memory-center-* vendor crate | 跨会话记忆的写入四操作 / 矛盾调和 / 淘汰 / 项目隔离——外部引擎只管会话内日志与压缩 |
| 群聊引擎 | `apps/tauri/src/space/group-chat/`（GroupChatEngine + 8 个协作组件） | 多 Agent 会议语义（发言选择/话题追踪/终止判定/幻觉守卫/成本追踪） |
| 沙箱/权限的领域约束 | `confirmation.rs` + `permission_rules.rs` + 领域路径规则 | "三档语义 + L3 项目数据写保护（entities/、.worldsea/）"是领域安全边界 |

### 3.3 需桥接面（引擎更换时不可省略的接线）

| 耦合点 | 位置 | 桥接性质 |
|---|---|---|
| 数据桥（Agent 动作 → 领域 store） | `apps/tauri/src/agent/agentDataBridges.ts`、`useAgentPluginBridge.ts` | 数据/UI 动作分路由的唯一必达通道；上游从 TS 工具改为新引擎工具，桥本身保留 |
| 领域工具（实体 CRUD / KB / 芽写面） | `packages/agent-runtime/src/tools/entity-crud.ts`、`plugin-backend-tools.ts`（60+ emit 点）等 | 工具 `execute` 直接操作前端 store/芽；须以新引擎工具形态重新暴露 |
| 事件协议 | `crates/agent-kernel/src/event.rs` → `turnModel.ts` | 前端归约器与行段渲染绑定现行事件格式；换引擎须做协议转换或重写归约 |
| 场景 → 引擎配置 | `Scenario` trait → 引擎会话配置 | 场景的 8 装配面须翻译为目标引擎的会话/工具/提示配置 |

---

## 四、现状特征与技术债（影响判断的事实）

以下均为有证据的事实，不是评价；它们直接决定"换/融"时的施工面。

| # | 特征 | 证据 |
|---|---|---|
| 1 | **TS↔Rust 双轨且 TS 侧大面积不可达**：TS 注册 40 余组约 200+ 工具，Rust 侧仅桥接 **7 个** | `packages/agent-runtime/src/agent.ts:69-150` vs `frontend_tool_bridge.rs:227-331` |
| 2 | TS CoreBackend 已亡但接口壳仍在 | `agent.ts:285-325`（stub，注释自认"TS CoreBackend 已随端分离移除"） |
| 3 | **编排模式近乎不可达**：`send_message` 恒走 react，4 指令已取消；`pattern_registry` 注册 4 模式但唯一触发器（TS 工具 `pattern_step_run`）不在桥清单 | `agent-commands/lib.rs:3544-3660`、`pattern_registry.rs:74-148`、`pipeline-tools.ts:450` |
| 4 | 别名解析导致的死工具：6 个终端工具对 LLM 可见但每次调用返回 NotFound | `tool.rs:217-220`（注册不解析）vs `:264-273`（调用解析）、`alias.rs:21-26` |
| 5 | 场景白名单声明面 > 实现面（声明未实现项静默消失） | `scenario.rs:325-347/423-443/493-506` |
| 6 | A2UI 通道有消费者无生产者（内核无 broadcast，TS 生产工具未桥接） | `a2ui.rs`、`event.rs:71/654`、`commands.rs:398-418` vs 内核零生产点 |
| 7 | Prompt 组装职责分散双端（TS 拼规则/技能索引/工作区分区；Rust 拼场景身份/实体摘要/记忆/管线） | `useAgentRust.ts:2543-2650` vs `agent/memory.rs:92-173` |
| 8 | 持久化双写与回源缺口：`messages` 表废弃但保留；五类动作段（subagent/a2ui/phase/router/reflection）暂不可回源 | `session_store.rs:481-532`、`turnModel.ts:21-26` |
| 9 | 临时设施未清理（`[HTTP-BRIDGE]`、`cmd_diag_log` 等旁路命令与主链混在同一 handler 表） | `lib.rs:53-54、529-538`、`commands.rs:1218` |
| 10 | 测试与生产同 crate；主链文件单体偏大（`lib.rs` 3997+、`session_store.rs` 2126）；工具注册散落 6 处调用无统一注册表 | `agent-kernel/src/agent/tests.rs`（2193）、`lib_tests.rs`（1340）、`lib.rs:1722-1803` |

**对"可替换性"的凝练**：Agent 主循环的行为面收敛于两个 trait（`NodeBackendAccessor`、`ToolBus`/`Tool`）+ 一个事件枚举（`event.rs`）；若更换引擎，**最小替换面 = LLM 层 + ReAct 循环**，而工具/事件/持久化/场景/前端渲染是强耦合在 WorldSea 侧、须保留或桥接的部分。

---

## 五、计划文档受影响评估

> 判定口径：文档是否围绕"自研 Agent 内核/机制建设"展开——是则高度受影响（可能作废/需重写），领域与产品面文档不受影响或部分保留。

### 5.1 可能作废（6 份，均为编排/自研引擎线）

> **口径注记（2026-09-16 补）**：本节的"作废"判定是**针对方向二（以其为基）**——自研引擎被替换后编排线失去载体。**方向一（提取融合）已拍板：编排骨架保留，这 6 份不作废**（编排线去留是独立产品决策）；方向一下的实际处置（净影响远小于方向二）见 [04-施工准备 §五](04-施工准备.md)。

| 文档 | status | 作废理由 |
|---|---|---|
| [VibeCoding编排模式落地执行.md](../VibeCoding编排模式落地执行.md) | 执行中 | 跟踪自研 orchestrator 骨架 M1-M5；引擎更换后跟踪对象消失 |
| [VibeCoding编排模式链路设计.md](../VibeCoding编排模式链路设计.md) | 设计定稿 | 13 模式自研链路设计；同上 |
| [编排模式投放设计/](../编排模式投放设计/)（01/02/04/05） | 执行中 | 引擎层蓝图与风险台账；**产品契约（run/链/物/迹线的"可解释编排"诉求）可保留为 UI 契约** |
| [2026-09-09-编排双轨收口审查与6模块迁移.md](../2026-09-09-编排双轨收口审查与6模块迁移.md) | 执行中 | 双轨收口本身随自研引擎消失；**场景底座一节须拆出保留** |
| [2026-08-30-编排链路交接文档.md](../2026-08-30-编排链路交接文档.md) | 已完成（交接） | 历史交接性质 |
| [2026-08-31-Agent底层能力与三阶段成熟度.md](../2026-08-31-Agent底层能力与三阶段成熟度.md) | 待启动 | "Prompt/Context/Harness 三阶段"是自研内核的顶层叙事；补课项 A1/A2（记忆、语义检索）仍成立，需重估坐标 |

### 5.2 需重写（3 份，与外部引擎能力重叠）

| 文档 | status | 重写口径 |
|---|---|---|
| [2026-09-11-A1-记忆系统设计.md](../2026-09-11-A1-记忆系统设计.md) + [裁定清单](../2026-09-11-A1-记忆系统设计-裁定清单.md) | 执行中（已大量落地） | 与外部引擎的 session 日志 / compaction / 工具结果裁剪高度重叠：重叠点改"对齐机制"，独有部分（MEMORY.md interface、长期记忆治理、领域记忆）保留 |
| [2026-09-03-权限分级与沙箱耦合设计.md](../2026-09-03-权限分级与沙箱耦合设计.md) | 执行中（P0/P1 完成） | 与外部引擎的 approval / sandbox 重叠；"三档语义 + 项目数据写保护"是产品决策保留，实现层对齐 |
| [2026-08-30-Harness工程差距调研.md](../2026-08-30-Harness工程差距调研.md) | 执行中 | H 域差距结论整体重估（H2/H3/H1 多个缺口被外部引擎一次性覆盖）；H5/H6/H7 的产品面差距仍有效 |

### 5.3 部分保留 / 不受影响（8 份+）

| 文档 | 受影响程度 | 说明 |
|---|---|---|
| [2026-09-10-Agent能力面整顿审查.md](../2026-09-10-Agent能力面整顿审查.md)（v3） | 部分保留 | 清理项仍有效（对象换成新内核）；"Agent 插件系统立项"一章可整体转作外部引擎扩展机制的评估输入 |
| [2026-09-14-Agent数据桥架构.md](../2026-09-14-Agent数据桥架构.md) | 部分保留 | 数据桥恰是引擎更换时最需保留/改造的桥接层；已完成的芽迁移不白做 |
| [2026-09-14-写作三芽Agent链路与正文侧栏优化.md](../2026-09-14-写作三芽Agent链路与正文侧栏优化.md) | 部分保留 | 芽产品面，保留 |
| [2026-09-01-系统触达面补齐调研.md](../2026-09-01-系统触达面补齐调研.md) | 部分保留 | PTY/工作区为产品面保留；沙箱部分需对齐 |
| [2026-08-30-规则文件体系与MCP配置化设计.md](../2026-08-30-规则文件体系与MCP配置化设计.md) | 部分保留 | 八文件为产品面保留；MCP 配置格式需适配 |
| [2026-08-30-千万字级检索方案评定.md](../2026-08-30-千万字级检索方案评定.md) | 部分保留 | 领域/记忆侧索引底座保留；`workspace_search` 工具需在新工具面重新注册 |
| [2026-09-07-智能提示与语言服务立项.md](../2026-09-07-智能提示与语言服务立项.md) | 不受影响 | 编辑器内核，与 Agent 引擎正交 |
| [ROADMAP.md](../../ROADMAP.md) | 部分保留 | 任务 24/25/28（商城/记忆库）需重估；任务 29（工作区统一）属领域面保留 |
| [2026-08-30-R6动作段持久化计划.md](../2026-08-30-R6动作段持久化计划.md) | 部分保留 | 事件供给侧成果保留，下游归约器随事件协议调整 |

---

## 六、对两个方向的共同提示

无论最终选哪个方向，以下事实不会变化：

1. **领域桥接不可省略**——实体/芽/A2UI/规则/场景/记忆这套领域面必须由 WorldSea 自己保留并接线；任何"换引擎"方案的工作量大头在这里，而不是引擎本身。
2. **前端事件协议一定会动**——`turnModel.ts` 归约器与 8 类 ActionKind 绑定现行事件格式；引擎层任何变更都要在这里付出转换或重写的成本。
3. **双执行栈是必须解决的问题**——TS 200+ 工具仅 7 个桥接的现状，是"提取融合"与"以其为基"共同的动机：TS 侧工具要么被移植/重注册，要么被废弃。
4. **测试基线要重建**——现有 6.2 万行 Rust + 3 万行 TS 的测试覆盖是资产；引擎层重构会使其中相当部分失效，需在方案中明确保留/重建边界。
5. **"作废"不等于"白做"**——编排线的产品契约研究（可解释性三承诺）、记忆系统的领域结论（双层架构/治理/外置）、权限三档语义，都是与引擎无关的产品资产，应迁移而非丢弃。

---

## 附：取证索引（关键 file:line）

| 结论 | 取证 |
|---|---|
| 主链路入口 | `apps/tauri/src/agent/composables/useAgentRust.ts:2777`（send_message） |
| 命令注册规模 | `apps/tauri/src-tauri/src/lib.rs:105-320`（186 命令） |
| 服务装配 | `crates/agent-commands/src/lib.rs:1661-1885`（new_agent） |
| 内核循环 | `crates/agent-kernel/src/agent/mod.rs:596`（run）、`:1162`（run_react_loop） |
| Prompt 组装 | `crates/agent-kernel/src/agent/memory.rs:92`（build_prompt_options） |
| 工具桥（7 个） | `apps/tauri/src-tauri/src/frontend_tool_bridge.rs:227-331` |
| 事件枚举 | `crates/agent-kernel/src/event.rs:80`（OrchestratorEvent） |
| 前端归约 | `packages/shared-composables/src/agent/turnModel.ts:28-36`（ActionKind） |
| 会话存储 | `crates/agent-commands/src/session_store.rs:350-655`（表结构） |
| 场景装配 | `crates/agent-kernel/src/scenario.rs:156-186`（Scenario trait） |
| TS 残留活跃引用 | `apps/tauri/vite.config.ts:43`（`@agent/*` 别名） |
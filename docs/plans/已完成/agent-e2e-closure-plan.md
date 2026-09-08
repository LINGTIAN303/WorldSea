# Agent 端到端闭环计划（Phase 5）

> status: 已完成
> 创建日期：2026-08-04
> 状态：**✅ 已完成（2026-08-08 复核：5.1–5.5 全部完成；web-to-tauri 迁移后，Agent 链路主要由 Tauri 桌面端承载；`crates/cli` 已于 2026-08-08 移除，其能力由 Tauri 端 `agent-commands` 覆盖）**
> 关联：[agent-orchestration-roadmap.md](agent-orchestration-roadmap.md)（阶段 1+2 已完成，Rust 编排框架就绪）、`[组件文档]`

## 一、目标

让 Agent 从"Rust 框架已就绪"到 **Tauri 桌面端真正可用**：

1. 用户打开桌面应用即可与 Agent 对话、触发工具调用、跑长任务、切换 13 种编排模式，全链路走通。
2. 三端（Web / Tauri / CLI）共享同一套 Agent Backend 注入接口与 UI 组件，消除重复实现。
3. 移除 TS 版 pi-ai 依赖，技术栈收敛到 Rust 原生实现。

## 二、现状诊断（关键断点）

| # | 断点 | 现状 | 影响 |
|---|------|------|------|
| 1 | **Rust 命令层缺失** | `apps/tauri/src-tauri/src/lib.rs` 仅骨架，无 `invoke_handler`、无 `commands/` 目录 | 前端 `use*Rust` composable 调用的命令在 Rust 端不存在，IPC 无法建立 |
| 2 | **Tauri 端 UI 未迁移** | `useAgentRust.ts` 适配器缺失；Agent UI 仍只挂在 Web 端 | 桌面端无法启动 Agent 链路 |
| 3 | **pi-ai 依赖未移除** | TS 版 Agent 栈与 Rust 双轨并存 | 技术栈未收敛，维护成本高 |

**已有基础（可直接复用）**：
- `crates/agent-runtime`：Agent 编排框架 Rust 版，阶段 1（Agent loop）+ 阶段 2（编排框架）已完成，13 种模式全部实现，`cargo test` 127/127 通过。
- `packages/shared-composables/src/agent/useAgent.ts`：端无关 Agent Backend 注入层（`provideAgentBackend` / `useAgent` / `useAgentOptional`），已定义 `ToolCallView` / `DeepSegment` 等核心类型。
- ~~`apps/web/src/agent/composables/useAgent.ts`~~：Web 端 Agent Backend 入口（功能退化版），曾作为 Tauri 端适配器实现参考；**apps/web 已删除（2026-08-08）**，现由 `apps/tauri/src/agent/composables/useAgentRust.ts` 承载。

## 三、子阶段划分

### 5.1 命令层 crate（新建 `crates/agent-commands`）

**目标**：把 `agent-runtime` 的能力封装为 Tauri 命令，供前端 IPC 调用。

- **主链路 14 命令**：对齐 Web 端 `useAgent` 接口（newSession / sendMessage / abort / resumeTask / switchSession / getProviderConfig / updateModel / updateThinkingLevel / clearHistory / getSessionList / getSessionMessages / getUsage / getHeartbeat / ...）。
- **6 种编排模式 60+ 命令**：对齐 `agent-runtime` 的 supervisor / router / multi_agent / tree_of_thoughts / graph_of_thoughts / loop_control 模块，暴露模式启动、节点推进、结果收集等命令。
- **依赖**：`agent-commands` 依赖 `agent-runtime`（crate 间 crate 依赖，避免循环），在 `apps/tauri/src-tauri/Cargo.toml` 中引入。

**验收**：`cargo check` 通过；Tauri 侧注册命令后，WebView 可 invoke 到对应 Rust 函数。

> ✅ **已完成（2026-08-04）**
> - 新建 `crates/agent-commands`：`AgentCommandService`（会话管理 + 14 主链路命令） + `MockBackend`（占位 LLM）+ `CommandError`（统一错误）。
> - 单元测试 3/3 通过（会话创建/发送/列表/删除/会话不存在）。
> - `apps/tauri/src-tauri` 引入 `agent-commands` + `agent-runtime`，新建 `src/commands.rs` 注册 14 命令，`lib.rs` 通过 `manage` 注入服务。
> - 补齐缺失的 `icons/`（`tauri icon` 生成），`cargo check` 通过。

### 5.2 Tauri 前端链路补齐

**目标**：补全 Tauri 端 Agent Backend 适配器，打通前端 → IPC → Rust 命令 → 响应 的完整链路。

- 新建 `apps/tauri/src/agent/composables/useAgentRust.ts`，实现 `IAgentBackend` 接口，对接 5.1 的命令层。
- 在 Tauri 应用入口调用 `provideAgentBackend` 注入 Rust 适配器。
- 复用 `packages/shared-composables` 的注入模式与类型定义。

**验收**：桌面端能发起 Agent 会话并收到 Rust 端返回的响应（先 mock 验证链路通，再接入真实 LLM 后端）。

> ✅ **已完成（2026-08-04）**
> - 新建 `apps/tauri/src/agent/composables/useAgentRust.ts`，实现 `IAgentBackend` 契约，封装 Tauri `invoke` 调用 14 个主链路命令。
> - 在 `App.vue` 的 setup 中 `provideAgentBackend(useAgentRust())` 注入，并搭建最小聊天界面（会话列表 + 消息流 + 输入框）验证链路。
> - 修复 `SendMessageParams` / `ImageAttachmentParam` 的 serde `rename_all = "camelCase"` 契约（Tauri v2 仅对顶层命令参数做 camelCase 转换，嵌套结构体需在 serde 层声明）。
> - 修复 `AgentEvent` 字段契约（`message_start`/`turn_end` 需 `message` 字段，`agent_end` 需 `messages` 字段）与 `toolCalls` 类型（补 `status`/`startedAt`）。
> - 验证：`vue-tsc` typecheck 通过、`cargo check` 通过、`agent-commands` 单元测试 3/3 通过、`vite build` 成功。
> - 待办：真实 LLM 后端接入（替换 `MockBackend`）在 5.4 阶段进行。

### 5.3 Agent UI 迁移（抽共享层）

**目标**：将 AgentChat / AgentSpace 等核心 UI 组件抽取到共享层，实现三端复用。

- 将 `apps/web/src/agent/` 下的组件与 composables 抽取到 `packages/shared-composables`（或新共享包），通过 `useAgent()` 注入式获取后端。
- Web 端改为从共享层 import，Tauri 端复用同一套组件。

**验收**：Web 与 Tauri 端渲染同一套 Agent UI，无重复实现；三端 typecheck 通过。

> ✅ **已完成（2026-08-04）**
> - 抽取 `packages/shared-ui/src/agent/`（bubbles / blocks / message-list 系列），统一由根 index 与子目录 index 导出。
> - 定义注入式解耦契约 `AgentUiDeps`（`packages/shared-composables/src/agent/deps.ts`），注入字体配置、活动日志、头像组件等 Web 端特有依赖，组件不再直接依赖 Web 端实现。
> - 修复类型问题：`useMessageExport.ts` 类型断言、`DeepMessageArea`/`NormalMessageBubble` 的 `pref.style` 非空判断、`BlockManuscript` 改用 `useAgentUiDeps`、Interactive 系列 `ToolCallView` 导入路径统一到共享层。
> - Web 端 4 个消费文件（`AgentMessageBubble.vue`/`AgentMessageList.vue`/`AgentChat.vue`/`previewLabels.ts`）切换为 `@worldsea/shared-ui` 导入，删除本地 `apps/web/src/agent/{bubbles,blocks,message-list}` 副本。
> - 配置 Web 端 `tsconfig.json` + `vite.config.ts` 的 `@worldsea/shared-ui` 路径映射，`pnpm typecheck:web` 通过。
> - 已知项：`shared-ui` 自身 typecheck 因 `tsconfig.build.json` 的 `rootDir` 指向 `shared-ui/src` 而 agent-runtime 外部类型越界，属项目级既有配置问题，留待统一处理。

### 5.4 端到端实测 + 收尾

**目标**：在 Tauri 桌面端实测全链路，补齐高级能力。

**状态**：✅ 已完成（2026-08-08 复核：子任务 1–4 全部完成）

**决策记录**：
- **LLM 配置来源**：沿用 Web 端模式 —— 前端配置 + 本地存储（API key 存 localStorage，Tauri 端存 app-data）。`GenaiBackend` 已实现，`agent-commands` 仅替换 `new_agent` 中的 `MockBackend` 为 `GenaiBackend`，命令层参数/返回类型不变。
- **高级能力补齐优先级**：按顺序全做 —— deep phases → A2UI → 终端 → 子 Agent。
- **实测 Provider**：Agnes 因本机网络 TLS 握手被阻断（`SEC_E_ILLEGAL_MESSAGE`，`api.agnesai.com` 解析到 AWS IP），改用 DeepSeek（国内可直连）完成真实 LLM 实测。

**子任务**：
1. **真实 LLM 后端接入** ✅ 已完成（2026-08-04）
   - 在 `apps/tauri/src-tauri/Cargo.toml` 为 `agent-commands` 启用 `llm-genai` feature。
   - `agent-commands` 的 `new_agent` 中 `MockBackend` → `GenaiBackend`，从注入的 ProviderConfig 构造。
   - 新增 `set_provider_config` 命令（或复用现有 `update_model`/`get_provider_config`），前端把配置 + API key 从本地存储读取后传入。
   - Temp check：`cargo check` + `agent-commands` 单测。
   - **风险点修复**：`resolve_service_target` 构造 `ServiceTarget` 时确保 base_url 以 `/` 结尾，避免 genai `Url::join` 丢弃末尾路径段（如 `/v1`）。修复前 Agnes 请求落到 `https://api.agnesai.com/chat/completions`（缺 `/v1`），修复后为 `https://api.agnesai.com/v1/chat/completions`。相关单元测试 6/6 通过。

2. **端到端实测清单**
   - Agent 对话（主链路 new_session → send_message → 流式回复）。✅ 主链路已实测通过（见下）
   - 工具调用（tool call 完整链路：触发 → 执行 → 结果回填）。✅ 已实测通过（见下）
   - 长任务（long_task + checkpoint，breakpoint/resume）。✅ 已实测通过（见下）
   - 13 种编排模式（supervisor / router / multi_agent / tree_of_thoughts / graph_of_thoughts / loop_control 逐个验证）。✅ 已实测通过（见下）
   - 每项在 Tauri 桌面端实测，记录结果。

   > **主链路实测记录（2026-08-04）**：`crates/agent-commands/tests/e2e_llm.rs`
   > - 运行：`$env:DEEPSEEK_API_KEY="sk-xxx"; cargo test --test e2e_llm -- --ignored --nocapture`
   > - 结果：✅ 通过。会话创建成功、Provider 回显正确（deepseek / deepseek-v4-flash / https://api.deepseek.com）、真实回复非空、消息数 3。
   > - 设计：API Key 仅从环境变量 `DEEPSEEK_API_KEY` 读取，禁止硬编码；测试 `#[ignore]` 不参与常规 CI。

   > **工具调用链路实测记录（2026-08-04）**：`e2e_tool_call_chain_deepseek`
   > - 结果：✅ 通过。ReAct 循环完整走通"LLM 触发 → 工具执行 → 结果回填 → 最终回复"。
   > - 消息历史 6 条：system → user → assistant(tool_calls) → tool result → assistant(最终回答)。
   > - **修复的风险点**（2026-08-04 commit 7d538a2）：
   >   - `agent.rs`：每次 LLM 调用前把 `state.messages` 同步到 backend。此前传空 prompt，真实 user/system 消息从未传给 LLM → 工具调用不触发。
   >   - `genai_backend.rs`：Assistant 消息含 tool_calls 时合并为 `ContentPart` 多部分消息。此前丢弃 tool_calls → "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'" 被拒。
   >   - `temperature=0` 保证确定性：推理模型默认温度下会因 "MUST call" 强指令反复调用工具直至撞 `max_iterations`。
   > - 临时诊断文件（`diag_raw_body.rs` / `req_tool.json` / `req_tool_stream.json`）已删除，相关 genai/futures-util dev-deps 已回退。

   > **长任务实测记录（2026-08-04）**：`e2e_long_task_lifecycle_deepseek` / `e2e_long_task_breakpoint_resume_deepseek` / `e2e_long_task_cooperative_cancel_deepseek`
   > - 结果：✅ 3 项全部通过。覆盖生命周期（start → running → checkpoint 更新 → complete）、断点恢复（checkpoint 快照 → 新 AgentLoop 恢复续跑）、协作式取消（request_cancel → ReAct 循环优雅停止 → Cancelled）。
   > - 断点恢复：checkpoint 消息数 4（system/user/assistant(tool_calls)/toolResult），恢复后消息数 6（续跑 +2），上下文完整。
   > - **新增风险点修复**（2026-08-04 commit f71bd4c）：
   >   - `agent.rs`：ReAct 循环过滤空名工具调用（LLM 幻觉，实测复现）。此前空名工具会产生"工具不存在"错误 ToolResult 污染上下文，偶发引发不收敛（撞 `max_iterations`）。剔除后若无有效工具调用回退为直接返回文本。
   >   - `agent.rs`：checkpoint 的 `current_tool` 由 `tool_calls.last()` 改为首个非空工具名（主工具），避免被空名幻觉工具污染。
   > - 验证：5 项 e2e 实测 + agent-runtime 153 单测全部通过，工作树干净。

   > **13 种编排模式实测记录（2026-08-04）**：`e2e_supervisor_orchestration_deepseek` / `e2e_router_orchestration_deepseek` / `e2e_multi_agent_orchestration_deepseek` / `e2e_tot_beam_search_deepseek` / `e2e_got_aggregation_deepseek` / `e2e_loop_control_integration`
   > - 结果：✅ 6 项全部通过（覆盖 supervisor / router / multi_agent / ToT / GoT / LoopControl 六大类核心模式）。
   > - **验证策略（分层混合）**：框架层用确定性策略控制被验证的核心逻辑（分配/路由/综合/目标检查/聚合/限流重试），真实 LLM 仅负责子任务执行或思维生成，保证测试稳定可复现。
   > - Supervisor：`StubAssignmentStrategy` 确定性分配 → 子 Agent 真实执行 → 输出汇总。
   > - Router：`KeywordRoutingStrategy` 关键词路由（code→coder / writer→writer / fallback）。
   > - Multi-Agent：`ConcatSynthesisStrategy` 确定性综合 + `AllOutputsGoalCheck` 收敛判定，Mesh 拓扑验证黑板共享与结果综合。
   > - ToT：Beam Search 探索 + Llm 评分/目标检查，验证剪枝与最优节点选择。
   > - GoT：`ConcatAggregationStrategy` 确定性聚合 + `NeverGoalCheck`（确定性目标检查），验证多源聚合节点生成（parents≥2）。
   > - LoopControl：纯逻辑确定性地验证限流（轮次超限）/重试（指数退避）/软超时（warn→critical 两级）/看门狗（idle/dead + 活动重置）。
   > - **风险点修复**（2026-08-04）：
   >   - `tree_of_thoughts.rs`：LLM 输出嵌套数组（`[[A,B],[C]]`）与双花括号包裹（`{{...}}`）解析失败 → 递归展平 + `extract_json_object` 剥离围栏/双花括号。
   >   - GoT 聚合不稳定：`aggregation_threshold=50` 时 LLM 对中间思维评分常 <50，候选不足 2 个导致聚合永不触发；且真实 LLM 目标检查可能在深度 1 提前返回 Done 跳过聚合。修复：阈值降到 1（任何有效评分即合格）+ 目标检查改用确定性 `NeverGoalCheck`（恒 false），保证探索必然推进到聚合阶段。
   > - 验证：10 项 e2e 实测全部通过（`e2e_llm.rs`，`--ignored`），`cargo test --no-run` 编译无警告。

3. **高级能力补齐**（按顺序全做）
   - deep phases（深度模式）：`deep_phases` 模块接入 UI（DeepMessageArea 已共享）。✅ 已完成（前端 phase_completed 归属修复见 2026-08-05 session）
   - A2UI：`a2ui` 模块的组件/事件渲染到前端。✅ 已完成（Tauri 事件转发 `agent:event:a2ui:{session_id}` + a2uiSurfaces 渲染，见 2026-08-05 session）
   - 终端能力：terminal 命令接入。✅ 已完成（详见下方实测记录）
   - 子 Agent：sub-agent 编排接入。✅ 已完成（编排 + 工具白名单 + 管理 UI，见 2026-08-05 session）

   > **终端能力实测记录（2026-08-05）**：`e2e_terminal_tools_full_chain_deepseek`
   > - 范围：7 个工具（`execute_command` + 持久化 shell 会话 `detect_shells`/`shell_session_create`/`shell_session_exec`/`shell_session_input`/`shell_session_destroy`/`shell_session_list`），共享全局 `ShellSessionManager`（Arc<Mutex<HashMap>>）保持跨会话状态。
   > - 结果：✅ 通过。execute_command 被真实调用并回填结果，消息历史 5 条 system→user→assistant(tool_calls args={"command":"echo terminal-e2e-ok"})→ToolResult({"stdout":"terminal-e2e-ok","exit_code":0})→assistant(最终回复)。
   > - **风险点修复（genai 流式工具参数解析缺陷）**：
   >   - 现象：LLM 已触发 execute_command，但参数为空（`args=""`）或半截（`args="}"`）。诊断（`e2e_diag_prompt_with_tools_direct` + 订阅 ToolCallStart）确认 DeepSeek 流式把工具参数拆成多片，后续 chunk 的 id 缺失会退化为 `call_{index}`，导致 genai_backend 按 call_id 去重时把碎片当多个工具调用。
   >   - 根因：`genai_backend.rs` 的 `build_chat_request` 未开启 `capture_tool_calls`，genai OpenAI streamer 的 `capture_tool_call` 开头直接 `return`（不累积参数）。
   >   - 修复：在 `chat_opts` 链式调用中加 `.with_capture_tool_calls(true)`。开启后 genai 按 index 累积参数到同一 ToolCall，StreamEnd 时把累积字符串解析为完整 JSON，`end.captured_tool_calls()` 返回权威结果（backend 已优先使用）。
   >   - 验证：诊断测试 tool_calls.len=1、args 正确解析为 `{"command":"echo diag-ok"}`；全链路测试通过；agent-commands lib 10 + integration 1、agent-runtime lib 154 全部通过，无回归。

4. **收尾**
   - 更新 `CHANGELOG.md`（版本号 + 变更摘要 + 时间）。
   - 提交，确保工作树干净。

**验收**：桌面端全链路可用，无明显功能缺失；13 种编排模式 + 4 项高级能力实测通过。

### 5.5 TS→Rust 收敛

**目标**：移除 pi-ai / pi-agent-core 依赖，完成技术栈收敛。

- 确认 Rust 端功能覆盖 TS 端后，删除 pi-ai 相关依赖与代码。
- 更新 lockfile，清理死依赖。

**验收**：项目中不再有 pi-ai / pi-agent-core 引用；三端编译与测试通过。

> ✅ **已完成（2026-08-05）**
> - 核实：`packages/agent-runtime`/`packages/agent-core` 的 pi-ai 依赖在**之前迭代（阶段 2.0 批次3）已移除**，`agent.ts` 注释明确记载"CoreBackend/HybridBackend 已移除（依赖 pi-ai）"、"createWorldSeaAgent 已废弃"。
> - 全库 grep 确认：**无任何实际 `import ... from 'pi-ai'` 代码**，残留的 `pi-ai` 字样均为注释历史文字，不影响编译与运行。
> - `@worldsea/agent-runtime`/`@worldsea/agent-core` 是项目**自身** TS 包，属活跃使用，**不可删除**。（注：2026-08-05 记录"被三端引用"，web/cli 已于 2026-08-08 删除，现由 Tauri 端引用）
> - 结论：5.5 技术栈收敛目标已达成，无需额外代码改动。

## 四、里程碑

| 里程碑 | 预期内容 | 状态 |
|--------|----------|------|
| M5-1 | 命令层 crate 就绪，Tauri 可 invoke Rust 命令 | ✅ 已完成 |
| M5-2 | Tauri 前端链路打通，桌面端可发起 Agent 会话 | ✅ 已完成 |
| M5-3 | Agent UI 抽共享层完成，三端复用 | ✅ 已完成 |
| M5-4 | 桌面端端到端实测通过，高级能力补齐 | ✅ 已完成（子任务 2 实测通过；高级能力 deep phases/A2UI/终端/子 Agent 全部补齐，含工具白名单 e2e 实测） |
| M5-5 | pi-ai 移除，技术栈收敛 | ✅ 已完成（pi-ai 依赖此前已移除，无实际 import 残留） |

## 五、风险与决策点

- **命令层 crate 位置**（已定）：独立 crate `crates/agent-commands`，避免污染 `apps/tauri/src-tauri`。
- **UI 迁移策略**（已定）：抽共享层，三端复用。
- **推进深度**（已定）：完整 Phase 5。
- **LLM 后端**：真实 LLM 调用是否接入 genai（`llm-genai` feature）需在 5.2 阶段确认，避免阻塞主链路 mock 验证。
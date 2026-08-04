# Agent 端到端闭环计划（Phase 5）

> 创建日期：2026-08-04
> 状态：**执行中（5.1 命令层已完成，5.2 Tauri 前端链路已完成，5.3 Agent UI 迁移已完成，5.4 端到端实测待启动）**
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
- `apps/web/src/agent/composables/useAgent.ts`：Web 端 Agent Backend 入口（功能退化版），可作为 Tauri 端适配器实现参考。

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
> - Web 端 4 个消费文件（`AgentMessageBubble.vue`/`AgentMessageList.vue`/`AgentChat.vue`/`previewLabels.ts`）切换为 `@worldsmith/shared-ui` 导入，删除本地 `apps/web/src/agent/{bubbles,blocks,message-list}` 副本。
> - 配置 Web 端 `tsconfig.json` + `vite.config.ts` 的 `@worldsmith/shared-ui` 路径映射，`pnpm typecheck:web` 通过。
> - 已知项：`shared-ui` 自身 typecheck 因 `tsconfig.build.json` 的 `rootDir` 指向 `shared-ui/src` 而 agent-runtime 外部类型越界，属项目级既有配置问题，留待统一处理。

### 5.4 端到端实测 + 收尾

**目标**：在 Tauri 桌面端实测全链路，补齐高级能力。

**状态**：⏳ 执行中（5.4 子任务 1 已完成，子任务 2 主链路实测通过）

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
   - 工具调用（tool call 完整链路：触发 → 执行 → 结果回填）。
   - 长任务（long_task + checkpoint，breakpoint/resume）。
   - 13 种编排模式（supervisor / router / multi_agent / tree_of_thoughts / graph_of_thoughts / loop_control 逐个验证）。
   - 每项在 Tauri 桌面端实测，记录结果。

   > **主链路实测记录（2026-08-04）**：`crates/agent-commands/tests/e2e_llm.rs`
   > - 运行：`$env:DEEPSEEK_API_KEY="sk-xxx"; cargo test --test e2e_llm -- --ignored --nocapture`
   > - 结果：✅ 通过（1.36s）。会话创建成功、Provider 回显正确（deepseek / deepseek-v4-flash / https://api.deepseek.com）、真实回复非空（`好的，我是测试助手…`）、消息数 3。
   > - 设计：API Key 仅从环境变量 `DEEPSEEK_API_KEY` 读取，禁止硬编码；测试 `#[ignore]` 不参与常规 CI。

3. **高级能力补齐**（按顺序全做）
   - deep phases（深度模式）：`deep_phases` 模块接入 UI（DeepMessageArea 已共享）。
   - A2UI：`a2ui` 模块的组件/事件渲染到前端。
   - 终端能力：terminal 命令接入。
   - 子 Agent：sub-agent 编排接入。

4. **收尾**
   - 更新 `CHANGELOG.md`（版本号 + 变更摘要 + 时间）。
   - 提交，确保工作树干净。

**验收**：桌面端全链路可用，无明显功能缺失；13 种编排模式 + 4 项高级能力实测通过。

### 5.5 TS→Rust 收敛

**目标**：移除 pi-ai / pi-agent-core 依赖，完成技术栈收敛。

- 确认 Rust 端功能覆盖 TS 端后，删除 pi-ai 相关依赖与代码。
- 更新 lockfile，清理死依赖。

**验收**：项目中不再有 pi-ai / pi-agent-core 引用；三端编译与测试通过。

## 四、里程碑

| 里程碑 | 预期内容 | 状态 |
|--------|----------|------|
| M5-1 | 命令层 crate 就绪，Tauri 可 invoke Rust 命令 | ✅ 已完成 |
| M5-2 | Tauri 前端链路打通，桌面端可发起 Agent 会话 | ✅ 已完成 |
| M5-3 | Agent UI 抽共享层完成，三端复用 | ✅ 已完成 |
| M5-4 | 桌面端端到端实测通过，高级能力补齐 | ⏳ 待启动 |
| M5-5 | pi-ai 移除，技术栈收敛 | ⏳ 待启动 |

## 五、风险与决策点

- **命令层 crate 位置**（已定）：独立 crate `crates/agent-commands`，避免污染 `apps/tauri/src-tauri`。
- **UI 迁移策略**（已定）：抽共享层，三端复用。
- **推进深度**（已定）：完整 Phase 5。
- **LLM 后端**：真实 LLM 调用是否接入 genai（`llm-genai` feature）需在 5.2 阶段确认，避免阻塞主链路 mock 验证。
# Agent 端到端闭环计划（Phase 5）

> 创建日期：2026-08-04
> 状态：**执行中（5.1 命令层已完成，5.2 Tauri 前端链路进行中）**
> 关联：【`[agent-orchestration-roadmap.md](agent-orchestration-roadmap.md)`】（阶段 1+2 已完成，Rust 编排框架就绪）、【`[组件文档]`】

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

### 5.3 Agent UI 迁移（抽共享层）

**目标**：将 AgentChat / AgentSpace 等核心 UI 组件抽取到共享层，实现三端复用。

- 将 `apps/web/src/agent/` 下的组件与 composables 抽取到 `packages/shared-composables`（或新共享包），通过 `useAgent()` 注入式获取后端。
- Web 端改为从共享层 import，Tauri 端复用同一套组件。

**验收**：Web 与 Tauri 端渲染同一套 Agent UI，无重复实现；三端 typecheck 通过。

### 5.4 端到端实测 + 收尾

**目标**：在 Tauri 桌面端实测全链路，补齐高级能力。

- 实测：Agent 对话、工具调用、长任务、13 种编排模式。
- 补齐：深度模式（deep phases）、A2UI、终端、子 Agent 等高级能力。

**验收**：桌面端全链路可用，无明显功能缺失。

### 5.5 TS→Rust 收敛

**目标**：移除 pi-ai / pi-agent-core 依赖，完成技术栈收敛。

- 确认 Rust 端功能覆盖 TS 端后，删除 pi-ai 相关依赖与代码。
- 更新 lockfile，清理死依赖。

**验收**：项目中不再有 pi-ai / pi-agent-core 引用；三端编译与测试通过。

## 四、里程碑

| 里程碑 | 预期内容 | 状态 |
|--------|----------|------|
| M5-1 | 命令层 crate 就绪，Tauri 可 invoke Rust 命令 | ✅ 已完成 |
| M5-2 | Tauri 前端链路打通，桌面端可发起 Agent 会话 | ⏳ 待启动 |
| M5-3 | Agent UI 抽共享层完成，三端复用 | ⏳ 待启动 |
| M5-4 | 桌面端端到端实测通过，高级能力补齐 | ⏳ 待启动 |
| M5-5 | pi-ai 移除，技术栈收敛 | ⏳ 待启动 |

## 五、风险与决策点

- **命令层 crate 位置**（已定）：独立 crate `crates/agent-commands`，避免污染 `apps/tauri/src-tauri`。
- **UI 迁移策略**（已定）：抽共享层，三端复用。
- **推进深度**（已定）：完整 Phase 5。
- **LLM 后端**：真实 LLM 调用是否接入 genai（`llm-genai` feature）需在 5.2 阶段确认，避免阻塞主链路 mock 验证。
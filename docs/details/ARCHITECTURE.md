# WorldSea 架构总览

> 本文档描述**当前实际代码状态**（2026-09-08 复核：对齐 crates 分层 agent-kernel/agent-patterns 拆分与仓库改名 WorldSea，crate 分层详见 [orchestration-matrix.md](架构/orchestration-matrix.md)），供新接手者快速定位代码。
> 与 `docs/details/端分离/` 文档库区分：后者是端分离迁移的历史记录与目标架构设计。

## 1. 项目定位

WorldSea 是一个 Agent 驱动的世界构建（worldbuilding）平台，帮助用户构建丰富、互相关联的虚构世界。

- **唯一 GUI**：`apps/tauri`（Tauri 2 桌面应用，原 `apps/web` 已于 2026-08-08 迁移后删除）
- **CLI**：已移除（原 Rust binary `crates/cli` 已于 2026-08-08 删除，能力由 Tauri 端 `agent-commands` 覆盖）
- **技术栈**：Vue 3 + TypeScript + Vite + Pinia（前端）；Rust（WASM 核心 + Tauri 后端 + Agent 分层内核）

## 2. 顶层目录结构

```
WorldSea/
├── apps/                  # 应用入口
│   └── tauri/             # ★ 唯一 GUI（Tauri 2 桌面端：独立 src-tauri + Rust 命令层，端口 5175）
├── crates/                # Rust crates（Agent 分层 + 技能商店 + vendor）
│   ├── agent-kernel/      # Agent 执行内核（底座：执行契约/宿主引擎/最小闭环/资源服务/工程横切，可独立运行）
│   ├── agent-patterns/    # 编排扩展层：8 扩展模式 + orchestrator 统一骨架 + shared 共享类型
│   ├── agent-runtime/     # 聚合壳（转发 agent-kernel + agent-patterns，对外 agent_runtime::* 路径不变）
│   ├── agent-commands/    # 命令服务层（主链路 14 命令 + 编排模式命令；Tauri 绑定在 tauri app 端）
│   ├── agent-memory/      # MemoryAccessor 适配层（以 vendor memory-center-core 实现长期记忆）
│   ├── worldsea-skills-store/  # Skills Store 纯逻辑库（校验/解压/本地导入，无 Tauri 依赖，独立 cargo test）
│   └── vendor/            # 三方 vendor 代码（memory-center-core 等）
├── packages/              # 共享 monorepo 子包（15 个，见 §4）
├── worldsea-core/         # Rust WASM 核心（storage/validation/graph layout/sqlite）
├── tactical-engine/       # Rust WASM 战术引擎（pathfinding）
├── docs/                  # 文档（四类：index 索引 / plans 计划 / details 详情 / misc 其他）
└── scripts/               # 构建与工具脚本
```

## 3. 端职责

| 端 | 目录 | 职责 | 后端能力 |
|----|------|------|----------|
| **Tauri（唯一 GUI）** | `apps/tauri` | 桌面应用，前端 Vue（Agent 对话、27 官方插件、Space 面板、设置）+ 后端 Rust 命令 | Rust 命令（src-tauri）+ `crates/agent-*` Agent 分层编排 + WASM 算法/校验 |

**关键点**：web-to-tauri 迁移（2026-08-08）完成后，`apps/web`（原 Web 主应用）与 `apps/cli`（原 TS CLI）均已删除；随后 Rust CLI（`crates/cli`）亦于 2026-08-08 移除（其 chat / 文件读写 / 命令执行能力由 Tauri 端 `agent-commands` 工具集覆盖）。应用层收敛为 **Tauri 唯一 GUI + 共享 crates**；根级 `src/`、`src-tauri/`、`worldsea-server/`、`worldsea-agent/` 在更早的端分离中已迁移，根目录不存放应用源码。

## 4. 共享包（`packages/`）

| 包 | 职责 |
|----|------|
| `agent-core` | Agent 框架核心（声明式 ToolRegistry/SkillRegistry、bus、orchestrator、guard） |
| `agent-runtime` | 端无关共享层（ToolBus/工具/技能/会话/group-chat/MCP/KB/ExecutionAdapter；主循环已由 Rust 接管） |
| `canvas-engine` | 共享画布渲染引擎（graph / tree / geometry / algorithms） |
| `core-api-types` | 前端 API 契约类型唯一源（EntityTypeSchema 等权威定义） |
| `entity-core` | 实体 CRUD、关系、facets、traits、stores、composables |
| `font-kit` | 字体管理与渲染 |
| `governor-core` | 治理器核心（environment、registry） |
| `memory-archive` | 记忆归档系统（recall、scheduler、embedding、storage） |
| `motion-kit` | 动画与动效工具 |
| `perf-kit` | 性能工具（响应式、IO 批处理、渲染节流） |
| `plugin-sdk` | 插件开发 SDK |
| `shared-composables` | 三端共享 Vue composables |
| `shared-ui` | 三端共享 UI 子包（A2UI 组件等，避免根入口重复导出） |
| `theme-kit` | 主题 manifest 系统与纹理引擎 |
| `ui-kit` | 共享 UI 组件（Ws* 基础组件） |

## 5. Rust 侧（crates 分层）

| crate | 职责 |
|-------|------|
| `crates/agent-kernel` | ★ Agent 执行内核（底座）：执行契约（`OrchestratorNode`/`NodeContext`）、宿主引擎（`DefaultOrchestrator` 图执行器）、最小闭环（`AgentLoop`：prompt→思考→工具→结果）、资源服务（Backend/ToolBus/Memory/Confirmation/事件/LLM）、工程横切（LoopControl 重试限流 + LongTask 检查点心跳）。可独立运行，不依赖任何扩展模式 |
| `crates/agent-patterns` | 编排扩展层：8 扩展模式（Plan-and-Execute / Reflection / Self-Refine / ToT / GoT / Multi-Agent / Supervisor / Router，独立目录）+ orchestrator 统一骨架（OrchestratorNode 单一抽象 + DefaultOrchestrator 唯一执行器）+ shared 共享类型。只依赖底座契约，底座永不反向依赖本层 |
| `crates/agent-runtime` | 聚合壳：转发 agent-kernel + agent-patterns，保持对外 `agent_runtime::xxx` 路径兼容（crate 拆分零改动迁移） |
| `crates/agent-commands` | 命令服务层：主链路 14 命令 + 编排模式命令（run_tot/run_got/run_multi/run_supervisor/run_plan_execute/router_* 等）、session/long_task/subagent 存储、PTY/terminal 工具 |
| `crates/agent-memory` | MemoryAccessor 适配层（MemoryCenterAccessor，实现底座 MemoryAccessor trait） |
| `crates/worldsea-skills-store` | Skills Store 纯逻辑库（zip 解压、sha256 校验、本地导入；无 Tauri 依赖，可独立 cargo test） |
| `crates/vendor/memory-center-core` | 三方 vendor（MemoryCenter 核心，保持与上游一致） |
| `worldsea-core` | WASM 核心（serde、validation、migration、graph layout、sqlite） |
| `tactical-engine` | WASM 战术引擎（pathfinding） |

> 13 模式双轨口径：产品语义 13 种（对外/UI）= 底座能力 5（Single Agent / ReAct / Tool Use / Memory / Loop Engineering）+ 扩展模式 8。归属与代码落点见 [orchestration-matrix.md](架构/orchestration-matrix.md)。

## 6. 数据流

- **Tauri**：Vue UI → `Tauri invoke` → `apps/tauri/src-tauri` Rust 命令 → `agent-commands`（命令服务层）→ `agent-runtime`（聚合壳）→ `agent-kernel`（底座闭环）+ `agent-patterns`（扩展模式）。
- **TS 侧**：`packages/agent-runtime` 收敛为端无关共享层（工具/技能/会话/适配器），主循环已由 Rust 接管（pi-ai 已于 2026-08-08 移除）。
- **实体数据**：存储 → FileStorageBackend（Rust fs 命令）；算法/校验/图布局 → WASM（worldsea-core / tactical-engine）。优先 Tauri IPC + 事件桥（非轮询）。

## 7. 关键入口

- **Tauri 前端**：`apps/tauri/src/main.ts` → `apps/tauri/src/App.vue` → `apps/tauri/src/ui/layout/Shell.vue`
- **Agent 对话**：`apps/tauri/src/agent/AgentWorkspace.vue`（chat 视图 + 浮动面板）
- **Agent 空间**：`apps/tauri/src/space/`（AgentSpace.vue 壳 + 面板 + 快捷键 space 作用域）
- **插件系统**：`apps/tauri/src/plugins/PluginManager.ts`；官方插件 `apps/tauri/src/plugins/official/`
- **Tauri Rust 后端**：`apps/tauri/src-tauri/src/lib.rs`

## 8. 常用命令

```bash
pnpm dev                 # 启动 Tauri 桌面端（唯一 GUI）
pnpm typecheck:all       # Tauri 端类型检查
pnpm test:run            # 单元测试（共享包，vitest）
pnpm build:wasm-all      # 构建 WASM（worldsea-core + tactical-engine）
cargo test -p agent-kernel -p agent-patterns -p agent-commands   # Rust Agent 分层测试
```

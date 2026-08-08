# WorldSmith 架构总览

> 本文档描述**当前实际代码状态**（2026-08-08 复核，Phase G 迁移完成后），供新接手者快速定位代码。
> 与 `docs/details/端分离/` 文档库区分：后者是端分离迁移的历史记录与目标架构设计。

## 1. 项目定位

WorldSmith 是一个 AI 驱动的世界构建（worldbuilding）平台，帮助用户构建丰富、互相关联的虚构世界。

- **唯一 GUI**：`apps/tauri`（Tauri 2 桌面应用，原 `apps/web` 已于 2026-08-08 迁移后删除）
- **CLI**：`crates/cli`（Rust binary `worldsmith`，chat 交互对话，原 TS `apps/cli` 已删除）
- **技术栈**：Vue 3 + TypeScript + Vite + Pinia（前端）；Rust（WASM 核心 + Tauri 后端 + Agent 编排 + CLI）

## 2. 顶层目录结构

```
worldsmith/
├── apps/                  # 应用入口
│   └── tauri/             # ★ 唯一 GUI（Tauri 桌面端：独立 src-tauri + Rust 命令层）
├── packages/              # 共享 monorepo 子包（15 个，见 §4）
├── crates/                # Rust crates
│   ├── agent-runtime/     # Rust Agent 编排后端（genai LLM + tokio）
│   ├── agent-commands/    # 命令层（LoopControl/LongTask/SubAgent/Terminal 等）
│   ├── agent-memory/      # Agent 记忆后端（MemoryCenter 适配）
│   ├── cli/               # CLI（binary `worldsmith`：chat，复用 agent-runtime）
│   └── vendor/            # 三方 vendor 代码（memory-center-core）
├── worldsmith-core/       # Rust WASM 核心（storage/validation/graph layout）
├── tactical-engine/       # Rust WASM 战术引擎（pathfinding）
├── worldsmith-skills-store/ # Rust Skills Store 纯逻辑库（可独立 cargo test）
├── docs/                  # 文档（架构、路线图、按状态分类：已完成/执行中/未完成）
└── scripts/               # 构建与工具脚本
```

## 3. 双端职责

| 端 | 目录 | 职责 | 后端能力 |
|----|------|------|----------|
| **Tauri（唯一 GUI）** | `apps/tauri` | 桌面应用，前端 Vue（Agent 对话、27 插件、Space 面板、设置）+ 后端 Rust 命令 | Rust 命令（src-tauri）+ `crates/agent-runtime` Agent 编排 + WASM 算法/校验 |
| **CLI** | `crates/cli` | 命令行应用，`chat` 交互式对话（本地自动化：读/写文件、执行命令） | `crates/agent-runtime` AgentLoop + GenaiBackend |

**关键点**：web-to-tauri 迁移（2026-08-08）完成后，`apps/web`（原 Web 主应用）与 `apps/cli`（原 TS CLI）均已删除，应用层收敛为 Tauri GUI + Rust CLI 双端；根级 `src/`、`src-tauri/`、`worldsmith-server/`、`worldsmith-agent/` 在更早的端分离中已迁移，根目录不存放应用源码。

## 4. 共享包（`packages/`）

| 包 | 职责 |
|----|------|
| `agent-core` | Agent 框架核心（声明式 ToolRegistry/SkillRegistry、bus、orchestrator、guard） |
| `agent-runtime` | ★ Agent 核心运行时（端无关：Agent 主循环、工具、技能、会话、toolbus、providers、group-chat、mcp、embedding、kb） |
| `canvas-engine` | 共享画布渲染引擎（graph / tree / geometry / algorithms） |
| `core-api-types` | 前端 API 契约类型唯一源（coreBackend 双端收敛后共享） |
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

## 5. Rust 侧

| crate | 职责 |
|-------|------|
| `crates/agent-runtime` | Agent 编排后端（ToT / GoT / Multi-Agent / Supervisor / Router / Loop Engineering） |
| `crates/agent-commands` | Tauri 命令层薄封装（Agent 主链路 / LoopControl / LongTask / SubAgent / Terminal） |
| `crates/agent-memory` | Agent 记忆后端（MemoryCenterAccessor，实现 MemoryAccessor trait） |
| `crates/vendor/memory-center-core` | 三方 vendor（MemoryCenter 核心，保持与上游一致） |
| `worldsmith-core` | WASM 核心（serde、validation、migration、graph layout、sqlite） |
| `tactical-engine` | WASM 战术引擎（pathfinding） |
| `worldsmith-skills-store` | Skills Store 纯逻辑库（zip 解压、sha256 校验、本地导入） |

## 6. 数据流

- **Tauri**：Vue UI → `Tauri invoke` → `apps/tauri/src-tauri` Rust 命令 → `crates/agent-runtime`。
- **Agent**：`packages/agent-runtime`（TS）是端无关核心；Rust 侧 `crates/agent-runtime` 为 Agent 循环主体，Tauri 用 invoke、CLI（crates/cli）直接复用 AgentLoop。

## 7. 关键入口

- **Tauri 前端**：`apps/tauri/src/main.ts` → `apps/tauri/src/App.vue` → `apps/tauri/src/ui/layout/Shell.vue`
- **Agent 对话**：`apps/tauri/src/agent/AgentWorkspace.vue`（chat 视图 + 浮动面板）
- **插件系统**：`apps/tauri/src/plugins/PluginManager.ts`
- **Tauri Rust 后端**：`apps/tauri/src-tauri/src/lib.rs`
- **CLI chat**：`crates/cli/src/main.rs`（AgentLoop + GenaiBackend）

## 8. 常用命令

```bash
pnpm dev                 # 启动 Tauri 桌面端（唯一 GUI）
pnpm chat                # CLI 交互对话（crates/cli）
pnpm typecheck:all       # Tauri 端类型检查
pnpm test:run            # 单元测试（共享包）
pnpm build:wasm-all      # 构建 WASM（worldsmith-core + tactical-engine）
cargo check -p agent-runtime  # 检查 Rust Agent 后端
cargo check --manifest-path crates/cli/Cargo.toml  # 检查 CLI
```
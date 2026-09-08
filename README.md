# WorldSea

Agent-powered worldbuilding platform — build rich, interconnected fictional worlds with intelligent assistance.

> **定位（第一要素）**：WorldSea 不止是世界观构建的 Agent 产品与 Harness 工程，更兼顾通用 Agent 的性质——**以通用 Agent 为基础、以通用 Harness 工程支撑的世界观构建产品**。

Built with **Tauri 2** + **Vue 3** + **TypeScript** + **Rust (WASM)**.

## Highlights

- **Rust 分层 Agent 内核**：底座能力 5 + 扩展模式 8 = 13 种编排模式（产品语义与架构归属双轨），多模型 provider，50+ 内置技能
- **创作功能全覆盖**：官方插件注册实体类型（schema 化）+ 图谱/时间线/战术板等可视化工具 + TipTap 手稿编辑器
- **27 个官方模块化插件**：实体与工具按插件组织，schema 驱动 UI，Module Builder 支持自定义实体类型
- **本地优先**：Tauri 2 桌面单二进制，数据落本地（IndexedDB / SQLite / 文件系统绑定），离线可用

## Features

### Creative Suite（创作域）

#### Worldbuilding Entities
- **Characters** — profiles, family trees, experience nodes, relation graphs
- **Regions** — hierarchical geography with tree navigation
- **Buildings** — section views with canvas rendering
- **Items & Weapons** — weapon lineage trees, item encyclopedia
- **Apparel & Combat Stats** — gear/equipment entities with combat attributes
- **Species & Plants** — evolution trees, recipe/alchemy trees
- **Languages** — language family trees with visual layout
- **Magic Systems** — skill trees with interactive canvas
- **Organizations** — org tree hierarchies
- **Concepts & Conflicts** — lore concepts, conflict tracking
- **Culture** — festival calendars, customs

> 以上为官方插件注册的实体类型（schema 化，见 `apps/tauri/src/plugins/official`）；可用 Module Builder 自定义新类型。

#### Visual Tools
- **Mindmap** — canvas-based mind mapping with AI suggestions, Rust-powered layout & graph analysis
- **Graph** — global entity relationship graph (Sigma.js) with clustering, path search, timeline slider
- **Timeline** — swimlane timeline with causal graphs, conflict detection, drag-and-drop
- **Tactical Board** — hex-grid tactical map with AI-controlled units, battle log, awareness system
- **Drawing** — free-form drawing with layers and persistence
- **Inspiration** — moodboard canvas with color extraction

#### Writing & Knowledge
- **Manuscript** — chapter-based editor (TipTap) with AI sidebar, slash commands, phone preview, export (DOCX)
- **Notebook** — note cards with backlinks, code sandbox, folder tree, graph view
- **Outline** — drag-and-drop story outline with entity links and storyline tracking

### AI Agent System（Agent 域）

- Multi-provider support (OpenAI, Anthropic, Google, DeepSeek, local models via Ollama/OpenAI-compatible)
- Coding agent with shell session and file operations（CodeMirror 编辑器 + LSP 提示）
- Deep thinking mode with phased output
- Group chat with multiple AI personas
- Smart fill — context-aware field completion
- **Rust agent stack（分层）**：`crates/agent-kernel`（执行内核底座：执行契约/宿主引擎/最小闭环/资源服务/工程横切）→ `crates/agent-patterns`（扩展模式目录 + shared 共享类型）→ `crates/agent-runtime`（聚合壳，对外 `agent_runtime::*` 路径不变）；命令经 `agent-commands` + Tauri 命令层暴露；TS 端 `packages/agent-runtime` 收敛为端无关共享层（主循环已 Rust 化，pi-ai 已于 2026-08 移除）
- **Orchestration（13 模式双轨口径）**：产品语义 13 种 = **底座能力 5**（Single Agent / ReAct / Tool Use / Memory / Loop Engineering）+ **扩展模式 8**（Plan-and-Execute / Reflection / Self-Refine / ToT / GoT / Multi-Agent / Supervisor / Router），Rust 双层实现，均带 Tauri 命令 + 前端 composable/面板
- **Long-running tasks**：Rust 工程设施（LoopControl 重试/限流 + LongTask 心跳/checkpoint/断点恢复/协作式取消）+ TS composable 绑定
- **Skills**：50+ 内置技能（世界构建 + 工程/研究），技能源仓库 manifest 规范、安装/更新/卸载；Skills Store 多平台互通（Claude Code / Cursor / WorldSea）

### Platform（平台工程）

#### Workflow Engine
- Visual pipeline builder with step cards
- Built-in templates (character network, magic system, medieval kingdom)
- Agent task, batch create, consistency check, transform steps

#### Module Builder
- Schema-driven UI generation
- 27 component renderers (tables, kanban, charts, forms, etc.)
- Custom entity types with slot-based layout

#### Project System
- Per-project isolated databases (IndexedDB / SQLite via Tauri)
- File system binding — sync project data to local directory
- File watcher for external changes
- Project switcher with directory binding UI

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9 (or npm >= 10, see install fallback below)
- [Rust](https://www.rust-lang.org/tools/install) (for WASM & Tauri)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Install

```bash
# Clone the repository
git clone https://github.com/LINGTIAN303/WorldSea.git
cd WorldSea

# Install dependencies (recommended)
pnpm install

# Build WASM modules
pnpm build:wasm-all
```

> **Windows / Sandbox note**: If `pnpm install` fails with `ERR_SQLITE_ERROR`,
> see the [`.npmrc`](.npmrc) rationale (TRAE Sandbox 阻止 .pnpm-store 的 SQLite
> shm/wal 访问)。历史 EPERM 问题已通过 `file:` → `link:` 协议根治
> （WASM 产物包在 node_modules 中 Junction 直连源目录，不再物理复制）。
>
> ```bash
> npm run install:fallback
> # 等价于 npm install --no-package-lock --legacy-peer-deps --no-audit --no-fund
> ```

### Development

```bash
# Desktop mode (Tauri，唯一 GUI)
pnpm dev
# 或 pnpm tauri:dev
```

### Build

```bash
# Desktop build (produces installer)
pnpm tauri:build
```

### Test

```bash
pnpm test
pnpm test:coverage
```

## Architecture & Tech Stack

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, TypeScript 6, Vite 8, Pinia |
| Desktop | Tauri 2 (Rust backend) |
| WASM Core | Rust (worldsea-core, tactical-engine) |
| Agent (Rust) | `crates/agent-kernel` + `agent-patterns` + `agent-runtime`（执行内核 / 扩展模式 / 聚合壳；genai LLM + tokio，Tauri 命令桥接） |
| Orchestration | 13 种模式 = 底座能力 5 + 扩展模式 8（Rust 分层实现，双轨口径，详见 [orchestration-matrix](docs/details/架构/orchestration-matrix.md)） |
| Charts | ECharts, Sigma.js, D3 |
| Editor | TipTap |
| Graph | Graphology |
| Database | IndexedDB (Dexie), SQLite (Tauri) |
| Terminal | xterm.js |

### Repository Layout

> 完整架构说明见 [docs/details/ARCHITECTURE.md](docs/details/ARCHITECTURE.md)。

```
WorldSea/
  apps/
    tauri/                  — 唯一 GUI（Tauri 2 桌面端，端口 5175，独立 src-tauri + Rust 命令层；apps/web 已于迁移后删除）
  crates/
    agent-kernel/           — Agent 执行内核（底座：执行契约/宿主引擎/最小闭环/资源服务/工程横切，可独立运行）
    agent-patterns/         — 编排扩展层：8 模式（ToT/GoT/Multi-Agent/Supervisor/Router/Plan-Execute/Reflection/Self-Refine）+ orchestrator 统一骨架 + shared 共享类型
    agent-runtime/          — 聚合壳（转发 agent-kernel + agent-patterns，保持对外路径兼容）
    agent-commands/         — 命令服务层（主链路 14 命令 + 编排模式命令；Tauri 绑定在 tauri app 端）
    agent-memory/           — MemoryAccessor 适配层（以 vendor memory-center-core 实现长期记忆）
    worldsea-skills-store/  — Skills Store 纯逻辑库（校验/解压/本地导入，无 Tauri 依赖，独立 cargo test）
    vendor/                 — 三方 vendor 代码（memory-center-core 等）
  packages/                 — 共享 monorepo 子包（15 个，见下）
  worldsea-core/            — Rust WASM core (storage, validation, graph layout)
  tactical-engine/          — Rust WASM tactical engine (pathfinding)
  docs/                     — 四类文档（index 索引 / plans 计划 / details 详情 / misc 其他）
  scripts/                  — Build & utility scripts
```

**关键数据流**：Vue UI → `Tauri invoke` → `apps/tauri/src-tauri` Rust 命令 → `agent-commands` → `agent-runtime`（kernel + patterns）；实体存储/算法/校验 → WASM（worldsea-core / tactical-engine）。

### Monorepo Packages

```
packages/
  agent-core/       — Agent framework core (registry, bus, execution, guard)
  agent-runtime/    — 端无关共享层（ToolBus/工具/技能/会话/group-chat/MCP/KB/ExecutionAdapter；主循环已由 Rust 接管）
  canvas-engine/    — Shared canvas rendering engine (graph, tree, geometry)
  core-api-types/   — 跨端 API 类型契约（EntityTypeSchema 等权威定义）
  entity-core/      — Entity CRUD, relations, facets, traits
  font-kit/         — Font management & rendering
  governor-core/    — Governor core (environment, registry)
  memory-archive/   — Memory archive system (recall, scheduler, embedding)
  motion-kit/       — Animation & motion utilities
  perf-kit/         — Performance utilities (reactive, IO batching, render throttle)
  plugin-sdk/       — Plugin development SDK (components, composables)
  shared-composables — 三端共享 Vue composables（agent/companion/entity/ui）
  shared-ui/        — 共享 UI 组件（A2UI 等）
  theme-kit/        — Theme manifest system & texture engine
  ui-kit/           — Shared UI components
```

## Documentation

- [架构总览](docs/details/ARCHITECTURE.md) — 项目结构与关键入口（描述实际代码状态）
- [文档索引](docs/index/README.md) — docs 四类文档总索引
- [路线图](docs/plans/ROADMAP.md) — 任务方向与状态
- [编排模式矩阵](docs/details/架构/orchestration-matrix.md) — 13 模式分层归属与代码落点

## License

[MIT](LICENSE)

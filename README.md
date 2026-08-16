# WorldSmith

AI-powered worldbuilding platform — build rich, interconnected fictional worlds with intelligent assistance.

Built with **Tauri 2** + **Vue 3** + **TypeScript** + **Rust (WASM)**.

## Features

### Worldbuilding Entities
- **Characters** — profiles, family trees, experience nodes, relation graphs
- **Regions** — hierarchical geography with tree navigation
- **Buildings** — section views with canvas rendering
- **Items & Weapons** — weapon lineage trees, item encyclopedia
- **Species & Plants** — evolution trees, recipe/alchemy trees
- **Languages** — language family trees with visual layout
- **Magic Systems** — skill trees with interactive canvas
- **Organizations** — org tree hierarchies
- **Concepts & Conflicts** — lore concepts, conflict tracking
- **Culture** — festival calendars, customs

### Visual Tools
- **Mindmap** — canvas-based mind mapping with AI suggestions, Rust-powered layout & graph analysis
- **Graph** — global entity relationship graph (Sigma.js) with clustering, path search, timeline slider
- **Timeline** — swimlane timeline with causal graphs, conflict detection, drag-and-drop
- **Tactical Board** — hex-grid tactical map with AI-controlled units, battle log, awareness system
- **Drawing** — free-form drawing with layers and persistence
- **Inspiration** — moodboard canvas with color extraction

### Writing & Knowledge
- **Manuscript** — chapter-based editor (TipTap) with AI sidebar, slash commands, phone preview, export (DOCX)
- **Notebook** — note cards with backlinks, code sandbox, folder tree, graph view
- **Outline** — drag-and-drop story outline with entity links and storyline tracking

### AI Agent System
- Multi-provider support (OpenAI, Anthropic, Google, DeepSeek, local models via Ollama/OpenAI-compatible)
- 20+ specialized worldbuilding skills (geography, character, combat, magic, language, etc.)
- Coding agent with shell session and file operations
- Deep thinking mode with phased output
- Group chat with multiple AI personas
- Smart fill — context-aware field completion
- **Agent runtime**: Rust agent-runtime（genai + tokio），Tauri 命令桥接；TS 版 pi-ai 已于 2026-08-08 移除
- **Orchestration patterns** (Rust): Tree of Thoughts、Graph of Thoughts、Multi-Agent、Supervisor、Router、Loop Engineering，均带 Tauri 命令 + 前端 composable
- **Long-running tasks**: 心跳/checkpoint/断点恢复/协作式取消（TS + Rust 双实现）
- **Skills Store**: 技能源仓库 manifest 规范、安装/更新/卸载、多平台互通（Claude Code / Cursor / WorldSmith）

### Workflow Engine
- Visual pipeline builder with step cards
- Built-in templates (character network, magic system, medieval kingdom)
- Agent task, batch create, consistency check, transform steps

### Module Builder
- Schema-driven UI generation
- 25+ component renderers (tables, kanban, charts, forms, etc.)
- Custom entity types with slot-based layout

### Project System
- Per-project isolated databases (IndexedDB / SQLite via Tauri)
- File system binding — sync project data to local directory
- File watcher for external changes
- Project switcher with directory binding UI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, TypeScript 6, Vite 8, Pinia |
| Desktop | Tauri 2 (Rust backend) |
| WASM Core | Rust (worldsmith-core, tactical-engine) |
| Agent | `crates/agent-runtime`（genai LLM 层 + tokio 编排，Tauri 命令桥接，主应用唯一后端；TS pi-ai 已于 2026-08-08 移除） |
| Orchestration | ToT / GoT / Multi-Agent / Supervisor / Router / Loop Engineering（Rust 编排节点） |
| Charts | ECharts, Sigma.js, D3 |
| Editor | TipTap |
| Graph | Graphology |
| Database | IndexedDB (Dexie), SQLite (Tauri) |
| Terminal | xterm.js |

### Monorepo Packages

```
packages/
  agent-core/       — Agent framework core (registry, bus, execution, guard)
  agent-runtime/    — 端无关 Agent 运行时（Agent 核心、工具、技能、会话、ExecutionAdapter）
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
git clone https://github.com/LINGTIAN303/WorldSmith.git
cd WorldSmith

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

## Project Structure

> 完整架构说明见 [docs/details/ARCHITECTURE.md](docs/details/ARCHITECTURE.md)（描述当前实际代码状态）。

```
WorldSmith/
  apps/
    tauri/                — 唯一 GUI（Tauri 桌面端，端口 5175，独立 src-tauri + Rust 命令层；apps/web 已于迁移后删除）
  crates/
    agent-runtime/        — Rust Agent 后端（genai LLM + tokio 编排：ToT/GoT/Multi-Agent/Supervisor/Router/Loop）
    agent-commands/       — Rust 命令层（LoopControl/LongTask/SubAgent/Terminal 等）
  packages/               — 共享 monorepo 子包（15 个，见上）
  worldsmith-core/        — Rust WASM core (storage, validation, graph layout)
  worldsmith-skills-store — Rust Skills Store crate（独立 cargo test，无 Tauri 依赖）
  tactical-engine/        — Rust WASM tactical engine (pathfinding)
  docs/                   — Roadmap, design specs, plans（含 端分离/ 历史文档库）
  scripts/                — Build & utility scripts
```

## License

[MIT](LICENSE)

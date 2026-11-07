# WorldSea

Agent-powered worldbuilding platform — build rich, interconnected fictional worlds with intelligent assistance.

> **定位（第一要素）**：WorldSea 不止是世界观构建的 Agent 产品与 Harness 工程，更兼顾通用 Agent 的性质——**以通用 Agent 为基础、以通用 Harness 工程支撑的世界观构建产品**。

Built with **Tauri 2** + **Vue 3** + **TypeScript** + **Rust (WASM)**.

## Highlights

- **创作功能全覆盖**：26 个官方模块化插件（schema 驱动 UI）—— 人物/地理/物品/魔法等实体类型 + 图谱/时间线/战术板等可视化工具 + 手稿/笔记/大纲写作套件
- **本地优先**：Tauri 2 桌面应用，数据落本地（IndexedDB / SQLite / 文件系统绑定），离线可用
- **Rust 引擎**：`worldsea-core`（实体存储 / 校验 / 迁移）+ `tactical-engine`（战术演算），以 WASM 供给前端
- **Agent 基座**：Agent 运行时基于 [dsh](https://github.com/deepseek-ai/dsh)（DeepSeek 开源 agent harness，MIT）构建——桌面壳经协议桥（relay / proxy）对接（集成进行中）

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

> 以上为官方插件注册的实体类型（schema 化），见 `apps/tauri/src/world/plugins`。

#### Visual Tools

- **Mindmap** — canvas-based mind mapping with AI suggestions, Rust-powered layout & graph analysis
- **Graph** — global entity relationship graph (Sigma.js) with clustering, path search, timeline slider
- **Timeline** — swimlane timeline with causal graphs, conflict detection, drag-and-drop
- **Tactical Board** — hex-grid tactical map with battle log, awareness system
- **Drawing** — free-form drawing with layers and persistence
- **Inspiration** — moodboard canvas with color extraction

#### Writing & Knowledge

- **Manuscript** — chapter-based editor (TipTap) with sidebar, slash commands, phone preview, DOCX export
- **Notebook** — note cards with backlinks, code sandbox, folder tree
- **Outline** — drag-and-drop story outline with entity links and storyline tracking

### AI Agent Layer（Agent 域）

- Agent 运行时基于 **dsh**（[deepseek-ai/dsh](https://github.com/deepseek-ai/dsh)，DeepSeek 开源 agent harness，MIT 许可）：桌面壳通过协议层（`dsh_relay` / `dsh_proxy`）与 dsh 运行时通信——**集成进行中**
- 产品侧能力（随集成推进）：多模型 provider、工具执行、会话管理、多角色群聊、Smart Fill

### Platform（平台工程）

- **Workflow Engine** — visual pipeline builder with step cards and built-in templates
- **Project System** — per-project isolated data (IndexedDB / SQLite via Tauri), file system binding, file watcher for external changes

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20.19（推荐 22 LTS）
- [pnpm](https://pnpm.io/) >= 10
- [Rust](https://www.rust-lang.org/tools/install)（WASM 与 Tauri 构建）
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install

```bash
# Clone the repository
git clone https://github.com/LINGTIAN303/WorldSea.git
cd WorldSea

# Install dependencies
pnpm install

# Build WASM engines（worldsea-core / tactical-engine）
pnpm build:wasm-all
```

> **Windows note**: If `pnpm install` fails, try the npm fallback:
> `npm run install:fallback`（等价于 `npm install --no-package-lock --legacy-peer-deps`）。

### Development

```bash
# Desktop mode (Tauri，唯一 GUI)
pnpm dev
```

### Build

```bash
# Desktop build (produces installer)
pnpm tauri:build

# Single-file installer chain (main app + installer packaging)
scripts/build-installer.ps1
```

### Test

```bash
pnpm test
```

## Architecture & Tech Stack

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, TypeScript, Vite, Pinia |
| Desktop | Tauri 2 (Rust backend) |
| WASM Core | Rust (worldsea-core, tactical-engine) |
| Agent | dsh integration via relay / proxy protocol layer |
| Charts | ECharts, Sigma.js, D3 |
| Editor | TipTap |
| Graph | Graphology |
| Database | IndexedDB (Dexie), SQLite (Tauri) |
| Terminal | xterm.js |

### Repository Layout

```
WorldSea/
  apps/
    tauri/            — 唯一 GUI（Tauri 2 桌面端：Vue 3 前端 + Rust 壳 src-tauri/）
    installer/        — 单文件安装/卸载向导（Tauri 小壳）
  packages/           — 共享 monorepo 子包（11 个，见下）
  worldsea-core/      — Rust WASM core（schema / storage / validation / migration）
  tactical-engine/    — Rust WASM tactical engine（战术演算 / 寻路等）
  scripts/            — 构建与维护脚本（安装器构建链 / 清理工具）
  benchmarks/         — 会话上下文基准
  public/             — 静态资源
```

### Monorepo Packages

- `canvas-engine` — shared canvas rendering engine (graph, tree, geometry)
- `core-api-types` — 跨端 API 类型契约（EntityTypeSchema 等权威定义）
- `entity-core` — entity CRUD, relations, facets, traits
- `font-kit` — font management & rendering
- `motion-kit` — animation & motion utilities
- `perf-kit` — performance utilities (reactive, IO batching, render throttle)
- `plugin-sdk` — plugin development SDK (components, composables)
- `shared-composables` — 共享 Vue composables（agent / companion / entity / ui）
- `shared-ui` — 共享 UI 组件（A2UI 等）
- `theme-kit` — theme manifest system & texture engine
- `ui-kit` — shared UI components

## License

[MIT](LICENSE)

本软件包含第三方开源组件，其许可声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)；
第三方组件的版权归各自作者所有，并依其自身许可条款分发。

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
| Agent | [pi-ai](https://github.com/earendil-works/pi-ai) framework + custom tool bus |
| Charts | ECharts, Sigma.js, D3 |
| Editor | TipTap |
| Graph | Graphology |
| Database | IndexedDB (Dexie), SQLite (Tauri) |
| Terminal | xterm.js |

### Monorepo Packages

```
packages/
  agent-core/       — Agent framework core (registry, bus, execution, guard)
  canvas-engine/    — Shared canvas rendering engine (graph, tree, geometry)
  entity-core/      — Entity CRUD, relations, facets, traits
  font-kit/         — Font management & rendering
  governor-core/    — Governor core (environment, registry)
  memory-archive/   — Memory archive system (recall, scheduler, embedding)
  motion-kit/       — Animation & motion utilities
  perf-kit/         — Performance utilities (IO batching, reactive, render)
  plugin-sdk/       — Plugin development SDK (components, composables)
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

> **Windows / Sandbox note**: If `pnpm install` fails with `ERR_SQLITE_ERROR`
> or `EPERM` on `importPackage`, use the npm fallback:
>
> ```bash
> npm run install:fallback
> # 等价于 npm install --no-package-lock --legacy-peer-deps --no-audit --no-fund
> ```
>
> See [`.npmrc`](.npmrc) for the full rationale (TRAE Sandbox 阻止 .pnpm-store
> 的 SQLite shm/wal 访问；Windows hoisted 模式仍可能 EPERM)。

### Development

```bash
# Web mode (browser)
pnpm dev

# Desktop mode (Tauri)
pnpm tauri:dev
```

### Build

```bash
# Web build
pnpm build:web

# Desktop build (produces installer)
pnpm tauri:build
```

### Test

```bash
pnpm test
pnpm test:coverage
```

## Project Structure

```
WorldSmith/
  src/                    — Vue 3 frontend
    agent/                — AI agent UI (chat, deep mode, persona)
    composables/          — Vue composables
    core/                 — Core backend (storage, modules, migration)
    plugins/official/     — Built-in worldbuilding plugins
    space/                — Agent space (chat, panels, group chat)
    ui/                   — Shared UI components (layout, editor, entity, etc.)
  src-tauri/              — Tauri 2 Rust backend
  worldsmith-agent/       — Agent engine (skills, tools, providers, embedding)
  worldsmith-core/        — Rust WASM core (storage, validation, graph layout)
  worldsmith-server/      — Node.js server (crawl, convert, vector search)
  tactical-engine/        — Rust WASM tactical engine (pathfinding)
  packages/               — Shared monorepo packages (11 sub-packages, see above)
  docs/                   — Roadmap, design specs, plans
  scripts/                — Build & utility scripts
```

## License

[MIT](LICENSE)

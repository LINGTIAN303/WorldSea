# WorldSmith 架构总览

> 本文档描述**当前实际代码状态**（2026-08-06 复核），供新接手者快速定位代码。
> 与 `docs/details/端分离/` 文档库区分：后者是端分离迁移的历史记录与目标架构设计。

## 1. 项目定位

WorldSmith 是一个 AI 驱动的世界构建（worldbuilding）平台，帮助用户构建丰富、互相关联的虚构世界。

- **主应用**：`apps/web`（Web 端，浏览器应用）
- **桌面端**：`apps/tauri`（Tauri 2 桌面应用）
- **CLI/服务端**：`apps/cli`（命令行 + HTTP/WS 服务）
- **技术栈**：Vue 3 + TypeScript + Vite + Pinia + Naive UI（前端）；Rust（WASM 核心 + Tauri 后端 + Agent 编排）

## 2. 顶层目录结构

```
worldsmith/
├── apps/                  # 三端应用入口
│   ├── web/               # ★ 主应用（完整前端：Agent、插件、Space、UI、core）
│   ├── cli/               # CLI 端（commander：chat / serve，HTTP+WS 服务）
│   └── tauri/             # Tauri 桌面端（独立 src-tauri + Rust 命令层）
├── packages/              # 共享 monorepo 子包（15 个，见 §4）
├── crates/                # Rust crates
│   ├── agent-runtime/     # Rust Agent 编排后端（genai LLM + tokio）
│   ├── agent-commands/    # 命令层（LoopControl/LongTask/SubAgent/Terminal 等）
│   ├── agent-memory/      # Agent 记忆后端（MemoryCenter 适配）
│   └── vendor/            # 三方 vendor 代码（memory-center-core）
├── worldsmith-core/       # Rust WASM 核心（storage/validation/graph layout）
├── tactical-engine/       # Rust WASM 战术引擎（pathfinding）
├── worldsmith-skills-store/ # Rust Skills Store 纯逻辑库（可独立 cargo test）
├── docs/                  # 文档（架构、路线图、按状态分类：已完成/执行中/未完成）
└── scripts/               # 构建与工具脚本
```

## 3. 三端职责

| 端 | 目录 | 职责 | 后端能力 |
|----|------|------|----------|
| **Web（主应用）** | `apps/web` | 浏览器运行的完整前端（Agent 对话、插件、群聊、字体、记忆库等） | WASM（worldsmith-core / tactical-engine）+ 可选 CLI serve 代理 |
| **CLI** | `apps/cli` | 命令行应用，`serve` 模式提供 HTTP+WS 服务 | Node 执行适配器 + python-services 微服务 |
| **Tauri** | `apps/tauri` | 桌面应用，前端 Vue + 后端 Rust（150+ 命令） | Rust 命令（src-tauri）+ `crates/agent-runtime` Agent 编排 |

**关键点**：端分离后，根级 `src/`、`src-tauri/`、`worldsmith-server/`、`worldsmith-agent/` 已全部迁移到三端与共享包，根目录不再存放应用源码。

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

- **Web**：Vue UI → composables → `apps/web/src/core/worldsmithCore.ts`（WASM 算法层）。
- **Tauri**：Vue UI → `Tauri invoke` → `apps/tauri/src-tauri` Rust 命令 → `crates/agent-runtime`。
- **Agent**：`packages/agent-runtime` 是端无关核心，三端各自通过适配器（Web 用 WS、Tauri 用 invoke、CLI 用 Node）接入。

## 7. 关键入口

- **Web 主应用**：`apps/web/src/main.ts` → `apps/web/src/App.vue` → `apps/web/src/ui/layout/Shell.vue`
- **Agent 对话**：`apps/web/src/agent/AgentChat.vue`
- **插件系统**：`apps/web/src/plugins/PluginManager.ts`
- **群聊 Space**：`apps/web/src/space/AgentSpace.vue`
- **Tauri Rust 后端**：`apps/tauri/src-tauri/src/lib.rs`
- **CLI serve**：`apps/cli/src/commands/serve.ts`

## 8. 常用命令

```bash
pnpm dev                 # 启动 Web 主应用（apps/web）
pnpm typecheck:all       # 三端类型检查（web/tauri/cli）
pnpm test:run            # 单元测试
pnpm build:web           # 构建 Web
pnpm build:wasm-all      # 构建 WASM（worldsmith-core + tactical-engine）
cargo check -p agent-runtime  # 检查 Rust Agent 后端
```
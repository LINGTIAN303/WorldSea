# WorldSea 架构总览

> 本文档描述**当前实际代码状态**（2026-10-11 复核重写：三层结构定型——壳 / Agent 面（dsh fork）/ 产品域（工作台窗）；旧 Agent 分层 `crates/` 已于 E8 整体退场），供新接手者快速定位代码。
> 细节以 [现状与冻结面](架构/现状与冻结面.md)（交接基线）与 [dsh 运行手册](架构/dsh-运行手册.md) 为准；与 `docs/details/端分离/` 文档库区分：后者是端分离迁移的历史记录与目标架构设计。

## 1. 项目定位

WorldSea 是一个 Agent 驱动的世界构建（worldbuilding）平台，帮助用户构建丰富、互相关联的虚构世界。

- **唯一 GUI**：`apps/tauri`（Tauri 2.11.5 桌面应用，原 `apps/web` 已于 2026-08-08 迁移后删除）
- **Agent 面**：仓根 `dsh/`（deepseek-harness **fork**，Node 子进程，IPC 管道零 TCP，界面 100% 保留）
- **产品域**：旧 Vue 前端（vite 独立构建 → `workspace-dist/`）作为**独立「工作台窗」**运行，壳协议 `/workspace` 前缀伺服
- **技术栈**：Vue 3 + TypeScript + Vite + Pinia（前端）；Rust（WASM 核心 + Tauri 壳 + 安装器）；Node（仅 dsh，Agent 面）

## 2. 顶层目录结构

```
WorldSea/
├── apps/                        # 应用入口
│   ├── tauri/                   # ★ 唯一 GUI（Tauri 2：src-tauri 壳 + 产品域前端 src/，端口 5175）
│   │   ├── src/                 # 产品域 Vue 前端（views/ 各芽视图 · world/ 世界树 · ui/ 布局 · shell/ 壳装配）
│   │   ├── src-tauri/           # Rust 壳（dsh 集成 dsh_*.rs + 产品域命令 fs/entity/algo + 菜单/托盘/窗口/ACL）
│   │   ├── workspace/           # 产品域独立构建入口（vite.config.ts → workspace-dist/）
│   │   └── splash/              # 启动页（独立 vite 构建 → shell-loading/）
│   ├── installer/               # 安装/卸载向导（Tauri 小壳：src-tauri + 静态 ui/）
│   ├── dsh-plugin-worldsea/     # dsh 插件：产品域工具面（12 条 world_* 工具 + 预设 preset-worldsea）
│   └── dsh-plugin-worldsea-console/  # dsh 插件：产品域管理面（设置分区 + 配置表单）
├── dsh/                         # Agent 面（deepseek-harness fork；我方改动 11 文件，见 dsh-fork台账）
├── packages/                    # 共享 monorepo 子包（12 个，见 §4）
├── worldsea-core/               # Rust WASM 核心（storage/validation/graph layout/sqlite）
├── tactical-engine/             # Rust WASM 战术引擎（pathfinding）
├── docs/                        # 文档（四类：index 索引 / plans 计划 / details 详情 / misc 其他）
└── scripts/                     # 构建与工具脚本（architecture 检查器 / doc-links / fork 台账）
```

## 3. 三层形态（载体 / 入口 / 边界）

| 面 | 载体 | 页面入口 | 命令面（放行） |
|----|------|----------|----------------|
| **壳** | Tauri 2.11.5（`apps/tauri/src-tauri`，Rust 91 命令注册） | — | 壳桥 + 流桥（两窗共用基座） |
| **Agent 面** | dsh（Node 子进程，IPC 管道） | `http://worldsea.localhost/`（`main` 窗） | 壳桥 7 + 流桥 4 |
| **产品域** | 旧 Vue 前端（`workspace-dist/`） | `http://worldsea.localhost/workspace/`（`workspace` 窗，懒创建） | 壳桥 7 + 产品域 30 |

**三面同源 `worldsea://localhost`；命令面按窗口 ACL 互斥授权**（`permissions/` + `capabilities/`，拒绝信息点名 `allowed on: [windows: …]`）——这是「面与面之间」唯一的硬边界。数字与机制细节见 [现状与冻结面](架构/现状与冻结面.md)。

## 4. 共享包（`packages/`，12 个）

| 包 | 职责 |
|----|------|
| `canvas-engine` | 共享画布渲染引擎（graph / tree / geometry / algorithms） |
| `core-api-types` | 前端 API 契约类型唯一源（EntityTypeSchema 等权威定义） |
| `entity-core` | 实体 CRUD、关系（两注册表）、facets、traits、stores、composables |
| `font-kit` | 字体管理与渲染 |
| `memory-archive` | 记忆归档系统（早期实现，现状为休眠/历史件） |
| `motion-kit` | 动画与动效工具 |
| `perf-kit` | 性能工具（响应式、IO 批处理、渲染节流） |
| `plugin-sdk` | 芽/插件开发 SDK（实体详情载体等） |
| `shared-composables` | 共享 Vue composables |
| `shared-ui` | 共享 UI 子包（markdown 内核等产品级模块） |
| `theme-kit` | 主题 manifest 系统与纹理引擎 |
| `ui-kit` | 共享 UI 组件（Ws* 基础组件、快捷键注册表、设置面板） |

## 5. Rust 侧

**现状（在盘）**：

| 件 | 职责 |
|----|------|
| `worldsea-core`（WASM） | 核心：serde、validation、migration、graph layout、sqlite |
| `tactical-engine`（WASM） | 战术引擎（pathfinding） |
| `apps/tauri/src-tauri` | 壳：dsh 集成层（`dsh_shell` / `dsh_pipe` / `dsh_stream` / `dsh_proxy` / `dsh_bridge` / `dsh_inject` / `dsh_credentials` / `dsh_workspace` / `dsh_titlebar.js` 等）· 产品域命令（fs/entity/algo/office/preview/secure_store/字体/LSP）· 菜单/托盘/窗口/ACL |
| `apps/installer/src-tauri` | NSIS 安装/卸载向导小壳（`worldsea-installer`） |

**历史（已退场，git 历史兜底）**：`crates/` 九目录（`agent-kernel` / `agent-patterns` / `agent-runtime` / `agent-commands` / `agent-memory` / `worldsea-skills-store` / `vendor` 等）已于 **E8（2026-09-27）** 整体删除——原「Agent 分层编排内核」由 dsh 接管承接。退场前的分层说明见 [orchestration-matrix.md](架构/orchestration-matrix.md)（已转历史留档）与 [Agent面冻结清单](架构/Agent面冻结清单.md)。

## 6. 数据流

- **产品域**：Vue UI → Tauri invoke → `src-tauri` 命令（entity/fs/算法/校验/预览）→ 文件（`worlddata/`）或 WASM。
- **Agent 面**：dsh 进程自持会话与工具循环（独立 Node 运行时）；与壳之间走 **IPC 管道帧隧道**（`dsh_pipe`），页面流走 `dsh_stream` 流桥；`world_*` 工具经由 dsh 插件（`applications.dsh-plugin-worldsea`）操作产品域数据。
- **实体数据**：存储 → FileStorageBackend（Rust fs 命令）；算法/校验/图布局 → WASM（`worldsea-core` / `tactical-engine`）。优先 Tauri IPC + 事件桥（非轮询）。
- **世界树（第二棵树）**：产品域内的 Cordis 树（`apps/tauri/src/world/`：清单/装载器/注册表），26 芽按插件模型装载；与 dsh 树经能力桥（`cmd_capability_*`）交互。

## 7. 关键入口

- **壳启动**：`apps/tauri/src-tauri/src/lib.rs`（setup 装配：dsh 宿主 install / 原生菜单 / 托盘 / 窗口与 ACL）
- **产品域前端**：`apps/tauri/src/main.ts` → `App.vue`；壳布局 `apps/tauri/src/ui/layout/Shell.vue`
- **世界树（芽体系）**：`apps/tauri/src/world/`（`loader.ts` 静态清单装载 / `tree.ts` 起树拆树 / `plugins/` 26 芽）
- **Agent 面**：仓根 `dsh/`——装构起与排障见 [dsh 运行手册](架构/dsh-运行手册.md)；我方改动边界见 [dsh-fork 台账](架构/dsh-fork台账.md)
- **窗口 ACL**：`apps/tauri/src-tauri/permissions/`（`worldsea-shell.toml` / `worldsea-product.toml`）+ `capabilities/`

## 8. 常用命令

```bash
pnpm tauri:dev           # 启动 Tauri 桌面端（唯一 GUI；先起 vite 5175）
pnpm test:run            # 单元测试（vitest，仓库根）
pnpm bench:gate          # 性能门禁（benchmarks/**）
pnpm typecheck:all       # 类型检查（全入口）
pnpm build:wasm-all      # 构建 WASM（worldsea-core + tactical-engine）
pnpm arch:check          # 架构检查（模块登记/文件规模/依赖边/环；0 违规为准）
pnpm fork:check          # dsh fork 台账门禁（11=11）
node scripts/check-doc-links.mjs   # 文档全库链接校验（断链 0 为准）
cd apps/tauri/src-tauri && cargo test --lib --offline   # 壳侧单测（含 dsh 集成层）
```

> 追版、管道、安全面等排障配方见 [dsh 运行手册](架构/dsh-运行手册.md) §五。

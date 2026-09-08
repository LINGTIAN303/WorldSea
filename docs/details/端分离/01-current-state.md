# 01 - 三端现状分析

> 调研日期：2026-07-29
> 数据来源：项目源码 + project_memory.md + package.json + tauri.conf.json
>
> ⚠️ **本文档为调研快照（2026-07-29）**，描述的是端分离启动前的耦合现状，作为历史基线保留。
> 实际迁移进展见 【`[08-migration-phases.md](./08-migration-phases.md)`】 与 【`[README.md](./README.md)`】。
> 已变化的事实（截至 2026-08-02）：
> - `packages/agent-runtime` 已建成并成为唯一运行时数据源（`@agent` 单轨）
> - `worldsea-agent/` 已冻结为端适配器宿主（仅 `src/index.ts` + `src/execution/`）
> - `src/` 仍是主应用（Phase 3 业务 UI 迁移暂停）

## 1. 项目整体结构

```
worldsea/
├── crates/                     # Rust crate（agent-runtime）
├── packages/                   # pnpm monorepo 子包（11 个）
│   ├── agent-core/             # 工具总线 + 技能注册（声明式）
│   ├── canvas-engine/          # 画布引擎
│   ├── entity-core/            # 实体核心
│   ├── font-kit/               # 字体
│   ├── governor-core/          # 治理器
│   ├── memory-archive/         # 记忆归档
│   ├── motion-kit/             # 动效
│   ├── perf-kit/               # 性能
│   ├── plugin-sdk/             # 插件 SDK
│   ├── theme-kit/              # 主题
│   └── ui-kit/                 # UI 组件
├── src/                        # 前端 Vue 3 源码（Tauri + Web 共用）
├── src-tauri/                  # Tauri Rust 后端（150+ 命令）
├── worldsea-agent/           # CLI 入口 + Agent 核心逻辑（混杂）
├── worldsea-server/          # Node.js HTTP/WS 服务（7 端点）
├── docs/                       # 文档
├── public/                     # 静态资源
├── scripts/                    # 脚本
├── index.html                  # Web 入口
├── package.json                # 主 package.json
├── pnpm-workspace.yaml         # workspace 配置
└── project_memory.md           # 项目记忆
```

## 2. 三端入口现状

### 2.1 Tauri 端（桌面应用）

**入口**：
- 前端入口：`index.html` → `src/main.ts`（与 Web 端共用）
- 后端入口：`src-tauri/src/main.rs` → `lib.rs`
- 配置：`src-tauri/tauri.conf.json`
- 启动：`npm run tauri:dev` / `npm run tauri:build`

**构建链**：
```
tauri:dev  → beforeDevCommand: npm run dev (Vite 5173) + Tauri 壳
tauri:build → beforeBuildCommand: npm run build:web (WASM+vue-tsc+vite build) + cargo build
```

**Rust 后端能力**（`src-tauri/src/commands/`）：
- `agent.rs` — 14 个 agent 命令（对应 IAgentBackend 接口）
- `long_task.rs` — 7 个长任务命令
- `session.rs` — 6 个会话命令
- `fs.rs` / `file.rs` — 文件系统
- `pty.rs` / `shell.rs` — 终端
- `mcp.rs` — MCP
- `kv.rs` — KV 存储
- `entity.rs` / `relation.rs` / `schema.rs` — 实体/关系/Schema
- `got.rs` / `tot.rs` / `router.rs` — GoT/ToT/Router
- `loop_control.rs` / `multi_agent.rs` / `supervisor.rs` — 编排
- `skills.rs` / `project.rs` / `secure.rs` / `validate.rs` / `spatial.rs` / `retrofit.rs` / `algo.rs` / `font.rs` / `schema_seed.rs`
- 总计 150+ Tauri 命令

**前端依赖 Tauri 的文件**（18 个）：
- `src/agent/composables/useAgentRust.ts` 等 8 个 Rust composables
- `src/core/coreBackend.ts` — Tauri/WASM 检测
- `src/core/ProjectFS.ts` — 项目文件系统
- `src/composables/useProjectSwitcher.ts` / `useFsWatcher.ts` / `useFileSystemProject.ts`
- `src/agent/TerminalPanel.vue` / `src/agent/panels/TerminalPanel.vue`
- `src/memory-archive/adapters/TauriFsOperations.ts`
- `src/plugins/official/mindmap/composables/useRustLayout.ts` / `useRustGraphAnalysis.ts`
- `src/plugins/official/workflow/composables/useWorkflowEngineRun.ts` / `api/workflowApi.ts`

### 2.2 Web 端（浏览器应用）

**入口**：
- HTML 入口：`index.html`（含静态启动页 + Vue 挂载点）
- JS 入口：`src/main.ts`（与 Tauri 端共用）
- 启动：`npm run dev`（Vite 5173）
- 构建：`npm run build:web`（先构建 WASM，再 vue-tsc + vite build）

**后端依赖**：
1. **WASM**（worldsea-core、tactical-engine）— Tauri 不可用时的回退
   - 构建：`npm run build:wasm-all`
   - 加载：`src/core/worldseaCore.ts` + `wasmWorkerPool.ts`
2. **worldsea-server**（Node.js）— 7 个 HTTP 端点
   - 启动：`npm run server` / `npm run server:start`
   - 端点：crawl / convert / vector-search
   - 目录：`worldsea-server/`（含 python-services）
3. **CLI serve**（HTTP+WS）— 通过 WS 连接 CLI Agent
   - 启动：`worldsea serve`
   - 端口：3100（默认）
   - 协议：HTTP（工具调用）+ WS（流式事件）

**Web 端特有问题**：
- `coreBackend.ts` 运行时 `detectBackend()` 检测 `__TAURI_INTERNALS__` / `__TAURI__` / WASM
- 18 个文件 import `@tauri-apps/api`（在浏览器环境会失败/降级）
- 14 个文件检查 `__TAURI__` 全局对象

### 2.3 CLI 端（命令行应用）

**入口**：
- 二进制入口：`worldsea-agent/bin/cli.mjs`
- 主代码：`worldsea-agent/src/cli/`
- 启动：`worldsea chat` / `worldsea serve`
- 配置：`worldsea-agent/package.json` + `tsconfig.cli.json`

**CLI 子命令**：
- `chat` — 交互式对话
- `serve` — 启动 HTTP+WS 服务器（供 Web 端连接）

**CLI 内部结构**：
```
worldsea-agent/src/
├── cli/                        # CLI 专属
│   ├── stores/                 # CLI 版 stores（替代 Vue Pinia）
│   ├── cli-agent.ts            # CLI Agent 实现
│   ├── cli-context.ts          # CLI 工具上下文
│   ├── cli-safety-guard.ts     # 安全防护
│   ├── cli-session-store.ts    # 会话存储
│   ├── serve.ts                # HTTP+WS 服务器
│   └── index.ts                # commander 入口
├── execution/                  # 端抽象层（已存在）
│   ├── adapter.ts              # ExecutionAdapter 接口
│   ├── node-adapter.ts         # Node 环境（CLI 用）
│   ├── tauri-adapter.ts        # Tauri 环境（Tauri 用）
│   ├── ws-adapter.ts           # WebSocket（Web 用）
│   ├── env.ts                  # 环境检测
│   └── index.ts                # 工厂函数
├── tools/                      # 工具定义（端无关，应共享）
├── skills/                     # 技能定义（端无关，应共享）
├── agent.ts                    # Agent 主循环（端无关，应共享）
├── bridge.ts                   # 桥接（端无关，应共享）
├── session/                    # 会话管理（端无关，应共享）
├── orchestrator/               # 编排（端无关，应共享）
├── toolbus/                    # 工具总线（端无关，应共享）
├── providers/                  # LLM 供应商（端无关，应共享）
├── context/                    # 上下文构建（端无关，应共享）
├── kb/                         # 知识库（端无关，应共享）
├── embedding/                  # 向量嵌入（端无关，应共享）
├── group-chat/                 # 群聊（端无关，应共享）
├── mcp/                        # MCP（端无关，应共享）
├── stores/                     # 图像/视频持久化（端无关，应共享）
└── utils/                      # 通用工具（端无关，应共享）
```

## 3. 三端耦合点分析

### 3.1 `src/` 目录共用（Tauri + Web）

**问题**：`src/` 同时被 Tauri 端和 Web 端使用，导致：
- 18 个文件直接 `import @tauri-apps/api`（Web 端运行时会失败）
- 14 个文件检查 `__TAURI__` 全局对象（运行时分支）
- `coreBackend.ts` 的 `detectBackend()` 三态切换（tauri/wasm/none）
- 构建配置复杂（需同时支持 Tauri 与 Web）

**耦合文件清单**（按影响排序）：

| 文件 | 耦合类型 | 影响 |
|------|----------|------|
| `src/core/coreBackend.ts` | Tauri/WASM 运行时检测 | 1300 行，所有算法调用入口 |
| `src/agent/composables/useAgent.ts` | TS/Rust 后端路由 | Agent 主入口 |
| `src/agent/composables/useAgentRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/agent/composables/useGoTRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/agent/composables/useToTRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/agent/composables/useRouterRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/agent/composables/useSupervisorRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/agent/composables/useMultiAgentRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/agent/composables/useLoopControlRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/agent/composables/useLongTaskRust.ts` | Tauri invoke | 仅 Tauri 用 |
| `src/core/ProjectFS.ts` | Tauri invoke | 项目文件系统 |
| `src/composables/useProjectSwitcher.ts` | Tauri invoke | 项目切换 |
| `src/composables/useFsWatcher.ts` | Tauri invoke | 文件监听 |
| `src/composables/useFileSystemProject.ts` | __TAURI__ 检测 | 文件系统项目 |
| `src/agent/TerminalPanel.vue` | Tauri invoke | 终端面板 |
| `src/agent/panels/TerminalPanel.vue` | Tauri invoke | 终端面板（旧） |
| `src/memory-archive/adapters/TauriFsOperations.ts` | Tauri invoke | 记忆归档 FS |
| `src/plugins/official/mindmap/composables/useRustLayout.ts` | Tauri invoke | 思维导图布局 |
| `src/plugins/official/mindmap/composables/useRustGraphAnalysis.ts` | Tauri invoke | 思维导图分析 |
| `src/plugins/official/workflow/composables/useWorkflowEngineRun.ts` | Tauri invoke | 工作流引擎 |
| `src/plugins/official/workflow/api/workflowApi.ts` | Tauri invoke | 工作流 API |

### 3.2 `worldsea-agent/` 职责混杂

**问题**：`worldsea-agent/` 既是 CLI 入口，又包含端无关的 Agent 核心逻辑。

**端无关部分**（应抽离到 `packages/agent-runtime`）：
- `agent.ts` / `bridge.ts` / `bridge-types.ts`
- `tools/` / `skills/` / `toolbus/`
- `session/` / `orchestrator/`
- `providers/` / `context/` / `kb/` / `embedding/`
- `group-chat/` / `mcp/` / `stores/` / `utils/`
- `governor.ts`

**CLI 专属部分**（应迁到 `apps/cli/`）：
- `cli/` 整个目录
- `bin/cli.mjs`
- `execution/node-adapter.ts`

**Tauri 专属部分**（应迁到 `apps/tauri/`）：
- `execution/tauri-adapter.ts`

**Web 专属部分**（应迁到 `apps/web/`）：
- `execution/ws-adapter.ts`

### 3.3 后端能力重叠

**重叠矩阵**：

| 能力 | Tauri Rust 命令 | CLI 工具 | worldsea-server |
|------|-----------------|----------|-------------------|
| Shell 执行 | `shell_*` / `pty_*` | `shell_session_*` / `execute_command` | - |
| 文件操作 | `fs_*` / `file_*` | `read_file` / `write_file` 等 | - |
| Git 操作 | - | `git_*` | - |
| 项目命令 | - | `run_lint` / `run_test` / `run_build` | - |
| 系统信息 | `sys_info` | `sys_info` / `env_*` | - |
| 爬虫 | - | `crawl_tool` | `crawl` 路由 |
| 文档转换 | - | `doc_convert_tool` | `convert` 路由 |
| 向量搜索 | - | `vector_search` | `vector-search` 路由 |
| PTY 终端 | `pty_*` | `shell_session_*` | `pty-manager.ts` |
| 终端启动 | `launch_terminal` | `launch_terminal` | `terminal-launcher.ts` |
| Agent | `agent_*` (14 命令) | `createCliAgent` | - |
| 长任务 | `long_task_*` (7 命令) | - | - |
| 会话 | `session_*` (6 命令) | `cli-session-store` | - |
| 工作流 | `workflow_*` | - | - |
| 实体/关系/Schema | `entity_*` / `relation_*` / `schema_*` | - | - |
| GoT/ToT/Router | `got_*` / `tot_*` / `router_*` | - | - |
| 编排 | `loop_control_*` / `multi_agent_*` / `supervisor_*` | - | - |
| MCP | `mcp_*` | `mcp-manager` | - |
| KV 存储 | `kv_*` | - | - |
| 空间索引 | `spatial_*` | - | - |
| Retrofit | `retrofit_*` | - | - |
| 算法 | `algo_*` | - | - |
| 字体 | `font_*` | - | - |
| Skills | `skills_*` | `skills-store` | - |
| 安全 | `secure_*` | `cli-safety-guard` | - |
| 校验 | `validate_*` | - | - |
| 项目 | `project_*` | - | - |
| Schema Seed | `schema_seed` | - | - |

**重叠点**：
1. **Shell/PTY**：Tauri Rust + CLI + worldsea-server 三者都实现
2. **爬虫/转换/向量搜索**：CLI 工具 + worldsea-server 两者实现
3. **Agent**：Tauri Rust 命令 + CLI Agent 两者实现（前者调 Rust，后者调 TS）

## 4. 构建配置现状

### 4.1 主 package.json scripts

```json
{
  "dev": "vite",                                    // Web/Tauri 共用 Vite dev
  "server": "cd worldsea-server && npm run dev",  // worldsea-server
  "server:start": "cd worldsea-server && npm run start",
  "build:wasm": "...",                              // 构建 WASM
  "build:web": "build:wasm-all && vue-tsc -b && vite build",
  "build": "build:wasm-all && vue-tsc -b && vite build",
  "tauri:dev": "tauri dev",                         // Tauri dev
  "tauri:build": "tauri build"                      // Tauri build
}
```

### 4.2 pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
  - 'worldsea-agent'   # 注意：worldsea-agent 作为 workspace 成员
```

### 4.3 tauri.conf.json

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",               // 启动 Vite
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build:web",       // 构建 Web
    "frontendDist": "../dist"
  }
}
```

**构建链问题**：
- Tauri 构建依赖 `npm run build:web`（含 WASM 构建）
- Web 构建产物在 `dist/`，Tauri 通过 `frontendDist: "../dist"` 引用
- 三端无法独立构建

## 5. 技术债清单

| 编号 | 技术债 | 影响范围 | 优先级 |
|------|--------|----------|--------|
| TD-01 | `src/` 被 Tauri+Web 共用，18 文件 import `@tauri-apps/api` | 前端 | P0 |
| TD-02 | `worldsea-agent/` 职责混杂（CLI 入口 + Agent 核心） | 全端 | P0 |
| TD-03 | `worldsea-server` 与 CLI serve 能力重叠 | Web/CLI | P1 |
| TD-04 | Tauri 命令与 CLI 工具在 shell/git/file 重叠 | Tauri/CLI | P2 |
| TD-05 | `coreBackend.ts` 运行时检测 Tauri/WASM 三态 | Web/Tauri | P0 |
| TD-06 | `useAgent.ts` TS/Rust 后端路由层 | 前端 | P0 |
| TD-07 | 三端构建互相牵制（Tauri 依赖 build:web） | 构建 | P1 |
| TD-08 | WASM 构建作为 Tauri 回退（Tauri 端不需要 WASM） | Tauri | P2 |
| TD-09 | `execution/` 抽象层已存在但未覆盖前端 UI 层 | 全端 | P1 |
| TD-10 | 14 文件检查 `__TAURI__` 全局对象 | 前端 | P0 |

## 6. 调研结论

1. **三端分离的可行性高**：`worldsea-agent/src/execution/` 已有端抽象层，`packages/` monorepo 基础设施完善
2. **主要工作量在 `src/` 拆分**：18+ 文件耦合 Tauri API，需逐个迁移
3. **后端整合可控**：worldsea-server 能力可逐步迁移到 CLI serve
4. **构建独立性需重新设计**：当前 Tauri 依赖 Web 构建，需改为 Tauri 独立 Vite 配置
5. **共享代码层抽离是关键**：`worldsea-agent/src/` 大部分代码端无关，抽离后三端均可复用

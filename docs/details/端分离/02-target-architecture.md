# 02 - 目标架构

> 设计日期：2026-07-29
> 状态：✅ 已实施（2026-08-06 复核：apps/ 三端、packages/agent-runtime 共享层已按本架构落地；根 src/ 业务 UI 已于 2026-08-03 全量迁入 apps/web 并删除。小偏差：tauri 端 Rust composables 实际为 3 个（useAgentRust/useLongTaskRust/useLoopControlRust），packages/agent-runtime 无 embedding/ 子目录、shared-composables 为 agent/entity/ui 子目录结构）

## 1. 目标目录结构

```
worldsmith/
├── apps/                                # 三端应用入口
│   ├── web/                             # Web 端（浏览器应用）
│   │   ├── public/                      # 静态资源
│   │   ├── src/                         # Web 专属前端源码
│   │   │   ├── main.ts                  # Web 入口（从 src/main.ts 迁移）
│   │   │   ├── App.vue                  # Web 根组件
│   │   │   ├── agent/                   # Web 专属 Agent composables
│   │   │   │   └── useAgentWs.ts        # 通过 WS 连接 CLI serve 的 Agent
│   │   │   ├── core/                    # Web 专属 core
│   │   │   │   └── coreBackend.ts       # 仅 WASM 后端，无 Tauri 分支
│   │   │   ├── composables/             # Web 专属 composables
│   │   │   └── ...                      # 其他 Web 专属代码
│   │   ├── index.html                   # Web HTML 入口
│   │   ├── vite.config.ts               # Web 专属 Vite 配置
│   │   ├── tsconfig.json                # Web 专属 tsconfig
│   │   └── package.json                 # Web 专属 package.json
│   │
│   ├── cli/                             # CLI 端（命令行应用）
│   │   ├── src/
│   │   │   ├── bin/
│   │   │   │   └── cli.mjs              # CLI 入口（从 worldsmith-agent/bin/ 迁移）
│   │   │   ├── commands/                # commander 命令
│   │   │   │   ├── chat.ts              # 交互式对话
│   │   │   │   └── serve.ts             # HTTP+WS 服务器
│   │   │   ├── stores/                  # CLI 版 stores（从 worldsmith-agent/src/cli/stores/ 迁移）
│   │   │   ├── context/                 # CLI 工具上下文
│   │   │   ├── safety-guard.ts          # 安全防护
│   │   │   ├── session-store.ts         # 会话存储
│   │   │   └── execution/
│   │   │       └── node-adapter.ts      # Node 环境适配器
│   │   ├── tsconfig.json                # CLI 专属 tsconfig
│   │   └── package.json                 # CLI 专属 package.json
│   │
│   └── tauri/                           # Tauri 端（桌面应用）
│       ├── src/                         # Tauri 专属前端源码
│       │   ├── main.ts                  # Tauri 入口
│       │   ├── App.vue                  # Tauri 根组件
│       │   ├── agent/                   # Tauri 专属 Agent composables
│       │   │   ├── useAgentRust.ts      # 通过 Tauri invoke 调 Rust
│       │   │   ├── useGoTRust.ts
│       │   │   ├── useToTRust.ts
│       │   │   ├── useRouterRust.ts
│       │   │   ├── useSupervisorRust.ts
│       │   │   ├── useMultiAgentRust.ts
│       │   │   ├── useLoopControlRust.ts
│       │   │   └── useLongTaskRust.ts
│       │   ├── core/
│       │   │   └── coreBackend.ts       # 仅 Tauri 后端，无 WASM 回退
│       │   ├── composables/             # Tauri 专属 composables
│       │   │   ├── useProjectSwitcher.ts
│       │   │   ├── useFsWatcher.ts
│       │   │   └── useFileSystemProject.ts
│       │   ├── execution/
│       │   │   └── tauri-adapter.ts     # Tauri 环境适配器
│       │   └── ...
│       ├── src-tauri/                   # Rust 后端（从根 src-tauri/ 迁移）
│       │   ├── src/
│       │   │   ├── commands/            # 150+ Tauri 命令
│       │   │   ├── agent_bridge/
│       │   │   ├── workflow/
│       │   │   ├── lib.rs
│       │   │   ├── main.rs
│       │   │   ├── state.rs
│       │   │   └── schema_seed.rs
│       │   ├── capabilities/
│       │   ├── icons/
│       │   ├── Cargo.toml
│       │   ├── build.rs
│       │   └── tauri.conf.json          # Tauri 专属配置
│       ├── vite.config.ts               # Tauri 专属 Vite 配置
│       ├── tsconfig.json                # Tauri 专属 tsconfig
│       └── package.json                 # Tauri 专属 package.json
│
├── packages/                            # 共享代码层（端无关）
│   ├── agent-runtime/                   # ★ 新增：Agent 核心运行时
│   │   ├── src/
│   │   │   ├── agent.ts                 # Agent 主循环
│   │   │   ├── bridge.ts                # 桥接
│   │   │   ├── bridge-types.ts          # 桥接类型
│   │   │   ├── tools/                   # 工具定义
│   │   │   ├── skills/                  # 技能定义
│   │   │   ├── session/                 # 会话管理
│   │   │   ├── orchestrator/            # 编排
│   │   │   ├── toolbus/                 # 工具总线
│   │   │   ├── providers/               # LLM 供应商
│   │   │   ├── context/                 # 上下文构建
│   │   │   ├── kb/                      # 知识库
│   │   │   ├── embedding/               # 向量嵌入
│   │   │   ├── group-chat/              # 群聊
│   │   │   ├── mcp/                     # MCP
│   │   │   ├── stores/                  # 图像/视频持久化
│   │   │   ├── execution/               # ExecutionAdapter 接口与工厂
│   │   │   │   ├── adapter.ts           # 接口定义
│   │   │   │   ├── env.ts               # 环境检测
│   │   │   │   └── index.ts             # 工厂函数（不含具体 adapter）
│   │   │   ├── governor.ts              # 治理器
│   │   │   ├── utils/                   # 通用工具
│   │   │   └── index.ts                 # 包入口
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   ├── agent-core/                      # 已存在：工具总线 + 技能注册（声明式）
│   ├── canvas-engine/                   # 已存在：画布引擎
│   ├── entity-core/                     # 已存在：实体核心
│   ├── font-kit/                        # 已存在：字体
│   ├── governor-core/                   # 已存在：治理器
│   ├── memory-archive/                  # 已存在：记忆归档
│   ├── motion-kit/                      # 已存在：动效
│   ├── perf-kit/                        # 已存在：性能
│   ├── plugin-sdk/                      # 已存在：插件 SDK
│   ├── theme-kit/                       # 已存在：主题
│   ├── ui-kit/                          # 已存在：UI 组件
│   ├── shared-ui/                       # ★ 新增：三端共用 Vue 组件
│   │   ├── src/
│   │   │   ├── agent/                   # Agent 相关 UI（AgentChat/AgentMessageBubble 等）
│   │   │   ├── space/                   # Space 相关 UI
│   │   │   ├── ui/                      # Ws* 基础组件
│   │   │   ├── plugins/                 # 插件 UI
│   │   │   ├── stores/                  # 共享 Pinia stores
│   │   │   ├── design-tokens/           # 设计令牌
│   │   │   └── assets/                  # 共享资源
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── shared-composables/              # ★ 新增：三端共用 composables
│       ├── src/
│       │   ├── useAgent.ts              # 统一 Agent 入口（端无关）
│       │   ├── useLongTask.ts           # 长任务（端无关）
│       │   ├── useOrchestrator.ts       # 编排（端无关）
│       │   ├── useEventBus.ts           # 事件总线
│       │   ├── useTheme.ts              # 主题
│       │   ├── useToast.ts              # Toast
│       │   └── ...                      # 其他端无关 composables
│       ├── package.json
│       └── vite.config.ts
│
├── crates/                              # Rust crates
│   └── agent-runtime/                   # 已存在：Rust Agent runtime
│
├── docs/                                # 文档
│   └── 端分离/                          # 本文档库
│
├── scripts/                             # 脚本
├── pnpm-workspace.yaml                  # workspace 配置（更新）
├── package.json                         # 根 package.json（仅 devDependencies）
└── AGENTS.md
```

## 2. 责任边界

### 2.1 apps/web（Web 端）

**职责**：浏览器中运行的纯前端应用，通过 HTTP/WS 连接 CLI serve 获取后端能力。

**包含**：
- Web 专属入口（main.ts / App.vue / index.html）
- Web 专属 Vite 配置（无 Tauri 依赖）
- WASM 后端（worldsmith-core / tactical-engine）作为算法层
- WebSocket 适配器（连接 CLI serve）
- Web 专属 composables（无 Tauri invoke）

**依赖**：
- `@worldsmith/agent-runtime`（Agent 核心）
- `@worldsmith/shared-ui`（共用 UI 组件）
- `@worldsmith/shared-composables`（共用 composables）
- `@worldsmith/*` 其他共享包
- WASM 包（worldsmith-core / tactical-engine）

**不依赖**：
- `@tauri-apps/api` / `@tauri-apps/cli` / `@tauri-apps/plugin-*`
- 任何 Rust 后端

### 2.2 apps/cli（CLI 端）

**职责**：Node.js 命令行应用，提供交互式对话与 serve 模式（HTTP+WS 服务器）。

**包含**：
- CLI 入口（bin/cli.mjs）
- commander 命令（chat / serve）
- CLI 版 stores（替代 Vue Pinia）
- Node 环境执行适配器
- HTTP+WS 服务器实现
- 工具上下文与安全防护

**依赖**：
- `@worldsmith/agent-runtime`（Agent 核心）
- `commander` / `ws` / `dexie`
- Node.js 内置模块（child_process / fs / path / crypto）

**不依赖**：
- Vue / Pinia / Naive UI
- `@tauri-apps/*`
- WASM

### 2.3 apps/tauri（Tauri 端）

**职责**：Tauri 桌面应用，前端 Vue + 后端 Rust（150+ 命令）。

**包含**：
- Tauri 专属前端入口（main.ts / App.vue）
- Tauri 专属 Vite 配置
- Tauri 专属 Agent composables（useAgentRust 等 8 个）
- Tauri 专属 core（coreBackend 仅 Tauri 后端）
- Rust 后端（src-tauri/，150+ 命令）
- Tauri 环境执行适配器

**依赖**：
- `@worldsmith/agent-runtime`（Agent 核心）
- `@worldsmith/shared-ui`（共用 UI 组件）
- `@worldsmith/shared-composables`（共用 composables）
- `@tauri-apps/api` / `@tauri-apps/cli`
- Vue / Pinia / Naive UI

**不依赖**：
- WASM（Tauri 端用 Rust 命令替代）
- `worldsmith-server`
- CLI serve

### 2.4 packages/agent-runtime（共享 Agent 核心）

**职责**：端无关的 Agent 核心运行时，提供 Agent 主循环、工具、技能、会话等能力。

**包含**：
- `agent.ts` / `bridge.ts` / `bridge-types.ts`
- `tools/` / `skills/` / `toolbus/`
- `session/` / `orchestrator/`
- `providers/` / `context/` / `kb/` / `embedding/`
- `group-chat/` / `mcp/` / `stores/` / `utils/`
- `governor.ts`
- `execution/adapter.ts`（接口定义，不含具体实现）

**依赖**：
- `@worldsmith/agent-core`（声明式 ToolRegistry/SkillRegistry）
- `@worldsmith/governor-core`
- `dexie`（IndexedDB 持久化）
- `ws`（WebSocket 类型，仅类型不实际 import）

**API 契约**：
- 导出 `createAgent(config)` 创建 Agent 实例
- 导出 `ExecutionAdapter` 接口，由三端各自实现
- 导出所有工具定义与技能定义
- 不依赖任何端特定 API（无 `@tauri-apps/api`、无 `window`、无 `process`）

### 2.5 packages/shared-ui（共享 UI 组件）

**职责**：三端共用的 Vue 组件库。

**包含**：
- Agent UI（AgentChat / AgentMessageBubble / AgentInputBar 等）
- Space UI（AgentSpace / SpaceChat 等）
- 基础 UI（Ws* 组件）
- 插件 UI
- 共享 Pinia stores
- 设计令牌与资源

**依赖**：
- Vue / Pinia / Naive UI
- `@worldsmith/*` 其他共享包

**API 契约**：
- 通过 props/emit 接收 Agent 后端实现（不直接 import 具体后端）
- 通过 provide/inject 获取端特定能力（如文件系统、终端）

### 2.6 packages/shared-composables（共享 composables）

**职责**：三端共用的 composables，通过依赖注入接收端特定实现。

**包含**：
- `useAgent.ts`（统一 Agent 入口，接收 backend 参数）
- `useLongTask.ts` / `useOrchestrator.ts` 等
- `useEventBus.ts` / `useTheme.ts` / `useToast.ts` 等通用 composables

**依赖注入模式**：
```typescript
// shared-composables/src/useAgent.ts
export function useAgent(options: {
  backend: IAgentBackend          // 由端注入
  executionAdapter?: ExecutionAdapter  // 可选，由端注入
}) {
  // 端无关逻辑
}
```

## 3. 数据流

### 3.1 Web 端数据流

```
用户浏览器
  │
  ├─ Vue UI（shared-ui）
  │   │
  │   ├─ useAgent（shared-composables）
  │   │   │
  │   │   └─ useAgentWs（apps/web）
  │   │       │
  │   │       └─ WebSocket → CLI serve（apps/cli）
  │   │           │
  │   │           └─ agent-runtime（packages/agent-runtime）
  │   │               │
  │   │               └─ NodeExecutionAdapter → child_process
  │   │
  │   └─ coreBackend（apps/web）
  │       │
  │       └─ WASM（worldsmith-core / tactical-engine）
  │
  └─ HTTP → CLI serve（爬虫/转换/向量搜索）
```

### 3.2 CLI 端数据流

```
用户终端
  │
  └─ commander 命令（apps/cli）
      │
      ├─ chat 命令
      │   │
      │   └─ agent-runtime（packages/agent-runtime）
      │       │
      │       └─ NodeExecutionAdapter → child_process
      │
      └─ serve 命令
          │
          ├─ HTTP 服务器 → 工具调用
          └─ WS 服务器 → 流式事件
              │
              └─ agent-runtime
```

### 3.3 Tauri 端数据流

```
用户桌面
  │
  ├─ Vue UI（shared-ui）
  │   │
  │   ├─ useAgent（shared-composables）
  │   │   │
  │   │   └─ useAgentRust（apps/tauri）
  │   │       │
  │   │       └─ Tauri invoke → Rust 命令（src-tauri/）
  │   │           │
  │   │           └─ agent_runtime（crates/agent-runtime/）
  │   │
  │   └─ coreBackend（apps/tauri）
  │       │
  │       └─ Tauri invoke → Rust 算法命令
  │
  └─ TauriExecutionAdapter → Tauri invoke → Rust PTY/Shell 命令
```

## 4. 构建独立性

### 4.1 三端独立构建

| 端 | dev 命令 | build 命令 | 产物 |
|----|----------|------------|------|
| Web | `pnpm --filter @worldsmith/web dev` | `pnpm --filter @worldsmith/web build` | `apps/web/dist/` |
| CLI | `pnpm --filter @worldsmith/cli dev` | `pnpm --filter @worldsmith/cli build` | `apps/cli/dist/` |
| Tauri | `pnpm --filter @worldsmith/tauri tauri:dev` | `pnpm --filter @worldsmith/tauri tauri:build` | Tauri 安装包 |

### 4.2 Vite 配置独立性

- **Web 端**：`apps/web/vite.config.ts` — 标准 Vite 配置，WASM 插件，无 Tauri 集成
- **Tauri 端**：`apps/tauri/vite.config.ts` — Tauri 集成 Vite 配置，无 WASM 构建
- **CLI 端**：`apps/cli/tsconfig.json` — 仅 TypeScript 编译，无 Vite

### 4.3 依赖独立性

```json
// apps/web/package.json
{
  "dependencies": {
    "@worldsmith/agent-runtime": "workspace:*",
    "@worldsmith/shared-ui": "workspace:*",
    "@worldsmith/shared-composables": "workspace:*",
    "@worldsmith/core": "file:../../worldsmith-core/pkg",  // WASM
    "vue": "^3.5.32",
    "pinia": "^3.0.4"
    // 无 @tauri-apps/*
  }
}

// apps/cli/package.json
{
  "dependencies": {
    "@worldsmith/agent-runtime": "workspace:*",
    "commander": "^14.0.3",
    "ws": "^8.18.0"
    // 无 vue, 无 @tauri-apps/*
  }
}

// apps/tauri/package.json
{
  "dependencies": {
    "@worldsmith/agent-runtime": "workspace:*",
    "@worldsmith/shared-ui": "workspace:*",
    "@worldsmith/shared-composables": "workspace:*",
    "@tauri-apps/api": "^2.11.0",
    "vue": "^3.5.32"
    // 无 WASM
  }
}
```

## 5. pnpm-workspace.yaml 更新

```yaml
packages:
  - 'apps/*'           # 三端应用
  - 'packages/*'       # 共享包（含新增 agent-runtime / shared-ui / shared-composables）
# 移除 worldsmith-agent（已拆分到 apps/cli 与 packages/agent-runtime）
allowBuilds:
  '@google/genai': true
  esbuild: true
  protobufjs: true
  vue-demi: true
overrides:
  vis-data: 8.0.3
```

## 6. 与现有架构的差异

| 维度 | 现有架构 | 目标架构 |
|------|----------|----------|
| 目录结构 | `src/` + `src-tauri/` + `worldsmith-agent/` + `worldsmith-server/` | `apps/{web,cli,tauri}/` + `packages/` |
| 前端共用 | `src/` 被 Tauri+Web 共用 | `packages/shared-ui/` + `packages/shared-composables/` |
| Agent 核心 | `worldsmith-agent/src/`（与 CLI 混杂） | `packages/agent-runtime/`（纯端无关） |
| 后端服务 | `worldsmith-server` + CLI serve + Tauri 命令（三者重叠） | CLI serve + Tauri 命令（worldsmith-server 删除） |
| 后端检测 | `coreBackend.ts` 运行时 `detectBackend()` | 端编译期决定，无运行时检测 |
| Agent 后端 | `useAgent.ts` 路由 TS/Rust | 每端单一后端实现 |
| 构建依赖 | Tauri 依赖 `build:web` | 三端独立构建 |

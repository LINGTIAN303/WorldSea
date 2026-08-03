# 00 - 总览与目标

## 1. 项目背景

WorldSmith 当前是一个 Tauri 桌面应用 + Web 应用 + CLI 工具的混合项目，三端代码高度耦合：

- **`src/` 目录**：被 Tauri 端与 Web 端共用，18 个文件直接 `import @tauri-apps/api`
- **`worldsmith-agent/`**：作为 CLI 入口存在，但其内部 `tools/skills/agent.ts/session/orchestrator` 是端无关的纯 Agent 逻辑，被三端隐性依赖
- **`worldsmith-server/`**：Node.js HTTP/WS 服务，与 CLI `serve` 模式、Tauri 命令三者能力重叠
- **`src-tauri/`**：Rust 后端 150+ 命令，与 CLI 工具在 shell/git/file 等能力上重叠

耦合导致：
- 三端构建互相牵制（Tauri 构建必须先 `npm run build:web`）
- 运行时检测分支多（`__TAURI__` / `window` / `process` 三态切换）
- 同一功能三套实现（如 shell 执行：Tauri Rust 命令 / CLI Node child_process / Web WebSocket 调 CLI）
- 维护成本高，新功能需在三端各实现一次

## 2. 分离目标

### 2.1 核心目标

| 目标 | 衡量标准 |
|------|----------|
| 物理目录分离 | `apps/web`、`apps/cli`、`apps/tauri` 三个独立子项目，各自有 `package.json` 与构建配置 |
| 共享代码下沉 | 端无关逻辑（Agent 核心、工具、技能、会话）抽离到 `packages/agent-runtime` |
| 单一后端实现 | 每端只有一种后端实现，移除运行时检测分支 |
| 构建独立 | 三端可独立 `dev` / `build`，互不依赖 |
| 入口清理 | Web 端无 `@tauri-apps/api` 引用；Tauri 端无 WASM 回退；CLI 端无浏览器 API |

### 2.2 非目标（Non-Goals）

- **不**重写 Rust 后端（`src-tauri/` Rust 命令保持原样）
- **不**改变前端 UI 组件库（Naive UI + 自研 Ws* 组件保持不变）
- **不**改变 Agent 核心算法（pi-ai 框架、ToolBus、SkillRegistry 逻辑保持不变）
- **不**改变数据模型（IndexedDB schema、SQLite schema 保持不变）
- **不**统一三端 UI 体验（Web/CLI/Tauri 各有定位，UI 可不同）

## 3. 决策记录

### 3.1 分离策略：物理目录彻底分离

**决策**：创建 `apps/web`、`apps/cli`、`apps/tauri` 三个独立子项目，共享代码迁入 `packages/`。

**理由**：
- 用户明确要求"三端的彻底分离"
- 物理目录分离是最彻底的解耦方式，构建独立、责任清晰
- 渐进式分离周期长且中间状态复杂，物理分离虽有重构量但边界清晰

**取舍**：
- 优势：彻底解耦、构建独立、责任清晰、便于未来独立部署/发布
- 劣势：一次性重构量大、需迁移大量文件、过渡期可能影响开发节奏

### 3.2 共享代码层：抽离到 packages/agent-runtime

**决策**：将 `worldsmith-agent/src/` 中的端无关部分抽离为 `packages/agent-runtime` 共享包。

**抽离范围**：
- `agent.ts` / `bridge.ts` / `bridge-types.ts` — Agent 主循环与桥接
- `tools/` — 工具定义（含 tool-meta-registry）
- `skills/` — 技能定义与注册
- `session/` — 会话管理
- `orchestrator/` — 多 Agent 编排
- `toolbus/` — 工具总线
- `providers/` — LLM 供应商配置
- `context/` — 上下文构建
- `kb/` — 知识库
- `embedding/` — 向量嵌入
- `memory/` — 记忆系统
- `governor.ts` — 治理器
- `utils/` — 通用工具

**保留在 CLI 端的部分**：
- `cli/` — CLI 交互层（commander 命令、stores、serve.ts）
- `bin/cli.mjs` — CLI 入口
- `execution/node-adapter.ts` — Node 环境适配器

**保留在 Tauri 端的部分**：
- `execution/tauri-adapter.ts` — Tauri 环境适配器

**保留在 Web 端的部分**：
- `execution/ws-adapter.ts` — WebSocket 适配器（连接 CLI serve）

### 3.3 后端能力重叠处理

**决策**：
- CLI `serve` 模式替代 `worldsmith-server`（Node.js HTTP/WS 服务）
- Tauri 端保留原 Rust 命令
- Web 端通过 HTTP/WS 连接 CLI serve 获取后端能力

**实施**：
- 将 `worldsmith-server/` 的能力（crawl/convert/vector-search/pty/terminal）迁移到 CLI serve
- `worldsmith-server/` 目录在迁移完成后删除
- Web 端 API 调用层从 `worldsmith-server` 切换到 CLI serve 的 HTTP/WS 端点

**理由**：
- CLI serve 已实现 HTTP + WS 双协议，且支持工具调用与流式推送
- 减少服务进程数量（原 worldsmith-server + CLI serve → 仅 CLI serve）
- CLI serve 与 CLI 工具共享同一套工具注册表，避免重复实现

### 3.4 前端入口清理范围

**决策**：清理以下 4 类入口：

1. **Agent 后端切换逻辑**：移除 `useAgent.ts` 的 `useAgentTs`/`useAgentRust` 路由，每端只保留单一后端实现
   - Web 端：仅 `useAgentTs`（通过 WS 连接 CLI serve）
   - Tauri 端：仅 `useAgentRust`（通过 Tauri invoke 调 Rust 命令）
   - CLI 端：直接使用 `packages/agent-runtime`，无 UI 层

2. **coreBackend 的 Tauri/WASM 检测分支**：
   - Web 端：仅 WASM 后端，移除 Tauri 分支
   - Tauri 端：仅 Tauri 后端，移除 WASM 回退
   - CLI 端：不使用 coreBackend（CLI 无 WASM 需求）

3. **Rust 后端相关 composables**（仅 Tauri 端使用）：
   - `useAgentRust.ts` / `useGoTRust.ts` / `useToTRust.ts` / `useRouterRust.ts`
   - `useSupervisorRust.ts` / `useMultiAgentRust.ts` / `useLoopControlRust.ts` / `useLongTaskRust.ts`
   - 这些文件从 Web 端移除，仅保留在 `apps/tauri/`

4. **worldsmith-server 相关 API**（仅 Web 端使用）：
   - `worldsmith-server` 的 API 调用从 Tauri/CLI 端移除
   - 迁移到 CLI serve 后，仅 Web 端保留 API 调用层

## 4. 整体路线

```
Phase 0: 调研与文档库搭建（当前）
  └─ 产出：docs/端分离/ 文档库

Phase 1: 共享代码层抽离
  └─ worldsmith-agent/src/ → packages/agent-runtime/
  └─ 三端 execution adapter 各归各位

Phase 2: 三端目录骨架建立
  └─ apps/web/、apps/cli/、apps/tauri/ 目录与 package.json
  └─ 共享 packages/ 链接

Phase 3: 前端入口分离与清理
  └─ src/ 拆分到三端
  └─ 后端切换逻辑、coreBackend 检测分支清理

Phase 4: 后端能力整合
  └─ worldsmith-server 能力迁移到 CLI serve
  └─ Web 端 API 调用层切换

Phase 5: 构建配置与 CI 独立
  └─ 三端独立 Vite/Tauri/tsc 构建配置
  └─ CI workflow 分端构建

Phase 6: 端到端验收与清理
  └─ 三端独立 dev/build 验证
  └─ 旧目录清理（worldsmith-server/、worldsmith-agent/ 残留）
```

详见 [08-migration-phases.md](./08-migration-phases.md)。

## 5. 文档维护规则

1. **每个 Phase 完成后**：在 `08-migration-phases.md` 对应章节填写完成日期、产物清单、遗留问题
2. **架构变更时**：同步更新 `02-target-architecture.md` 与 `03-shared-code-layer.md`
3. **新增风险点**：及时追加到 `09-risk-mitigation.md`
4. **决策变更**：在本文件 `第 3 节决策记录` 追加新决策，标注日期与原因
5. **进度同步**：`README.md` 的"当前进度"表格与 `08-migration-phases.md` 保持一致

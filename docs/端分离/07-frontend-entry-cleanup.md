# 07 - 前端关联入口移除计划

> Phase 3 核心文档：详细规划 `src/` 目录拆分与三端关联入口清理。

## 1. 清理目标与原则

### 目标
将当前被 Web + Tauri 共用的 `src/` 目录彻底拆分，使三端前端入口完全独立：
- **Web 端**：仅保留 WASM 后端路径，无 Tauri 分支、无 Rust composables
- **Tauri 端**：仅保留 Tauri invoke 后端路径，无 WASM 回退、无 worldsmith-server 引用
- **CLI 端**：前端无 UI（纯命令行），仅清理对 worldsmith-server 的引用

### 原则
1. **端编译期决定**：后端类型在构建期硬编码，移除运行时检测
2. **物理隔离**：Tauri 专用文件移入 `apps/tauri/src/`，Web 专用文件移入 `apps/web/src/`
3. **共享层上提**：端无关 composables/components 迁入 `packages/shared-ui` 与 `packages/shared-composables`
4. **渐进式清理**：按依赖顺序逐层清理，每层可独立验证

## 2. 清理范围总览（基于代码扫描实际结果）

### 2.1 import `@tauri-apps/api` 的 18 个文件

| 分类 | 文件路径 | 迁移目标 | 处理方式 |
|------|----------|----------|----------|
| **Rust composables** | `src/agent/composables/useAgentRust.ts` | `apps/tauri/src/agent/` | 整体迁移到 Tauri 端 |
| | `src/agent/composables/useGoTRust.ts` | `apps/tauri/src/agent/` | 整体迁移 |
| | `src/agent/composables/useToTRust.ts` | `apps/tauri/src/agent/` | 整体迁移 |
| | `src/agent/composables/useRouterRust.ts` | `apps/tauri/src/agent/` | 整体迁移 |
| | `src/agent/composables/useSupervisorRust.ts` | `apps/tauri/src/agent/` | 整体迁移 |
| | `src/agent/composables/useMultiAgentRust.ts` | `apps/tauri/src/agent/` | 整体迁移 |
| | `src/agent/composables/useLoopControlRust.ts` | `apps/tauri/src/agent/` | 整体迁移 |
| | `src/agent/composables/useLongTaskRust.ts` | `apps/tauri/src/agent/` | 整体迁移 |
| **核心后端** | `src/core/coreBackend.ts` | 三端各保留一份 | 拆分：Web 仅 WASM / Tauri 仅 invoke |
| **核心 FS** | `src/core/ProjectFS.ts` | `apps/tauri/src/core/` | Tauri 专用（Web 用浏览器 FS 抽象） |
| **终端** | `src/agent/TerminalPanel.vue` | `apps/tauri/src/agent/` | Tauri 专用（Web 端终端走 CLI serve WS） |
| | `src/agent/composables/useTerminal.ts` | `apps/tauri/src/agent/` | Tauri 专用 |
| **通用 composables** | `src/composables/useProjectSwitcher.ts` | 三端各一份 | 拆分：Tauri 走 invoke / Web 走浏览器 API |
| | `src/composables/useFsWatcher.ts` | `apps/tauri/src/composables/` | Tauri 专用 |
| **记忆归档** | `src/memory-archive/adapters/TauriFsOperations.ts` | `apps/tauri/src/memory-archive/` | Tauri 专用 |
| **插件 - 思维导图** | `src/plugins/official/mindmap/composables/useRustLayout.ts` | `apps/tauri/src/plugins/mindmap/` | Tauri 专用 |
| | `src/plugins/official/mindmap/composables/useRustGraphAnalysis.ts` | `apps/tauri/src/plugins/mindmap/` | Tauri 专用 |
| **插件 - 工作流** | `src/plugins/official/workflow/composables/useWorkflowEngineRun.ts` | `apps/tauri/src/plugins/workflow/` | Tauri 专用 |
| | `src/plugins/official/workflow/api/workflowApi.ts` | `apps/tauri/src/plugins/workflow/` | Tauri 专用 |

### 2.2 检测 `__TAURI__` 全局对象的 4 个文件

| 文件路径 | 清理方式 |
|----------|----------|
| `src/core/coreBackend.ts` | 移除 `detectBackend()` 函数，`getBackendType()` 改为端硬编码 |
| `src/plugins/official/mindmap/composables/useRustLayout.ts` | 迁移到 Tauri 端，移除检测分支 |
| `src/plugins/official/mindmap/composables/useRustGraphAnalysis.ts` | 迁移到 Tauri 端，移除检测分支 |
| `src/types/global.d.ts` | 拆分：Tauri 端保留 `__TAURI__` 声明，Web 端移除 |

### 2.3 引用 `worldsmith-server` / WS 连接的文件

| 文件路径 | 清理方式 |
|----------|----------|
| `src/agent/panels/TerminalPanel.vue` | Tauri 端移除 WS 回退分支；Web 端保留（连接 CLI serve） |
| `src/agent/composables/useTerminal.ts` | 同上 |

### 2.4 `getBackendType` / `detectBackend` 调用点

| 文件路径 | 清理方式 |
|----------|----------|
| `src/main.ts` | 移除启动时的后端检测逻辑，端入口直接初始化对应后端 |
| `src/core/coreBackend.ts` | 核心改造（见第 4 节） |

## 3. `src/` 目录拆分策略

### 3.1 三端共享层（迁入 packages/）

以下文件端无关，迁入共享包：

```
src/agent/composables/
  ├── useAgent.ts          → packages/shared-composables/src/（改造为接收 backend 注入）
  ├── useOrchestrator.ts   → packages/shared-composables/src/
  ├── useGroupChat.ts      → packages/shared-composables/src/
  ├── useSkillsStore.ts    → packages/shared-composables/src/
  ├── useMcpConnections.ts → packages/shared-composables/src/
  ├── useAgentEvents.ts    → packages/shared-composables/src/
  ├── useAgentCommands.ts  → packages/shared-composables/src/
  ├── usePlanStore.ts      → packages/shared-composables/src/
  ├── useTitleGen.ts       → packages/shared-composables/src/
  ├── useGenerationProgress.ts → packages/shared-composables/src/
  ├── useMessageSpeaker.ts → packages/shared-composables/src/
  ├── usePanelDrag.ts      → packages/shared-composables/src/
  ├── useEntityMiniPanel.ts → packages/shared-composables/src/
  ├── useEntityMentionIndex.ts → packages/shared-composables/src/
  ├── useManuscriptAnimation.ts → packages/shared-composables/src/
  ├── useCliAgent.ts       → packages/shared-composables/src/（端无关，backend 注入）
  ├── useLongTask.ts       → packages/shared-composables/src/
  └── longTaskStore.ts     → packages/shared-composables/src/
```

### 3.2 Tauri 专用层（迁入 apps/tauri/src/）

```
src/agent/composables/
  ├── useAgentRust.ts         → apps/tauri/src/agent/
  ├── useGoTRust.ts           → apps/tauri/src/agent/
  ├── useToTRust.ts           → apps/tauri/src/agent/
  ├── useRouterRust.ts        → apps/tauri/src/agent/
  ├── useSupervisorRust.ts    → apps/tauri/src/agent/
  ├── useMultiAgentRust.ts    → apps/tauri/src/agent/
  ├── useLoopControlRust.ts   → apps/tauri/src/agent/
  └── useLongTaskRust.ts      → apps/tauri/src/agent/

src/core/
  ├── ProjectFS.ts            → apps/tauri/src/core/
  └── coreBackend.ts (Tauri 分支) → apps/tauri/src/core/coreBackend.ts

src/composables/
  ├── useFsWatcher.ts         → apps/tauri/src/composables/
  └── useProjectSwitcher.ts (Tauri 分支) → apps/tauri/src/composables/

src/memory-archive/adapters/
  └── TauriFsOperations.ts    → apps/tauri/src/memory-archive/

src/plugins/official/mindmap/composables/
  ├── useRustLayout.ts        → apps/tauri/src/plugins/mindmap/
  └── useRustGraphAnalysis.ts → apps/tauri/src/plugins/mindmap/

src/plugins/official/workflow/
  ├── composables/useWorkflowEngineRun.ts → apps/tauri/src/plugins/workflow/
  └── api/workflowApi.ts                  → apps/tauri/src/plugins/workflow/

src/agent/
  ├── TerminalPanel.vue (Tauri 分支) → apps/tauri/src/agent/
  └── composables/useTerminal.ts (Tauri 分支) → apps/tauri/src/agent/
```

### 3.3 Web 专用层（迁入 apps/web/src/）

```
src/core/
  ├── coreBackend.ts (WASM 分支) → apps/web/src/core/coreBackend.ts
  ├── worldsmithCore.ts          → apps/web/src/core/
  └── wasmWorkerPool.ts          → apps/web/src/core/

src/agent/
  ├── TerminalPanel.vue (Web 分支，连 CLI serve) → apps/web/src/agent/
  └── composables/useTerminal.ts (Web 分支) → apps/web/src/agent/

src/composables/
  └── useProjectSwitcher.ts (Web 分支) → apps/web/src/composables/
```

## 4. 后端切换逻辑清理（核心改造）

### 4.1 `coreBackend.ts` 改造

**现状**（`src/core/coreBackend.ts`）：
- `detectBackend()` 运行时检测 `__TAURI_INTERNALS__` / `__TAURI__` / WASM 测试键
- `backendCall()` 根据 `detectBackend()` 结果在 Tauri invoke 与 WASM 间切换
- `algoCall()` 同样双路径 + Worker 池

**改造后 - Web 端**（`apps/web/src/core/coreBackend.ts`）：
```typescript
// 移除 detectBackend()、tauriInvoke、tauriCall、backendCall 双路径
// 仅保留 WASM 路径

import { getCore } from './worldsmithCore'
import { callViaWorker, isHeavyMethod } from './wasmWorkerPool'

let _corePromise: Promise<unknown> | null = null
async function getCoreCached() {
  if (!_corePromise) _corePromise = getCore()
  return _corePromise
}

export function getBackendType(): 'wasm' {
  return 'wasm'  // 硬编码
}

export async function validateEntity(entityJson: string, schemaJson?: string) {
  const core = await getCoreCached()
  return core!.validateEntity(entityJson, schemaJson)
}
// ... 所有函数仅走 WASM，无 Tauri 分支
```

**改造后 - Tauri 端**（`apps/tauri/src/core/coreBackend.ts`）：
```typescript
// 移除 detectBackend()、WASM 路径、wasmWorkerPool
// 仅保留 Tauri invoke 路径

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
let tauriInvoke: InvokeFn | null = null
async function getTauriInvoke(): Promise<InvokeFn> {
  if (!tauriInvoke) {
    const mod = await import('@tauri-apps/api/core')
    tauriInvoke = mod.invoke
  }
  return tauriInvoke
}

export function getBackendType(): 'tauri' {
  return 'tauri'  // 硬编码
}

export async function validateEntity(entityJson: string, schemaJson?: string) {
  const invoke = await getTauriInvoke()
  return invoke('cmd_validate_entity', { entityJson, schemaJson: schemaJson ?? null })
}
// ... 所有函数仅走 invoke，无 WASM 回退
```

**Tauri-only 函数处理**：
- `checkStorageHealth()`、`validatePluginManifest()`、`checkPluginHealth()` 等 Tauri-only 函数：Web 端直接返回 `null`（或不导出），Tauri 端保留实现

### 4.2 `useAgent.ts` 改造

**现状**：`useAgent.ts` 内部根据 `getBackendType()` 在 TS 后端与 Rust 后端间路由。

**改造后**（`packages/shared-composables/src/useAgent.ts`）：
```typescript
import type { IAgentBackend } from '@worldsmith/agent-runtime'

export interface UseAgentOptions {
  backend: IAgentBackend  // 端入口注入
  sessionId?: string
  chatMode?: ChatMode
}

export function useAgent(options: UseAgentOptions) {
  const backend = options.backend  // 端无关逻辑
  const messages = ref<AgentMessage[]>([])
  const isStreaming = ref(false)

  async function sendMessage(text: string) {
    await backend.prompt(text, { chatMode: chatMode.value })
  }
  // ... 移除所有 getBackendType() 分支
}
```

**端入口注入**：
- Web 端 `apps/web/src/main.ts`：`useAgent({ backend: new WsAgentBackend() })`
- Tauri 端 `apps/tauri/src/main.ts`：`useAgent({ backend: new RustAgentBackend() })`

### 4.3 `main.ts` 改造

**现状**（`src/main.ts`）：
- 调用 `getBackendType()` 检测后端
- 根据检测结果初始化不同后端

**改造后 - Web 端**（`apps/web/src/main.ts`）：
```typescript
// 移除 getBackendType 检测
import { WsAgentBackend } from './agent/WsAgentBackend'
const backend = new WsAgentBackend()
// 直接初始化 WASM 后端
```

**改造后 - Tauri 端**（`apps/tauri/src/main.ts`）：
```typescript
// 移除 getBackendType 检测
import { RustAgentBackend } from './agent/RustAgentBackend'
const backend = new RustAgentBackend()
// 直接初始化 Tauri 后端
```

## 5. Tauri 专用 Rust composables 迁移

### 5.1 迁移清单（8 个文件）

| 文件 | 职责 | 迁移注意 |
|------|------|----------|
| `useAgentRust.ts` | Agent Rust 后端适配 | Tauri 端核心，保留完整实现 |
| `useGoTRust.ts` | Graph of Thought Rust 调用 | 迁移后更新 import 路径 |
| `useToTRust.ts` | Tree of Thought Rust 调用 | 同上 |
| `useRouterRust.ts` | Router 模式 Rust 调用 | 同上 |
| `useSupervisorRust.ts` | Supervisor 模式 Rust 调用 | 同上 |
| `useMultiAgentRust.ts` | 多 Agent Rust 调用 | 同上 |
| `useLoopControlRust.ts` | 循环控制 Rust 调用 | 同上 |
| `useLongTaskRust.ts` | 长任务 Rust 调用 | 同上 |

### 5.2 迁移后引用更新

这些 composables 被以下位置引用，迁移后需更新 import：
- `src/agent/AgentChat.vue` 及子组件
- `src/agent/panels/*.vue`

**策略**：
1. 迁移文件到 `apps/tauri/src/agent/composables/`
2. 在 `packages/shared-composables` 中定义接口（`IRustAgentComposable`）
3. Tauri 端入口 provide 具体实现，共享组件通过 inject 调用

## 6. `__TAURI__` 检测分支清理

### 6.1 `src/types/global.d.ts` 拆分

**现状**：声明 `__TAURI_INTERNALS__` / `__TAURI__` 全局变量。

**改造**：
- `apps/tauri/src/types/global.d.ts`：保留 `__TAURI__` 声明
- `apps/web/src/types/global.d.ts`：移除 `__TAURI__` 声明

### 6.2 思维导图插件清理

`useRustLayout.ts` 与 `useRustGraphAnalysis.ts` 中的 `__TAURI__` 检测分支：
- 迁移到 Tauri 端后，移除检测，直接走 Tauri invoke
- Web 端思维导图使用 JS 布局算法（d3-force 等）替代

## 7. worldsmith-server 相关引用清理

### 7.1 Web 端保留（连接 CLI serve）

`TerminalPanel.vue` 与 `useTerminal.ts` 在 Web 端保留 WS 连接逻辑，但：
- 移除 `ws://localhost:3100` 硬编码，改为从环境变量/配置读取
- 连接目标改为 CLI serve 模式（`worldsmith serve`）

### 7.2 Tauri 端移除

Tauri 端的 `TerminalPanel.vue` 与 `useTerminal.ts`：
- 移除 WS 连接分支
- 仅保留 Tauri PTY invoke 路径

### 7.3 CLI 端清理

CLI 端无前端 UI，但需清理：
- `worldsmith-agent/` 中对 `worldsmith-server` 的引用（如有）
- 确保 CLI serve 模式独立运行，不依赖 worldsmith-server 包

## 8. 插件层清理

### 8.1 思维导图插件（mindmap）

| 文件 | Web 端 | Tauri 端 |
|------|--------|----------|
| `useRustLayout.ts` | 移除，用 JS 布局 | 迁移，移除检测分支 |
| `useRustGraphAnalysis.ts` | 移除，用 JS 图分析 | 迁移，移除检测分支 |
| 其他 composables | 共享层 | 共享层 |

### 8.2 工作流插件（workflow）

| 文件 | Web 端 | Tauri 端 |
|------|--------|----------|
| `useWorkflowEngineRun.ts` | 移除 Rust 调用，走 CLI serve | 迁移，保留 Rust 调用 |
| `workflowApi.ts` | 移除 Rust 调用，走 CLI serve | 迁移，保留 Rust 调用 |

## 9. 清理顺序与依赖

```
Step 1: 建立三端目录骨架（apps/web, apps/cli, apps/tauri）
  ↓
Step 2: 抽离共享层到 packages/shared-composables, packages/shared-ui
  ↓
Step 3: 迁移 Tauri 专用文件到 apps/tauri/src/（8 个 Rust composables + ProjectFS + FsWatcher 等）
  ↓
Step 4: 迁移 Web 专用文件到 apps/web/src/（coreBackend WASM 分支 + worldsmithCore + wasmWorkerPool）
  ↓
Step 5: 改造 coreBackend.ts（三端各保留单路径版本）
  ↓
Step 6: 改造 useAgent.ts（接收 backend 注入，移除路由层）
  ↓
Step 7: 改造 main.ts（端入口硬编码后端）
  ↓
Step 8: 清理 __TAURI__ 检测与 global.d.ts
  ↓
Step 9: 清理插件层（mindmap Rust composables、workflow Rust API）
  ↓
Step 10: 清理 worldsmith-server 引用（Tauri 移除、Web 改连 CLI serve）
  ↓
Step 11: 更新三端 Vite/tsconfig 配置，移除跨端 alias
  ↓
Step 12: 删除原 src/ 目录（确认无引用后）
```

## 10. 验证点

每个 Step 完成后的验证标准：

| Step | 验证方式 |
|------|----------|
| 1-2 | `packages/shared-composables` 可独立 `tsc --noEmit` 通过 |
| 3-4 | `apps/tauri/src` 与 `apps/web/src` 可独立 `vite build` 通过 |
| 5 | `grep -r "detectBackend" apps/` 返回空 |
| 6 | `grep -r "getBackendType" apps/` 仅出现在端入口 main.ts |
| 7 | 三端 `npm run dev` 可独立启动 |
| 8 | `grep -r "__TAURI__" apps/web/` 返回空 |
| 9 | 思维导图/工作流插件在三端可独立加载 |
| 10 | `grep -r "worldsmith-server" apps/tauri/` 返回空 |
| 11 | 三端 `npm run build` 产物互相独立 |
| 12 | 原 `src/` 目录已删除，无残留引用 |

## 11. 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 共享 composables 注入改造不彻底 | 三端运行时崩溃 | 先写接口定义，逐个 composable 改造并测试 |
| 插件层 Rust 调用遗漏 | Tauri 端功能缺失 | 全量 grep `invoke(` 确认覆盖 |
| Web 端 WASM 回退被误删 | Web 端功能失效 | 保留 WASM 路径，仅删 Tauri 分支 |
| import 路径更新遗漏 | 编译失败 | 每步完成后 `tsc --noEmit` 验证 |
| `useAgent.ts` 调用点过多 | 改造工作量爆炸 | 用 provide/inject 模式，调用点无需改 |

## 12. Phase 3 执行进度

### Batch 1: 第一层端无关 composables 迁移（已完成）

迁移 4 个无端依赖的 composables 到 `packages/shared-composables/`：
- `useAgentCommands.ts` — re-export 兼容
- `usePlanStore.ts` — re-export 兼容
- `useGenerationProgress.ts` — re-export 兼容
- `useCliAgent.ts` — re-export 兼容

### Batch 2: 第二层有端依赖 composables 迁移（已完成）

迁移 5 个有端依赖的 composables，通过依赖注入解耦：
- `useAgent.ts` — 改造为 `AGENT_BACKEND_INJECTION_KEY` 注入模式；原位置保留 Tauri 端实现（`useAgentRustAdapter`）
- `useOrchestrator.ts` — 精确 re-export（4 个符号）
- `useTitleGen.ts` — 精确 re-export（4 个符号）
- `useSkillsStore.ts` — 精确 re-export（2 个符号）
- `useMcpConnections.ts` — 包装层：注入 `useAgent()` 给 shared 版本

### Batch 3: 第三层 composables 迁移（已完成）

迁移 4 个 composables：
- `useAgentEvents.ts` — 端无关直接迁移；从 `useAgent.ts` 导入 `ToolCallView` 类型避免重复定义
- `useManuscriptAnimation.ts` — 端无关直接迁移
- `useEntityMentionIndex.ts` — 端无关直接迁移
- `useMessageSpeaker.ts` — 改造为依赖注入模式（`SpeakerContext` + `provideMessageSpeakerContext`）；原位置保留旧实现保证向后兼容，待 Phase 4 端入口接入注入后切换

### Batch 4: 最终清理 + 验证（已完成）

**4-1 迁移完整性确认**：
- 14 个 composables 已迁移为 re-export（7 个 `export *` + 6 个精确导出 + 2 个特殊包装层）
- 12 个保留原实现（均为 Tauri 端特定 `*Rust` 文件 + `useGroupChat` / `useTerminal` / `useMessageSpeaker`，待 Phase 4 处理）

**4-2 re-export 兼容层验证**：全部完整，有清晰的文档注释说明迁移状态

**4-3 潜在问题处理**：
- 添加 `@agent/{context,group-chat,session,execution}/*` 精确 paths 映射（tsconfig.app.json），修复 16 个路径解析错误
- 修复 `useAgentRust.ts` 的 11 个 `A2UIMessage` 类型错误：`if (message.xxx)` 改为 `if ('xxx' in message)` 做 discriminated union 类型收窄
- 添加 `@worldsmith/shared-composables/{agent,long-task,entity,ui}/*` 精确 paths 映射，修复 `longTaskStore` 路径解析

**4-4 最终类型检查**：
- `packages/shared-composables`：**0 错误**
- `src/agent/composables/`：**0 错误**
- 项目全局：156 个预先存在错误（分布在 33 个不相关文件中，与端分离工作无关）

### Batch 4 复查补丁（潜在问题二次处理）

**复查发现 3 个潜在问题，已全部处理**：

#### 补丁 1：迁移遗漏 — useLongTask.ts（重大）

**问题**：文档第 3.1 节明确列出 `useLongTask.ts → packages/shared-composables/src/`，但实际仅迁移了 `longTaskStore.ts`，`useLongTask.ts` 仍是 343 行完整旧实现（仅通过 `./longTaskStore` re-export 间接依赖 shared 层）。

**修复**：
- 新建 `packages/shared-composables/src/agent/long-task/useLongTask.ts`（完整迁移，端无关，仅依赖 vue + longTaskStore）
- 更新 `packages/shared-composables/src/agent/long-task/index.ts` 导出 useLongTask
- `src/agent/composables/useLongTask.ts` 改为 re-export：`export { useLongTask } from '@worldsmith/shared-composables/long-task/useLongTask'`

**验证**：useLongTask 端无关（无 Tauri/Web 特定依赖），迁移后无类型错误。

#### 补丁 2：package.json exports 缺失（中等）

**问题**：Batch 3 迁移的 4 个 composables（useAgentEvents/useManuscriptAnimation/useEntityMentionIndex/useMessageSpeaker）未在 `packages/shared-composables/package.json` 的 `exports` 字段声明子路径。虽然 TypeScript path mapping 绕过了编译期解析，但 Node.js ESM 运行时解析会失败。

**修复**：在 `exports` 中补充 4 条子路径映射：
- `./agent/useAgentEvents`
- `./agent/useManuscriptAnimation`
- `./agent/useEntityMentionIndex`
- `./agent/useMessageSpeaker`
- 同时补充 `./long-task/useLongTask`（补丁 1 新增）

#### 补丁 3：useMessageSpeaker 双版本过渡状态明确记录（文档）

**问题**：useMessageSpeaker 存在两个版本：
- `packages/shared-composables/src/agent/useMessageSpeaker.ts` — **新版本**，依赖注入模式（`SpeakerContext` + `provideMessageSpeakerContext`）
- `src/agent/composables/useMessageSpeaker.ts` — **旧版本**，直接依赖 `useSpaceStore` / `useUserProfileStore` / `usePersonaFontStore`

**当前调用点**：`src/agent/bubbles/NormalMessageBubble.vue` 仍通过相对路径导入旧版本。

**设计意图**：这是 Phase 3 → Phase 4 的过渡状态，**故意的双轨设计**：
- Phase 3 完成共享层注入式实现，但不动调用点
- Phase 4 在 Tauri 端入口（`apps/tauri/src/main.ts`）调用 `provideMessageSpeakerContext(...)` 注入具体实现后，将 NormalMessageBubble.vue 的 import 切换到 shared 版本

**风险记录**：在 Phase 4 完成切换前，shared 版本的 useMessageSpeaker 处于"已实现但未使用"状态，任何对它的修改都不会立即影响运行时行为。需在 Phase 4 切换时同步验证。

### Phase 3 总结

| 指标 | 数值 |
|------|------|
| 迁移到 shared-composables 的 composables | 15 个（含补丁 1 的 useLongTask） |
| 保留原实现的 Tauri 端特定 composables | 12 个（useAgent 入口 + 8 个 *Rust + useGroupChat + useTerminal + useMessageSpeaker 旧版） |
| 修复的预先存在类型错误 | 27 个（16 路径 + 11 A2UI 类型） |
| 复查补丁修复数 | 3 个（1 迁移遗漏 + 1 exports 缺失 + 1 文档记录） |
| shared-composables 包错误数 | 0 |
| src/agent/composables/ 错误数 | 0 |

### Phase 3 → Phase 4 切换清单

Phase 4 启动时需优先处理：
1. **useMessageSpeaker 切换**：在 Tauri 端入口注入 `SpeakerContext`，将 `NormalMessageBubble.vue` 的 import 切换到 shared 版本，删除 `src/agent/composables/useMessageSpeaker.ts` 旧实现
2. **12 个 Tauri 端特定 composables 迁移**：`useAgent` 入口 + 8 个 `*Rust.ts` + `useGroupChat` + `useTerminal` 迁移到 `apps/tauri/src/agent/`
3. **re-export 层清理**：Phase 4 完成端入口接入后，逐步删除 `src/agent/composables/` 下的 re-export 文件

**下一步**：Phase 4（三端目录骨架建立）— 将 12 个 Tauri 端特定 composables 迁移到 `apps/tauri/src/agent/`，并完成 `useMessageSpeaker` 的端入口注入切换。

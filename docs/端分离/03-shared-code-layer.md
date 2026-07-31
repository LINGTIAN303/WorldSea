# 03 - 共享代码层规划

> 本文档详细规划 `packages/agent-runtime`、`packages/shared-ui`、`packages/shared-composables` 三个新增共享包的抽离方案与 API 契约。

## 1. packages/agent-runtime（核心运行时）

### 1.1 抽离范围

**源路径**：`worldsmith-agent/src/`
**目标路径**：`packages/agent-runtime/src/`

| 源文件/目录 | 目标路径 | 是否端无关 | 说明 |
|-------------|----------|-----------|------|
| `agent.ts` | `src/agent.ts` | ✅ | Agent 主循环，无端依赖 |
| `bridge.ts` | `src/bridge.ts` | ✅ | 桥接层，调用 ExecutionAdapter |
| `bridge-types.ts` | `src/bridge-types.ts` | ✅ | 桥接类型 |
| `index.ts` | `src/index.ts` | ✅ | 包入口 |
| `governor.ts` | `src/governor.ts` | ✅ | 治理器 |
| `vite-env.d.ts` | `src/vite-env.d.ts` | ⚠️ | 移除 vite 引用，改为通用 |
| `tools/` | `src/tools/` | ✅ | 工具定义 |
| `skills/` | `src/skills/` | ✅ | 技能定义 |
| `session/` | `src/session/` | ✅ | 会话管理 |
| `orchestrator/` | `src/orchestrator/` | ✅ | 多 Agent 编排 |
| `toolbus/` | `src/toolbus/` | ✅ | 工具总线 |
| `providers/` | `src/providers/` | ✅ | LLM 供应商配置 |
| `context/` | `src/context/` | ✅ | 上下文构建 |
| `kb/` | `src/kb/` | ✅ | 知识库 |
| `embedding/` | `src/embedding/` | ✅ | 向量嵌入 |
| `group-chat/` | `src/group-chat/` | ✅ | 群聊 |
| `mcp/` | `src/mcp/` | ✅ | MCP |
| `stores/` | `src/stores/` | ✅ | 图像/视频持久化 |
| `utils/` | `src/utils/` | ✅ | 通用工具 |
| `execution/adapter.ts` | `src/execution/adapter.ts` | ✅ | ExecutionAdapter 接口 |
| `execution/env.ts` | `src/execution/env.ts` | ✅ | 环境检测 |
| `execution/index.ts` | `src/execution/index.ts` | ✅ | 工厂函数（不含具体 adapter） |
| `execution/node-adapter.ts` | → `apps/cli/src/execution/` | ❌ | Node 专属 |
| `execution/tauri-adapter.ts` | → `apps/tauri/src/execution/` | ❌ | Tauri 专属 |
| `execution/ws-adapter.ts` | → `apps/web/src/execution/` | ❌ | Web 专属 |
| `cli/` | → `apps/cli/src/` | ❌ | CLI 专属 |
| `bin/cli.mjs` | → `apps/cli/src/bin/` | ❌ | CLI 入口 |

### 1.2 package.json

```json
{
  "name": "@worldsmith/agent-runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  },
  "dependencies": {
    "@worldsmith/agent-core": "workspace:*",
    "@worldsmith/governor-core": "workspace:*",
    "dexie": "^4.4.2"
  },
  "peerDependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.0",
    "typescript": "~6.0.2"
  }
}
```

### 1.3 API 契约

#### 1.3.1 包入口（src/index.ts）

```typescript
// ═══ Agent 核心 ═══
export { createAgent, AgentLoop, AgentLoopConfig } from './agent'
export { bridge, createBridge, Bridge } from './bridge'
export type {
  IAgentBackend,
  AgentEvent,
  AgentMessage,
  ChatMode,
  PromptOptions,
  // ... 所有 bridge-types 导出
} from './bridge-types'

// ═══ 工具系统 ═══
export { ALL_TOOLS, registerAllTools } from './tools'
export { ToolDefinition, ToolContext, ToolResult } from './tools/types'
export { getToolMeta, initToolMetaRegistry } from './tools/tool-meta-registry'

// ═══ 技能系统 ═══
export { SkillRegistry, SkillDeclaration, SkillMeta } from './skills/registry'
export { loadSkills } from './skills/loader'
export { parseSkill } from './skills/parser'

// ═══ 工具总线 ═══
export { ToolBus, DefaultToolBus } from './toolbus/toolbus'
export { InternalChainRegistry } from './toolbus/internal-registry'

// ═══ 会话管理 ═══
export { SessionManager } from './session/manager'
export type { Session, SessionState } from './session/types'

// ═══ 编排 ═══
export { Orchestrator } from './orchestrator'

// ═══ Execution Adapter 接口 ═══
export type {
  ExecutionAdapter,
  ExecOptions,
  ExecResult,
  PtyOptions,
  ShellInfo,
  ShellSessionInfo,
  ShellExecResult,
} from './execution/adapter'
export { isNodeEnv, isTauri, isBrowser } from './execution/env'
export { createExecutionAdapter } from './execution'

// ═══ 其他 ═══
export { Governor } from './governor'
export { ProviderRegistry, resolveProvider } from './providers'
export { ContextBuilder } from './context'
export { KnowledgeBase } from './kb'
export { EmbeddingService } from './embedding'
export { GroupChatEngine } from './group-chat'
export { McpManager } from './mcp'
```

#### 1.3.2 ExecutionAdapter 工厂函数（端注入）

```typescript
// packages/agent-runtime/src/execution/index.ts
import type { ExecutionAdapter } from './adapter'

export interface ExecutionAdapterFactory {
  createNodeAdapter?: () => ExecutionAdapter
  createTauriAdapter?: () => ExecutionAdapter
  createWsAdapter?: (config: { url: string; reconnect?: boolean }) => ExecutionAdapter
}

let factory: ExecutionAdapterFactory | null = null

/**
 * 注册端特定的 ExecutionAdapter 工厂
 * 由各端在启动时调用一次
 */
export function registerExecutionAdapterFactory(f: ExecutionAdapterFactory): void {
  factory = f
}

/**
 * 创建执行适配器（端无关入口）
 * 优先级由注册的工厂决定
 */
export async function createExecutionAdapter(): Promise<ExecutionAdapter> {
  if (!factory) {
    throw new Error('ExecutionAdapter factory not registered. Call registerExecutionAdapterFactory first.')
  }
  if (isNodeEnv() && factory.createNodeAdapter) {
    return factory.createNodeAdapter()
  }
  if (isTauri() && factory.createTauriAdapter) {
    return factory.createTauriAdapter()
  }
  if (isBrowser() && factory.createWsAdapter) {
    return factory.createWsAdapter({ url: getWsUrl(), reconnect: true })
  }
  throw new Error('No suitable ExecutionAdapter for current environment')
}
```

#### 1.3.3 端注册示例

```typescript
// apps/cli/src/bootstrap.ts
import { registerExecutionAdapterFactory } from '@worldsmith/agent-runtime'
import { NodeExecutionAdapter } from './execution/node-adapter'

registerExecutionAdapterFactory({
  createNodeAdapter: () => new NodeExecutionAdapter(),
})
```

```typescript
// apps/web/src/bootstrap.ts
import { registerExecutionAdapterFactory } from '@worldsmith/agent-runtime'
import { WebSocketExecutionAdapter } from './execution/ws-adapter'

registerExecutionAdapterFactory({
  createWsAdapter: (config) => new WebSocketExecutionAdapter(config),
})
```

```typescript
// apps/tauri/src/bootstrap.ts
import { registerExecutionAdapterFactory } from '@worldsmith/agent-runtime'
import { TauriExecutionAdapter } from './execution/tauri-adapter'

registerExecutionAdapterFactory({
  createTauriAdapter: () => new TauriExecutionAdapter(),
})
```

### 1.4 端无关性验证规则

`packages/agent-runtime` 中的代码**禁止**：
- `import @tauri-apps/api` 或任何 Tauri 模块
- `import vue` 或任何 Vue 相关模块
- 直接访问 `window.__TAURI__` / `window.__TAURI_INTERNALS__`
- 直接 `import('node:child_process')` 等 Node 内置模块（通过 ExecutionAdapter 抽象）
- 直接 `import('ws')` WebSocket 库（通过 ws-adapter 由 Web 端注入）

允许：
- 类型导入（`import type { ... } from 'ws'`）
- 环境检测（`isNodeEnv()` / `isTauri()` / `isBrowser()`，仅检测不调用端 API）
- 通过依赖注入接收端实现

### 1.5 测试策略

- **单元测试**：保留 `worldsmith-agent/src/__tests__/` 与各模块的 `__tests__/`，迁到 `packages/agent-runtime/src/__tests__/`
- **集成测试**：保留 `pipeline-integration.spec.ts` 等，使用 mock ExecutionAdapter
- **端无关性验证**：CI 增加 lint 规则，禁止 `packages/agent-runtime/` 中出现端特定 import

## 2. packages/shared-ui（共享 UI 组件）

### 2.1 抽离范围

**源路径**：`src/`（前端共用部分）
**目标路径**：`packages/shared-ui/src/`

| 源路径 | 目标路径 | 说明 |
|--------|----------|------|
| `src/agent/` | `packages/shared-ui/src/agent/` | Agent UI 组件 |
| `src/space/` | `packages/shared-ui/src/space/` | Space UI 组件 |
| `src/ui/` | `packages/shared-ui/src/ui/` | Ws* 基础组件 |
| `src/plugins/` | `packages/shared-ui/src/plugins/` | 插件 UI |
| `src/stores/` | `packages/shared-ui/src/stores/` | 共享 Pinia stores |
| `src/design-tokens/` | `packages/shared-ui/src/design-tokens/` | 设计令牌 |
| `src/assets/` | `packages/shared-ui/src/assets/` | 共享资源 |
| `src/modules/` | `packages/shared-ui/src/modules/` | 模块系统 |
| `src/governor/` | `packages/shared-ui/src/governor/` | 治理器 UI 适配 |

**不抽离**（留在各端）：
- `src/main.ts` → 各端专属入口
- `src/App.vue` → 各端专属根组件
- `src/core/coreBackend.ts` → 各端专属（Web 用 WASM，Tauri 用 invoke）
- `src/core/ProjectFS.ts` → Tauri 专属
- `src/agent/composables/useAgentRust.ts` 等 → Tauri 专属
- `src/composables/useProjectSwitcher.ts` 等 → Tauri 专属

### 2.2 package.json

```json
{
  "name": "@worldsmith/shared-ui",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "vue-tsc --noEmit",
    "build": "vite build"
  },
  "peerDependencies": {
    "vue": "^3.5.32",
    "pinia": "^3.0.4",
    "naive-ui": "^2.44.1"
  },
  "dependencies": {
    "@worldsmith/entity-core": "workspace:*",
    "@worldsmith/canvas-engine": "workspace:*",
    "@worldsmith/ui-kit": "workspace:*",
    "@worldsmith/theme-kit": "workspace:*",
    "@worldsmith/font-kit": "workspace:*",
    "@worldsmith/plugin-sdk": "workspace:*",
    "@worldsmith/agent-runtime": "workspace:*",
    "@worldsmith/shared-composables": "workspace:*"
  }
}
```

### 2.3 依赖注入模式

shared-ui 中的组件**不直接 import** 端特定后端，通过 provide/inject 获取：

```typescript
// packages/shared-ui/src/agent/injectionKeys.ts
import type { InjectionKey, Ref } from 'vue'
import type { IAgentBackend } from '@worldsmith/agent-runtime'

export const AgentBackendKey: InjectionKey<IAgentBackend> = Symbol('agent-backend')
export const CoreBackendKey: InjectionKey<{
  validateEntity: typeof import('./coreBackend').validateEntity
  // ...
}> = Symbol('core-backend')

export const FileSystemKey: InjectionKey<{
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
}> = Symbol('file-system')
```

```typescript
// apps/web/src/main.ts
import { AgentBackendKey, CoreBackendKey } from '@worldsmith/shared-ui'
import { WsAgentBackend } from './agent/WsAgentBackend'
import * as coreBackend from './core/coreBackend'

app.provide(AgentBackendKey, new WsAgentBackend())
app.provide(CoreBackendKey, coreBackend)
```

```typescript
// apps/tauri/src/main.ts
import { AgentBackendKey, CoreBackendKey } from '@worldsmith/shared-ui'
import { RustAgentBackend } from './agent/RustAgentBackend'
import * as coreBackend from './core/coreBackend'

app.provide(AgentBackendKey, new RustAgentBackend())
app.provide(CoreBackendKey, coreBackend)
```

## 3. packages/shared-composables（共享 composables）

### 3.1 抽离范围

**源路径**：`src/composables/` 与 `src/agent/composables/` 中的端无关部分
**目标路径**：`packages/shared-composables/src/`

| 源文件 | 目标路径 | 是否端无关 | 说明 |
|--------|----------|-----------|------|
| `src/composables/useEventBus.ts` | `src/useEventBus.ts` | ✅ | 事件总线 |
| `src/composables/useTheme.ts` | `src/useTheme.ts` | ✅ | 主题 |
| `src/composables/useToast.ts` | `src/useToast.ts` | ✅ | Toast |
| `src/composables/useAutoBackup.ts` | `src/useAutoBackup.ts` | ✅ | 自动备份 |
| `src/composables/useFocusTrap.ts` | `src/useFocusTrap.ts` | ✅ | 焦点陷阱 |
| `src/composables/useFloatingPanel.ts` | `src/useFloatingPanel.ts` | ✅ | 浮动面板 |
| `src/composables/useTextSelection.ts` | `src/useTextSelection.ts` | ✅ | 文本选择 |
| `src/composables/useGlobalEvents.ts` | `src/useGlobalEvents.ts` | ✅ | 全局事件 |
| `src/composables/avatarStore.ts` | `src/avatarStore.ts` | ✅ | 头像 |
| `src/composables/companionModeScene.ts` | `src/companionModeScene.ts` | ✅ | 伴侣模式场景 |
| `src/composables/companionModeTrigger.ts` | `src/companionModeTrigger.ts` | ✅ | 伴侣模式触发 |
| `src/composables/useCompanionMode.ts` | `src/useCompanionMode.ts` | ✅ | 伴侣模式 |
| `src/composables/useAvatarImage.ts` | `src/useAvatarImage.ts` | ✅ | 头像图像 |
| `src/composables/useAgentPluginBridge.ts` | `src/useAgentPluginBridge.ts` | ✅ | Agent 插件桥接 |
| `src/composables/useSmartFillChat.ts` | `src/useSmartFillChat.ts` | ✅ | 智能填充 |
| `src/composables/fontInstaller.ts` | `src/fontInstaller.ts` | ⚠️ | 字体安装（需端注入 FS） |
| `src/composables/useFontBootstrap.ts` | `src/useFontBootstrap.ts` | ⚠️ | 字体引导 |
| `src/composables/useFontPresets.ts` | `src/useFontPresets.ts` | ⚠️ | 字体预设 |
| `src/composables/fontSpanParser.ts` | `src/fontSpanParser.ts` | ✅ | 字体跨度解析 |
| `src/composables/useFileExtract.ts` | `src/useFileExtract.ts` | ⚠️ | 文件提取（需端注入 FS） |
| `src/composables/useFileSystemProject.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/composables/useProjectSwitcher.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/composables/useFsWatcher.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useAgent.ts` | `src/useAgent.ts` | ⚠️ | 改为依赖注入 |
| `src/agent/composables/useAgentRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useAgentEvents.ts` | `src/useAgentEvents.ts` | ✅ | Agent 事件 |
| `src/agent/composables/useAgentRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useCliAgent.ts` | → `apps/web/` | ❌ | Web 专属（连 CLI serve） |
| `src/agent/composables/useGoTRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useToTRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useRouterRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useSupervisorRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useMultiAgentRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useLoopControlRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useLongTaskRust.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useGoTGraphView.ts` 等 | `src/useGoTGraphView.ts` | ✅ | GoT 图视图 |
| `src/agent/composables/useLongTask.ts` | `src/useLongTask.ts` | ✅ | 长任务 |
| `src/agent/composables/useOrchestrator.ts` | `src/useOrchestrator.ts` | ✅ | 编排 |
| `src/agent/composables/useGroupChat.ts` | `src/useGroupChat.ts` | ✅ | 群聊 |
| `src/agent/composables/usePlanStore.ts` | `src/usePlanStore.ts` | ✅ | Plan 存储 |
| `src/agent/composables/usePanelDrag.ts` | `src/usePanelDrag.ts` | ✅ | 面板拖拽 |
| `src/agent/composables/useSkillsStore.ts` | `src/useSkillsStore.ts` | ⚠️ | Skills 存储 |
| `src/agent/composables/useTerminal.ts` | → `apps/tauri/` | ❌ | Tauri 专属 |
| `src/agent/composables/useTitleGen.ts` | `src/useTitleGen.ts` | ✅ | 标题生成 |
| `src/agent/composables/longTaskStore.ts` | `src/longTaskStore.ts` | ✅ | 长任务存储 |

### 3.2 package.json

```json
{
  "name": "@worldsmith/shared-composables",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "vue-tsc --noEmit",
    "build": "vite build"
  },
  "peerDependencies": {
    "vue": "^3.5.32",
    "pinia": "^3.0.4"
  },
  "dependencies": {
    "@worldsmith/agent-runtime": "workspace:*",
    "@worldsmith/entity-core": "workspace:*",
    "@worldsmith/memory-archive": "workspace:*",
    "dexie": "^4.4.2"
  }
}
```

### 3.3 依赖注入模式（useAgent 改造）

```typescript
// packages/shared-composables/src/useAgent.ts
import type { IAgentBackend } from '@worldsmith/agent-runtime'

export interface UseAgentOptions {
  backend: IAgentBackend
  sessionId?: string
  chatMode?: ChatMode
}

export function useAgent(options: UseAgentOptions) {
  const backend = options.backend

  // 端无关逻辑（原 useAgentTs 逻辑）
  const messages = ref<AgentMessage[]>([])
  const isStreaming = ref(false)
  // ...

  async function sendMessage(text: string) {
    // 端无关实现，通过 backend 调用
    await backend.prompt(text, { chatMode: chatMode.value })
  }

  return {
    messages,
    isStreaming,
    sendMessage,
    // ...
  }
}
```

```typescript
// apps/web/src/agent/useAgentWs.ts
import { useAgent } from '@worldsmith/shared-composables'
import { WsAgentBackend } from './WsAgentBackend'

export function useAgentWs() {
  const backend = new WsAgentBackend({ url: 'ws://localhost:3100' })
  return useAgent({ backend })
}
```

```typescript
// apps/tauri/src/agent/useAgentTauri.ts
import { useAgent } from '@worldsmith/shared-composables'
import { RustAgentBackend } from './RustAgentBackend'

export function useAgentTauri() {
  const backend = new RustAgentBackend()
  return useAgent({ backend })
}
```

## 4. 抽离顺序（Phase 1 内部）

```
Step 1.1: 创建 packages/agent-runtime/ 骨架（package.json/tsconfig.json/vite.config.ts）
Step 1.2: 迁移 worldsmith-agent/src/ 端无关代码到 packages/agent-runtime/src/
Step 1.3: 迁移 execution/adapter.ts 接口到 agent-runtime，具体 adapter 留待 Phase 2 各端迁移
Step 1.4: 更新 worldsmith-agent/package.json → 仅保留 CLI 依赖
Step 1.5: 验证 packages/agent-runtime 独立 typecheck 通过
Step 1.6: 创建 packages/shared-composables/ 骨架
Step 1.7: 迁移 src/composables/ 与 src/agent/composables/ 端无关部分
Step 1.8: 改造 useAgent.ts 为依赖注入模式
Step 1.9: 创建 packages/shared-ui/ 骨架
Step 1.10: 迁移 src/ 中 UI 组件到 packages/shared-ui/src/
Step 1.11: 改造 UI 组件，使用 provide/inject 替代直接 import 后端
Step 1.12: 验证三包独立 typecheck/build 通过
```

## 5. 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 抽离过程中 import 路径大量断裂 | 编译失败 | 分批迁移，每批后跑 typecheck |
| 循环依赖（shared-ui ↔ shared-composables） | 编译失败 | shared-ui 依赖 shared-composables，反向通过 inject |
| ExecutionAdapter 接口变更影响三端 | 三端适配器需重写 | 接口保持向后兼容，新增方法用可选属性 |
| Vue provide/inject 类型丢失 | 类型不安全 | 使用 InjectionKey<T> 强类型 |
| 工具/技能定义中的端特定逻辑 | 抽离后无法运行 | 逐个审查，端特定逻辑通过 ToolContext 注入 |

# 06 - Tauri 端分离计划

> 目标：建立独立的 `apps/tauri/` 子项目，作为 Tauri 桌面应用。
> 前端 Vue + 后端 Rust（150+ 命令），无 WASM 回退。

## 1. 目录结构

```
apps/tauri/
├── src/                                 # Tauri 专属前端源码
│   ├── main.ts                          # Tauri 入口
│   ├── App.vue                          # Tauri 根组件
│   ├── bootstrap.ts                     # 端注册
│   ├── agent/                           # Tauri 专属 Agent 层
│   │   ├── RustAgentBackend.ts          # 通过 Tauri invoke 调 Rust 的 Agent 后端
│   │   ├── useAgentTauri.ts             # Tauri 版 useAgent
│   │   ├── useAgentRust.ts              # 从 src/agent/composables/ 迁移
│   │   ├── useGoTRust.ts                # 从 src/agent/composables/ 迁移
│   │   ├── useToTRust.ts                # 从 src/agent/composables/ 迁移
│   │   ├── useRouterRust.ts             # 从 src/agent/composables/ 迁移
│   │   ├── useSupervisorRust.ts         # 从 src/agent/composables/ 迁移
│   │   ├── useMultiAgentRust.ts         # 从 src/agent/composables/ 迁移
│   │   ├── useLoopControlRust.ts        # 从 src/agent/composables/ 迁移
│   │   └── useLongTaskRust.ts           # 从 src/agent/composables/ 迁移
│   ├── core/                            # Tauri 专属 core
│   │   ├── coreBackend.ts              # 仅 Tauri 后端，无 WASM 回退
│   │   ├── ProjectFS.ts                # 项目文件系统（从 src/core/ 迁移）
│   │   ├── IDBMigrator.ts              # IndexedDB 迁移器（从 src/core/ 迁移）
│   │   ├── FacetMigrator.ts            # Facet 迁移器
│   │   ├── ModuleRuntime.ts            # 模块运行时
│   │   ├── ModuleViewRegistry.ts       # 模块视图注册
│   │   ├── PackageBuilder.ts           # 包构建器
│   │   ├── WorldSeaPack.ts           # WorldSea 包
│   │   ├── ExportController.ts         # 导出控制器
│   │   ├── ImportController.ts         # 导入控制器
│   │   ├── CustomFields.ts             # 自定义字段
│   │   └── coreBackend.ts              # Tauri 专属
│   ├── execution/
│   │   └── tauri-adapter.ts            # Tauri 环境适配器（从 worldsea-agent 迁移）
│   ├── composables/                     # Tauri 专属 composables
│   │   ├── useProjectSwitcher.ts       # 从 src/composables/ 迁移
│   │   ├── useFsWatcher.ts             # 从 src/composables/ 迁移
│   │   ├── useFileSystemProject.ts     # 从 src/composables/ 迁移
│   │   ├── useFontBootstrap.ts         # 字体引导（Tauri 版）
│   │   ├── useFontPresets.ts           # 字体预设（Tauri 版）
│   │   ├── fontInstaller.ts            # 字体安装器（Tauri 版）
│   │   └── useFileExtract.ts           # 文件提取（Tauri 版）
│   ├── memory-archive/                  # Tauri 专属记忆归档适配器
│   │   └── adapters/
│   │       └── TauriFsOperations.ts    # 从 src/memory-archive/adapters/ 迁移
│   ├── plugins/                         # Tauri 专属插件 composables
│   │   └── official/
│   │       ├── mindmap/
│   │       │   └── composables/
│   │       │       ├── useRustLayout.ts
│   │       │       └── useRustGraphAnalysis.ts
│   │       └── workflow/
│   │           ├── composables/
│   │           │   └── useWorkflowEngineRun.ts
│   │           └── api/
│   │               └── workflowApi.ts
│   ├── agent-panels/                    # Tauri 专属 Agent 面板
│   │   └── TerminalPanel.vue            # 从 src/agent/ 迁移
│   └── types/
│       └── global.d.ts                 # Tauri 全局类型声明
├── src-tauri/                           # Rust 后端（从根 src-tauri/ 迁移）
│   ├── src/
│   │   ├── commands/                    # 150+ Tauri 命令
│   │   │   ├── agent.rs
│   │   │   ├── long_task.rs
│   │   │   ├── session.rs
│   │   │   ├── fs.rs
│   │   │   ├── file.rs
│   │   │   ├── pty.rs
│   │   │   ├── shell.rs
│   │   │   ├── mcp.rs
│   │   │   ├── kv.rs
│   │   │   ├── entity.rs
│   │   │   ├── relation.rs
│   │   │   ├── schema.rs
│   │   │   ├── got.rs
│   │   │   ├── tot.rs
│   │   │   ├── router.rs
│   │   │   ├── loop_control.rs
│   │   │   ├── multi_agent.rs
│   │   │   ├── supervisor.rs
│   │   │   ├── skills.rs
│   │   │   ├── project.rs
│   │   │   ├── secure.rs
│   │   │   ├── validate.rs
│   │   │   ├── spatial.rs
│   │   │   ├── retrofit.rs
│   │   │   ├── algo.rs
│   │   │   ├── font.rs
│   │   │   ├── schema_seed.rs
│   │   │   └── mod.rs
│   │   ├── agent_bridge/
│   │   │   ├── mod.rs
│   │   │   ├── payload.rs
│   │   │   └── registry.rs
│   │   ├── workflow/
│   │   │   ├── commands/
│   │   │   │   └── mod.rs / runs.rs
│   │   │   ├── executor/
│   │   │   │   └── mod.rs
│   │   │   ├── engine.rs
│   │   │   ├── error.rs
│   │   │   ├── mod.rs
│   │   │   ├── node_meta.rs
│   │   │   └── service.rs
│   │   ├── lib.rs
│   │   ├── main.rs
│   │   ├── state.rs
│   │   └── skills_store.rs
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/                           # Tauri 图标
│   ├── Cargo.lock
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json                  # Tauri 专属配置
├── vite.config.ts                       # Tauri 专属 Vite 配置
├── tsconfig.json                        # Tauri 专属 tsconfig
└── package.json                         # Tauri 专属 package.json
```

## 2. package.json

```json
{
  "name": "@worldsea/tauri",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@worldsea/agent-runtime": "workspace:*",
    "@worldsea/shared-ui": "workspace:*",
    "@worldsea/shared-composables": "workspace:*",
    "@worldsea/agent-core": "workspace:*",
    "@worldsea/canvas-engine": "workspace:*",
    "@worldsea/entity-core": "workspace:*",
    "@worldsea/font-kit": "workspace:*",
    "@worldsea/governor-core": "workspace:*",
    "@worldsea/memory-archive": "workspace:*",
    "@worldsea/motion-kit": "workspace:*",
    "@worldsea/perf-kit": "workspace:*",
    "@worldsea/plugin-sdk": "workspace:*",
    "@worldsea/theme-kit": "workspace:*",
    "@worldsea/ui-kit": "workspace:*",
    "@tauri-apps/api": "^2.11.0",
    "@tauri-apps/plugin-dialog": "^2.7.1",
    "@tauri-apps/plugin-opener": "^2.5.4",
    "@tiptap/core": "^3.26.1",
    "@tiptap/extension-mention": "^3.26.1",
    "@tiptap/starter-kit": "^3.26.1",
    "@tiptap/suggestion": "^3.26.1",
    "@tiptap/vue-3": "^3.26.1",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
    "d3-force": "^3.0.0",
    "dexie": "^4.4.2",
    "docx": "^9.6.1",
    "dompurify": "^3.4.3",
    "echarts": "^6.1.0",
    "gpt-tokenizer": "^2.9.0",
    "graphology": "^0.26.0",
    "graphology-layout": "^0.6.1",
    "graphology-layout-forceatlas2": "^0.10.1",
    "js-yaml": "^4.1.1",
    "jszip": "^3.10.1",
    "lucide-vue-next": "^0.577.0",
    "mammoth": "^1.12.0",
    "marked": "^18.0.03",
    "naive-ui": "^2.44.1",
    "pdfjs-dist": "^5.7.284",
    "pinia": "^3.0.4",
    "segmentit": "^2.0.3",
    "sigma": "^3.0.3",
    "turndown": "^7.2.4",
    "vue": "^3.5.32",
    "vuedraggable": "^4.1.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.2",
    "@types/d3-force": "^3.0.10",
    "@types/node": "^24.12.2",
    "@types/turndown": "^5.0.6",
    "@vitejs/plugin-vue": "^6.0.6",
    "@vue/tsconfig": "^0.9.1",
    "typescript": "~6.0.2",
    "vite": "^8.0.10",
    "vite-plugin-compression2": "^2.5.3",
    "vue-tsc": "^3.2.7"
  }
}
```

**关键差异**：
- 有 `@tauri-apps/api` / `@tauri-apps/cli` / `@tauri-apps/plugin-*`
- 无 `@worldsea/core` / `@worldsea/tactical-engine`（WASM）
- 无 `vite-plugin-wasm`
- 依赖 `@worldsea/agent-runtime` / `@worldsea/shared-ui` / `@worldsea/shared-composables`

## 3. tauri.conf.json

```json
{
  "$schema": "https://raw.githubusercontent.com/nicegram/nicegram-ios/refs/heads/NiceGram/Submodules/TelegramCore/tauri/tooling/cli/schema.json",
  "productName": "WorldSea",
  "version": "0.1.0",
  "identifier": "com.worldsea.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "WorldSea — 世界观构建工具",
        "width": 1280,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

**关键变更**：
- `beforeBuildCommand` 从 `npm run build:web` 改为 `npm run build`（仅 `vue-tsc + vite build`，无 WASM 构建）
- `frontendDist` 从 `../dist` 改为 `../dist`（相对 `apps/tauri/`）

## 4. vite.config.ts

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { compression } from 'vite-plugin-compression2'
import path from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    compression({ algorithm: 'gzip' }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@worldsea/shared-ui': path.resolve(__dirname, '../../packages/shared-ui/src'),
      '@worldsea/shared-composables': path.resolve(__dirname, '../../packages/shared-composables/src'),
      '@worldsea/agent-runtime': path.resolve(__dirname, '../../packages/agent-runtime/src'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      external: ['@worldsea/core', '@worldsea/tactical-engine'],  // 不打包 WASM
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'pinia', 'naive-ui'],
          'vendor-tauri': ['@tauri-apps/api', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-opener'],
          'vendor-agent': ['@worldsea/agent-runtime', '@worldsea/shared-composables'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // Tauri 特定配置
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
})
```

**关键差异**：
- 无 `wasm()` 插件
- `external` 包含 WASM 包（Tauri 不用）
- 增加 Tauri 特定配置（`clearScreen` / `envPrefix`）

## 5. 入口改造

### 5.1 main.ts

```typescript
// apps/tauri/src/main.ts
import './design-tokens/primitive.css'   // 从 packages/shared-ui 导入
import './design-tokens/semantic.css'
import './design-tokens/component.css'
import './design-tokens/interaction-modes.css'
import './assets/themes.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import { fieldRegistry, setUndoHistoryProvider, registerEventBus, registerValidationApi, registerToastApi, registerConfirmApi, registerDialogApi, registerSettingsApi } from '@worldsea/entity-core'
import { registerBackend } from '@worldsea/canvas-engine/core'
import { useConfirm, useDialog } from '@worldsea/plugin-sdk'
import { injectAllKeyframes } from '@worldsea/ui-kit'
import { registerAllManifests } from '@worldsea/theme-kit'

// Tauri 专属
import * as coreBackend from './core/coreBackend'  // 仅 Tauri 后端
import { useSettingsStore } from '@worldsea/shared-ui/stores/settingsStore'
import { eventBus } from '@worldsea/shared-ui/modules/runtime/events'
import { toastSuccess, toastError, toastWarn, toastInfo } from '@worldsea/shared-composables/useToast'

// 端注册
import { registerExecutionAdapterFactory } from '@worldsea/agent-runtime'
import { TauriExecutionAdapter } from './execution/tauri-adapter'
import { AgentBackendKey, CoreBackendKey } from '@worldsea/shared-ui'
import { RustAgentBackend } from './agent/RustAgentBackend'

// 注册 Tauri ExecutionAdapter
registerExecutionAdapterFactory({
  createTauriAdapter: () => new TauriExecutionAdapter(),
})

registerBackend({
  getBackendType: coreBackend.getBackendType,
  algoPointInPolygon: coreBackend.algoPointInPolygon,
  // ... 其他算法
})

const app = createApp(App)
app.use(createPinia())

// 注入端特定实现
app.provide(AgentBackendKey, new RustAgentBackend())
app.provide(CoreBackendKey, coreBackend)

// 其他注册
registerEventBus(eventBus)
registerValidationApi({ /* ... */ })
registerToastApi({ success: toastSuccess, error: toastError, warn: toastWarn, info: toastInfo })
registerConfirmApi(useConfirm())
registerDialogApi(useDialog())
registerSettingsApi(useSettingsStore())

document.documentElement.setAttribute('data-theme', localStorage.getItem('worldsea-theme') || 'aurora-abyss')
injectAllKeyframes()
registerAllManifests()
setUndoHistoryProvider(() => useSettingsStore().undoHistoryLimit || 20)
fieldRegistry.loadPersisted()
app.mount('#app')
```

### 5.2 coreBackend.ts 改造

**改造前**（运行时检测）：
```typescript
function detectBackend(): BackendType {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return 'tauri'
  // ... WASM 检测
  return 'none'
}
```

**改造后**（仅 Tauri）：
```typescript
// apps/tauri/src/core/coreBackend.ts
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

// ... 所有函数仅走 Tauri invoke 路径，无 WASM 回退
```

### 5.3 RustAgentBackend.ts（新增）

```typescript
// apps/tauri/src/agent/RustAgentBackend.ts
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { IAgentBackend, AgentEvent, AgentMessage, PromptOptions } from '@worldsea/agent-runtime'

export class RustAgentBackend implements IAgentBackend {
  private sessionId: string
  private listeners: ((event: AgentEvent) => void)[] = []
  private unlisten?: () => void

  constructor(sessionId?: string) {
    this.sessionId = sessionId || crypto.randomUUID()
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    await invoke('agent_prompt', {
      sessionId: this.sessionId,
      text,
      options,
    })
  }

  async steer(text: string): Promise<void> {
    await invoke('agent_steer', { sessionId: this.sessionId, text })
  }

  async abort(): Promise<void> {
    await invoke('agent_abort', { sessionId: this.sessionId })
  }

  async subscribe(listener: (event: AgentEvent) => void): Promise<() => void> {
    this.listeners.push(listener)
    if (!this.unlisten) {
      this.unlisten = await listen<AgentEvent>('agent_event', (e) => {
        this.listeners.forEach(l => l(e.payload))
      })
    }
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  async dispose(): Promise<void> {
    this.unlisten?.()
    await invoke('agent_dispose', { sessionId: this.sessionId })
  }

  // ... 其他 IAgentBackend 方法（全部通过 invoke 调 Rust 命令）
}
```

## 6. 迁移步骤

```
Step T1: 创建 apps/tauri/ 目录骨架与 package.json
Step T2: 迁移根 src-tauri/ 到 apps/tauri/src-tauri/（整体迁移，含 Cargo.toml/tauri.conf.json）
Step T3: 迁移 src/main.ts 到 apps/tauri/src/main.ts，改造入口（注册 Tauri 后端）
Step T4: 迁移 src/core/coreBackend.ts，改造为仅 Tauri 后端
Step T5: 迁移 src/core/{ProjectFS.ts, IDBMigrator.ts, FacetMigrator.ts 等}到 apps/tauri/src/core/
Step T6: 迁移 src/agent/composables/useAgentRust.ts 等 8 个 Rust composables 到 apps/tauri/src/agent/
Step T7: 迁移 src/agent/TerminalPanel.vue 到 apps/tauri/src/agent-panels/
Step T8: 迁移 src/composables/{useProjectSwitcher.ts, useFsWatcher.ts, useFileSystemProject.ts} 到 apps/tauri/src/composables/
Step T9: 迁移 src/memory-archive/adapters/TauriFsOperations.ts 到 apps/tauri/src/memory-archive/adapters/
Step T10: 迁移 src/plugins/official/mindmap/composables/{useRustLayout.ts, useRustGraphAnalysis.ts} 到 apps/tauri/src/plugins/
Step T11: 迁移 src/plugins/official/workflow/{composables/useWorkflowEngineRun.ts, api/workflowApi.ts} 到 apps/tauri/src/plugins/
Step T12: 迁移 worldsea-agent/src/execution/tauri-adapter.ts 到 apps/tauri/src/execution/
Step T13: 创建 RustAgentBackend.ts 与 useAgentTauri.ts
Step T14: 配置 apps/tauri/vite.config.ts（无 WASM，有 Tauri）
Step T15: 配置 apps/tauri/tsconfig.json
Step T16: 更新 apps/tauri/src-tauri/tauri.conf.json（beforeBuildCommand 改为 npm run build）
Step T17: 验证 apps/tauri 独立 `tauri:dev` 启动通过
Step T18: 验证 apps/tauri 独立 `tauri:build` 构建通过
Step T19: 验证 Rust 命令调用正常（在 Tauri 应用中测试）
Step T20: 验证 Agent 通过 invoke 调 Rust 后端正常
```

## 7. Rust 后端注意事项

### 7.1 Cargo.toml 路径调整

迁移后，`apps/tauri/src-tauri/Cargo.toml` 中的相对路径需调整：

```toml
# 改前（在根目录）
[dependencies]
agent-runtime = { path = "../../crates/agent-runtime" }

# 改后（在 apps/tauri/src-tauri/）
[dependencies]
agent-runtime = { path = "../../../crates/agent-runtime" }
```

### 7.2 build.rs 路径调整

```rust
// apps/tauri/src-tauri/build.rs
fn main() {
    tauri_build::build()
    // 如有其他路径相关配置，需调整相对路径
}
```

### 7.3 tauri.conf.json frontendDist

```json
{
  "build": {
    "frontendDist": "../dist"  // 相对 apps/tauri/src-tauri/，指向 apps/tauri/dist/
  }
}
```

## 8. 验证清单

- [ ] `apps/tauri/package.json` 有 `@tauri-apps/*` 依赖
- [ ] `apps/tauri/package.json` 无 `@worldsea/core` / `@worldsea/tactical-engine`（WASM）
- [ ] `apps/tauri/src/` 中无 WASM import
- [ ] `apps/tauri/src/core/coreBackend.ts` 仅走 Tauri invoke 路径
- [ ] `apps/tauri/vite.config.ts` 无 `wasm()` 插件
- [ ] `apps/tauri/src-tauri/tauri.conf.json` 的 `beforeBuildCommand` 为 `npm run build`（无 WASM 构建）
- [ ] `apps/tauri/src-tauri/Cargo.toml` 路径正确
- [ ] `npm run tauri:dev` 独立启动通过
- [ ] `npm run tauri:build` 独立构建通过
- [ ] Rust 命令调用正常（在 Tauri 应用中测试）
- [ ] Agent 通过 invoke 调 Rust 后端正常
- [ ] TerminalPanel 终端面板正常工作
- [ ] 项目文件系统（ProjectFS）正常工作
- [ ] 字体安装/预设正常工作

# 04 - Web 端分离计划

> 目标：建立独立的 `apps/web/` 子项目，作为浏览器中运行的纯前端应用。
> 后端能力通过 HTTP/WS 连接 CLI serve 获取，算法层使用 WASM。

## 1. 目录结构

```
apps/web/
├── public/                              # 静态资源
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── main.ts                          # Web 入口
│   ├── App.vue                          # Web 根组件
│   ├── bootstrap.ts                     # 端注册（ExecutionAdapter 工厂等）
│   ├── agent/                           # Web 专属 Agent 层
│   │   ├── WsAgentBackend.ts            # 通过 WS 连接 CLI serve 的 Agent 后端
│   │   ├── useAgentWs.ts                # Web 版 useAgent
│   │   └── useCliAgent.ts              # CLI Agent 连接（从 src/agent/composables/ 迁移）
│   ├── core/                            # Web 专属 core
│   │   ├── coreBackend.ts              # 仅 WASM 后端，无 Tauri 分支
│   │   ├── worldseaCore.ts           # WASM 加载（从 src/core/ 迁移）
│   │   ├── wasmWorkerPool.ts           # WASM Worker 池（从 src/core/ 迁移）
│   │   ├── wasm.worker.ts              # WASM Worker（从 src/core/ 迁移）
│   │   └── io_export.ts                # 导出（从 src/core/ 迁移）
│   ├── execution/                       # Web 专属执行适配器
│   │   └── ws-adapter.ts               # WebSocket 适配器（从 worldsea-agent 迁移）
│   ├── composables/                     # Web 专属 composables
│   │   ├── useFileExtract.ts           # 文件提取（Web 版，用 File API）
│   │   └── useFontPresets.ts           # 字体预设（Web 版）
│   ├── api/                             # Web API 调用层
│   │   ├── cliServe.ts                 # CLI serve HTTP 调用
│   │   ├── crawl.ts                    # 爬虫（替代 worldsea-server/crawl）
│   │   ├── convert.ts                  # 文档转换（替代 worldsea-server/convert）
│   │   └── vectorSearch.ts             # 向量搜索（替代 worldsea-server/vector-search）
│   └── types/                           # Web 专属类型
│       └── global.d.ts                 # 全局类型声明
├── index.html                           # Web HTML 入口（从根 index.html 迁移）
├── vite.config.ts                       # Web 专属 Vite 配置
├── tsconfig.json                        # Web 专属 tsconfig
├── tsconfig.node.json                   # Node 环境 tsconfig（vite.config 用）
└── package.json                         # Web 专属 package.json
```

## 2. package.json

```json
{
  "name": "@worldsea/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "npm run build:wasm && vue-tsc -b && vite build",
    "build:wasm": "wasm-pack build ../../worldsea-core --target bundler --out-dir pkg --scope worldsea --out-name index -- --features wasm && wasm-pack build ../../tactical-engine --target bundler --out-dir pkg --scope worldsea --out-name index",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@worldsea/agent-runtime": "workspace:*",
    "@worldsea/shared-ui": "workspace:*",
    "@worldsea/shared-composables": "workspace:*",
    "@worldsea/agent-core": "workspace:*",
    "@worldsea/canvas-engine": "workspace:*",
    "@worldsea/core": "file:../../worldsea-core/pkg",
    "@worldsea/entity-core": "workspace:*",
    "@worldsea/font-kit": "workspace:*",
    "@worldsea/governor-core": "workspace:*",
    "@worldsea/memory-archive": "workspace:*",
    "@worldsea/motion-kit": "workspace:*",
    "@worldsea/perf-kit": "workspace:*",
    "@worldsea/plugin-sdk": "workspace:*",
    "@worldsea/tactical-engine": "file:../../tactical-engine/pkg",
    "@worldsea/theme-kit": "workspace:*",
    "@worldsea/ui-kit": "workspace:*",
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
    "marked": "^18.0.3",
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
    "@types/d3-force": "^3.0.10",
    "@types/node": "^24.12.2",
    "@types/turndown": "^5.0.6",
    "@vitejs/plugin-vue": "^6.0.6",
    "@vitest/coverage-v8": "^3.2.6",
    "@vue/test-utils": "^2.4.10",
    "@vue/tsconfig": "^0.9.1",
    "fake-indexeddb": "^6.2.5",
    "jsdom": "^25.0.1",
    "rollup-plugin-visualizer": "^7.0.1",
    "typescript": "~6.0.2",
    "vite": "^8.0.10",
    "vite-plugin-compression2": "^2.5.3",
    "vite-plugin-wasm": "^3.6.0",
    "vitest": "^3.2.6",
    "vue-tsc": "^3.2.7"
  }
}
```

**关键差异**：
- 无 `@tauri-apps/api` / `@tauri-apps/cli` / `@tauri-apps/plugin-*`
- 无 `@chenglou/pretext`（如未使用）
- 无 `@windfonts/chinese-fonts`（如未使用）
- 依赖 `@worldsea/agent-runtime` / `@worldsea/shared-ui` / `@worldsea/shared-composables`

## 3. vite.config.ts

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import { compression } from 'vite-plugin-compression2'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    wasm(),
    compression({ algorithm: 'gzip' }),
    visualizer({ open: false, filename: 'dist/stats.html' }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@worldsea/shared-ui': path.resolve(__dirname, '../../packages/shared-ui/src'),
      '@worldsea/shared-composables': path.resolve(__dirname, '../../packages/shared-composables/src'),
      '@worldsea/agent-runtime': path.resolve(__dirname, '../../packages/agent-runtime/src'),
    },
  },
  optimizeDeps: {
    exclude: ['@worldsea/core', '@worldsea/tactical-engine'],  // WASM 包不预构建
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'pinia', 'naive-ui'],
          'vendor-wasm': ['@worldsea/core', '@worldsea/tactical-engine'],
          'vendor-agent': ['@worldsea/agent-runtime', '@worldsea/shared-composables'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

## 4. tsconfig.json

```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@worldsea/shared-ui": ["../../packages/shared-ui/src"],
      "@worldsea/shared-ui/*": ["../../packages/shared-ui/src/*"],
      "@worldsea/shared-composables": ["../../packages/shared-composables/src"],
      "@worldsea/shared-composables/*": ["../../packages/shared-composables/src/*"],
      "@worldsea/agent-runtime": ["../../packages/agent-runtime/src"],
      "@worldsea/agent-runtime/*": ["../../packages/agent-runtime/src/*"]
    },
    "types": ["vite/client", "node"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
  "references": [
    { "path": "../../packages/agent-runtime" },
    { "path": "../../packages/shared-ui" },
    { "path": "../../packages/shared-composables" }
  ]
}
```

## 5. 入口改造

### 5.1 main.ts

```typescript
// apps/web/src/main.ts
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

// Web 专属
import * as coreBackend from './core/coreBackend'   // 仅 WASM 后端
import { useSettingsStore } from '@worldsea/shared-ui/stores/settingsStore'
import { eventBus } from '@worldsea/shared-ui/modules/runtime/events'
import { toastSuccess, toastError, toastWarn, toastInfo } from '@worldsea/shared-composables/useToast'

// 端注册
import { registerExecutionAdapterFactory } from '@worldsea/agent-runtime'
import { WebSocketExecutionAdapter } from './execution/ws-adapter'
import { AgentBackendKey, CoreBackendKey } from '@worldsea/shared-ui'
import { WsAgentBackend } from './agent/WsAgentBackend'

// 注册 ExecutionAdapter 工厂
registerExecutionAdapterFactory({
  createWsAdapter: (config) => new WebSocketExecutionAdapter(config),
})

registerBackend({
  getBackendType: () => 'wasm',  // 硬编码 WASM，无检测
  algoPointInPolygon: coreBackend.algoPointInPolygon,
  // ... 其他算法
})

const app = createApp(App)
app.use(createPinia())

// 注入端特定实现
app.provide(AgentBackendKey, new WsAgentBackend({ url: 'ws://localhost:3100' }))
app.provide(CoreBackendKey, coreBackend)

// 其他注册（与原 main.ts 一致）
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
  // ... 检测 WASM
  return 'none'
}

export async function validateEntity(...) {
  const backend = detectBackend()
  if (backend === 'tauri') {
    return invoke('cmd_validate_entity', ...)  // Tauri 分支
  }
  // WASM 分支
}
```

**改造后**（仅 WASM）：
```typescript
// apps/web/src/core/coreBackend.ts
import { getCore } from './worldseaCore'
import { callViaWorker, isHeavyMethod } from './wasmWorkerPool'

let _corePromise: Promise<unknown> | null = null
async function getCoreCached() {
  if (!_corePromise) {
    _corePromise = getCore()
  }
  return _corePromise
}

export function getBackendType(): 'wasm' {
  return 'wasm'  // 硬编码
}

export async function validateEntity(entityJson: string, schemaJson?: string) {
  const core = await getCoreCached()
  return core!.validateEntity(entityJson, schemaJson)
}

// ... 所有函数仅走 WASM 路径，无 Tauri 分支
```

### 5.3 WsAgentBackend.ts（新增）

```typescript
// apps/web/src/agent/WsAgentBackend.ts
import type { IAgentBackend, AgentEvent, AgentMessage, PromptOptions, ChatMode } from '@worldsea/agent-runtime'
import { WebSocketExecutionAdapter } from '../execution/ws-adapter'

export class WsAgentBackend implements IAgentBackend {
  private ws: WebSocket
  private listeners: ((event: AgentEvent) => void)[] = []

  constructor(config: { url: string }) {
    this.ws = new WebSocket(config.url)
    this.ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as AgentEvent
      this.listeners.forEach(l => l(event))
    }
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    this.ws.send(JSON.stringify({ type: 'prompt', text, options }))
  }

  async steer(text: string): Promise<void> { /* ... */ }
  async abort(): Promise<void> { /* ... */ }
  async subscribe(listener: (event: AgentEvent) => void): Promise<() => void> {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }
  // ... 其他 IAgentBackend 方法
}
```

## 6. 迁移步骤

```
Step W1: 创建 apps/web/ 目录骨架与 package.json
Step W2: 迁移 index.html 到 apps/web/index.html
Step W3: 迁移 src/main.ts 到 apps/web/src/main.ts，改造入口（移除 Tauri 分支）
Step W4: 迁移 src/core/coreBackend.ts，改造为仅 WASM 后端
Step W5: 迁移 src/core/{worldseaCore.ts, wasmWorkerPool.ts, wasm.worker.ts, io_export.ts}
Step W6: 迁移 worldsea-agent/src/execution/ws-adapter.ts 到 apps/web/src/execution/
Step W7: 创建 WsAgentBackend.ts 与 useAgentWs.ts
Step W8: 迁移 worldsea-server 相关 API 调用到 apps/web/src/api/（指向 CLI serve）
Step W9: 配置 apps/web/vite.config.ts（无 Tauri 依赖，含 WASM 插件）
Step W10: 配置 apps/web/tsconfig.json
Step W11: 验证 apps/web 独立 dev 启动通过
Step W12: 验证 apps/web 独立 build 通过
```

## 7. 验证清单

- [ ] `apps/web/package.json` 无 `@tauri-apps/*` 依赖
- [ ] `apps/web/src/` 中无 `import @tauri-apps/api`
- [ ] `apps/web/src/` 中无 `window.__TAURI__` 检测
- [ ] `coreBackend.ts` 仅走 WASM 路径
- [ ] `vite.config.ts` 无 Tauri 集成
- [ ] `npm run dev` 独立启动通过
- [ ] `npm run build` 独立构建通过
- [ ] WASM 算法调用正常（在浏览器测试）
- [ ] Agent 通过 WS 连接 CLI serve 正常（需 CLI serve 启动）

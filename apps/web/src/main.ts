/**
 * Web 端入口（Phase 3 — 端分离业务 UI 迁入 · 第一批：骨架启动链路）
 *
 * 端分离策略：
 * - 硬编码 WASM 后端（移除 getBackendType 运行时检测）
 * - 通过 /api/* 代理连接 CLI serve（LLM、文件、Python 微服务）
 * - WASM 算法降级（当 CLI serve 不可用时）
 *
 * 迁移批次标注：
 * - P3-W1 ✅ 设计令牌 + boot 组件（Splash/BootError）+ 轻量共享壳
 * - P3-W2 ✅ Shell 布局（MenuBar/SidebarV2/WsConfirmDialog/Companion/AppMessageHandler + modules/store + useProjectSwitcher）
 * - P3-W3 ⏳ 核心页面（AgentSpace/实体视图/插件面板）+ governor + 官方插件 + 业务弹窗
 */
import './design-tokens/primitive.css'
import './design-tokens/semantic.css'
import './design-tokens/component.css'
import './design-tokens/interaction-modes.css'
import './assets/themes.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import {
  fieldRegistry,
  setUndoHistoryProvider,
  registerEventBus,
  registerValidationApi,
  registerToastApi,
  registerConfirmApi,
  registerDialogApi,
  registerSettingsApi,
  registerModuleStoreApi,
  registerProjectSwitcherApi,
  registerDownloader,
  registerPackValidator,
  registerAppVersionProvider,
} from '@worldsmith/entity-core'
import { registerBackend } from '@worldsmith/canvas-engine/core'
import * as coreBackend from './core/coreBackend'
import { useSettingsStore } from './stores/settingsStore'
import { eventBus } from './modules/runtime/events'
import { moduleStore } from './modules/store'
import { useProjectSwitcher } from './composables/useProjectSwitcher'
import { useConfirm, useDialog } from '@worldsmith/plugin-sdk'
import { injectAllKeyframes } from '@worldsmith/ui-kit'
import { toastSuccess, toastError, toastWarn, toastInfo } from './composables/useToast'
import { registerAllManifests } from '@worldsmith/theme-kit'
import { registerExecutionAdapterFactory } from '@agent/execution'
// 端适配器宿主：Web 端仅使用 WebSocket 执行适配器（Tauri 端使用 TauriExecutionAdapter）
// ws-adapter 自 worldsmith-agent/src/execution 迁移至本端（Phase 6 清理）
import { WebSocketExecutionAdapter } from '@/execution/ws-adapter'

// 收敛中间态：@agent 入口已统一到 packages/agent-runtime（无副作用注册），
// 端适配器改为主应用显式注册（替代 worldsmith-agent/index.ts 的 import './execution' 副作用）
registerExecutionAdapterFactory({
  createWsAdapter: (config) => new WebSocketExecutionAdapter(config),
})

registerBackend({
  getBackendType: coreBackend.getBackendType,
  algoPointInPolygon: coreBackend.algoPointInPolygon,
  algoSegmentIntersect: coreBackend.algoSegmentIntersect,
  algoConvexHull: coreBackend.algoConvexHull,
  algoPolygonSimplify: coreBackend.algoPolygonSimplify,
  algoPolygonBoolean: coreBackend.algoPolygonBoolean,
  algoChaikinSmooth: coreBackend.algoChaikinSmooth,
  algoFindSharedEdges: coreBackend.algoFindSharedEdges,
  algoFindLinePolygonIntersections: coreBackend.algoFindLinePolygonIntersections,
  algoPolygonSplit: coreBackend.algoPolygonSplit,
  algoPolygonAugment: coreBackend.algoPolygonAugment,
  algoDijkstraPath: coreBackend.algoDijkstraPath,
  algoCommunityDetection: coreBackend.algoCommunityDetection,
})

const app = createApp(App)
app.use(createPinia())

registerEventBus(eventBus)

registerValidationApi({
  validateEntity: coreBackend.validateEntity,
  checkReferences: coreBackend.checkReferences,
  getBackendType: coreBackend.getBackendType,
})

registerToastApi({
  success: toastSuccess,
  error: toastError,
  warn: toastWarn,
  info: toastInfo,
})

registerConfirmApi(useConfirm())

registerDialogApi(useDialog())

registerSettingsApi(useSettingsStore())

// P3-W2：modules/store + useProjectSwitcher 已迁入 Web 端，替换 P3-W1 占位实现
// 注：entity-core 的 ModuleStoreApi.install 参数为精简版 ModuleInstance（id/active/source），
// 运行时实际传入的是完整模块实例（含 manifest），与根 src/main.ts 行为一致，此处断言桥接。
registerModuleStoreApi({
  getAll: () => moduleStore.getAll(),
  install: (mod) => moduleStore.install(mod as Parameters<typeof moduleStore.install>[0]),
})
registerProjectSwitcherApi({
  switchProject: (targetProjectId) => useProjectSwitcher().switchProject(targetProjectId),
})

// Phase 8d: io 模块依赖注入（浏览器下载 + 包校验 + 应用版本）
registerDownloader({
  download(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },
})
registerPackValidator({
  async validatePack(packJson: string) {
    return coreBackend.validatePack(packJson)
  },
})
registerAppVersionProvider({
  getAppVersion() {
    return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
  },
})

document.documentElement.setAttribute('data-theme', localStorage.getItem('worldsmith-theme') || 'aurora-abyss')
injectAllKeyframes()
registerAllManifests()
setUndoHistoryProvider(() => useSettingsStore().undoHistoryLimit || 20)
fieldRegistry.loadPersisted()
app.mount('#app')

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
import { useConfirm, useDialog } from '@worldsmith/plugin-sdk'
import { injectAllKeyframes } from '@worldsmith/ui-kit'
import { toastSuccess, toastError, toastWarn, toastInfo } from './composables/useToast'
import { registerAllManifests } from '@worldsmith/theme-kit'
import { moduleStore } from './modules/store'
import { useProjectSwitcher } from './composables/useProjectSwitcher'

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

// Phase 5a: 注册 ProjectFS 依赖注入服务
// moduleStore 和 useProjectSwitcher 依赖根项目数据库与模块系统，无法下沉到 entity-core，
// 通过接口注入让 entity-core/core/ProjectFS 能访问它们。
registerModuleStoreApi({
  getAll: () => moduleStore.getAll(),
  install: (mod) => moduleStore.install(mod),
})
registerProjectSwitcherApi({
  switchProject: (targetProjectId: string) =>
    useProjectSwitcher().switchProject(targetProjectId),
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

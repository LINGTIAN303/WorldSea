/** Tauri 端入口（Phase 3 端分离：硬编码 IPC 后端），详细见 docs/details/注释/tauri/main.md */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/theme.css'
// Web 端变量名 → Tauri 令牌桥接（必须在 theme.css 之后，覆盖其 A2UI 区同名变量）
import './styles/web-tokens-bridge.css'

// Tauri 端 coreBackend（Tauri invoke only 版本）
import * as coreBackend from './core/coreBackend'

// 共享层：注册 entity-core / canvas-engine 等运行时
import { registerValidationApi } from '@worldsmith/entity-core'
import { registerBackend } from '@worldsmith/canvas-engine/core'
import { injectAllKeyframes } from '@worldsmith/motion-kit'
import { registerAllManifests } from '@worldsmith/theme-kit'
import { preloadSupportingModels } from './agent/composables/preloadModels'
import { installModelFetchWatcher } from './agent/composables/useModelFetchWatcher'

/**
 * Tauri 端后端初始化
 *
 * Tauri 端 coreBackend 已硬编码 detectBackend() → 'tauri'，无需 setWasmAvailable
 * Tauri 运行时会自动注入 window.__TAURI_INTERNALS__，getTauriInvoke() 可正常工作
 */
async function initializeBackend() {
  // 注册 canvas-engine 后端（Tauri invoke 路径，契约 = BackendAlgoApi）
  registerBackend({
    getBackendType: coreBackend.getBackendType,
    algoDijkstraPath: coreBackend.algoDijkstraPath,
  })

  // 注册 entity-core 验证 API（契约 = ValidationApi）
  registerValidationApi({
    validateEntity: coreBackend.validateEntity,
    checkReferences: coreBackend.checkReferences,
    getBackendType: coreBackend.getBackendType,
  })

  // 注册主题清单
  registerAllManifests()

  // 注入所有 keyframes 动画
  injectAllKeyframes()
}

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

app.mount('#app')

// 在 mount 后初始化后端（避免阻塞首屏渲染）
initializeBackend().catch((err) => {
  console.error('[Tauri 端入口] 后端初始化失败:', err)
})

// D2 启动预拉：对所有支持模型列表的供应商后台刷新模型缓存（fire-and-forget）
preloadSupportingModels()

// settingsStore 全局 watch：任意入口切换供应商时自动拉取云端模型列表
installModelFetchWatcher()

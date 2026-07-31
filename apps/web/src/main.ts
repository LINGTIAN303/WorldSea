/**
 * Web 端入口（Phase 3 — 端入口硬编码后端）
 *
 * 端分离策略：
 * - 硬编码 WASM 后端（移除 getBackendType 运行时检测）
 * - 通过 /api/* 代理连接 CLI serve（LLM、文件、Python 微服务）
 * - WASM 算法降级（当 CLI serve 不可用时）
 *
 * Phase 3 阶段：业务 UI 仍在 src/，本入口仅做端初始化
 * Phase 4 阶段：业务 UI 迁入 packages/shared-ui 后，本入口成为完整应用入口
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// Web 端 coreBackend（WASM only 版本）
import * as coreBackend from './core/coreBackend'

// 共享层：注册 entity-core / canvas-engine 等运行时
import {
  fieldRegistry,
  setUndoHistoryProvider,
  registerEventBus,
  registerValidationApi,
  registerToastApi,
  registerConfirmApi,
  registerDialogApi,
  registerSettingsApi,
} from '@worldsmith/entity-core'
import { registerBackend } from '@worldsmith/canvas-engine/core'
import { useConfirm, useDialog } from '@worldsmith/ui-kit'
import { injectAllKeyframes } from '@worldsmith/motion-kit'
import { registerAllManifests } from '@worldsmith/theme-kit'

/**
 * Web 端后端初始化
 *
 * 显式激活 WASM 后端（绕过 detectBackend 的测试键检测）
 * — Phase 3 端分离后，Web 端不再依赖 window.__worldsmith_core_wasm_test__ 检测
 */
async function initializeBackend() {
  // 显式标记 WASM 可用（coreBackend.setWasmAvailable）
  coreBackend.setWasmAvailable(true)

  // 注册 canvas-engine 后端（算法降级）
  registerBackend({
    getBackendType: coreBackend.getBackendType,
    validateEntity: coreBackend.validateEntity,
    validateEntities: coreBackend.validateEntities,
    validatePack: coreBackend.validatePack,
    checkReferences: coreBackend.checkReferences,
    migrate: coreBackend.migrate,
    runDiagnostics: coreBackend.runDiagnostics,
    algoDijkstraPath: coreBackend.algoDijkstraPath,
    algoAstar: coreBackend.algoAstar,
    algoTopologicalSort: coreBackend.algoTopologicalSort,
    algoConnectedComponents: coreBackend.algoConnectedComponents,
    algoTarjanScc: coreBackend.algoTarjanScc,
    algoForceLayout: coreBackend.algoForceLayout,
  })

  // 注册 entity-core 验证 API
  registerValidationApi({
    validateEntity: coreBackend.validateEntity,
    validateEntities: coreBackend.validateEntities,
    validatePack: coreBackend.validatePack,
    checkReferences: coreBackend.checkReferences,
    migrate: coreBackend.migrate,
    runDiagnostics: coreBackend.runDiagnostics,
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

// 注册 entity-core 的 Pinia store provider
// 注：useConfirm / useDialog 需要在 app 上下文内调用
app.mount('#app')

// 在 mount 后初始化后端（避免阻塞首屏渲染）
initializeBackend().catch((err) => {
  console.error('[Web 端入口] 后端初始化失败:', err)
})

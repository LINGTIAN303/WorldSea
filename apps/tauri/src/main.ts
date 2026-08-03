/**
 * Tauri 端入口（Phase 3 — 端入口硬编码后端）
 *
 * 端分离策略：
 * - 硬编码 Tauri IPC 后端（移除 getBackendType 运行时检测）
 * - 通过 Tauri invoke 调用 Rust 命令
 * - 不需要 /api/* 代理（IPC 直连系统能力）
 *
 * Phase 3 阶段：业务 UI 仍在 src/，本入口仅做端初始化
 * Phase 4 阶段：业务 UI 迁入 packages/shared-ui 后，本入口成为完整应用入口
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// Tauri 端 coreBackend（Tauri invoke only 版本）
import * as coreBackend from './core/coreBackend'

// 共享层：注册 entity-core / canvas-engine 等运行时
import { registerValidationApi } from '@worldsmith/entity-core'
import { registerBackend } from '@worldsmith/canvas-engine/core'
import { injectAllKeyframes } from '@worldsmith/motion-kit'
import { registerAllManifests } from '@worldsmith/theme-kit'

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

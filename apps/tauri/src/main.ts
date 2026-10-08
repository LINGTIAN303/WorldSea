/** Tauri 端入口（Phase 3 端分离：硬编码 IPC 后端），详细见 docs/details/注释/tauri/main.md */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import VueCodemirror from 'vue-codemirror'
import App from './App.vue'
import { wsBasicSetup } from './components/files/cmBasicSetup'
import './styles/theme.css'
// Web 端变量名 → Tauri 令牌桥接（必须在 theme.css 之后，覆盖其 A2UI 区同名变量）
import './styles/web-tokens-bridge.css'

// Tauri 端 coreBackend（Tauri invoke only 版本）
import * as coreBackend from './core/coreBackend'

// 全局文件拖拽兜底：与 tauri.conf.json 的 `dragDropEnabled: false` 配套
// （关掉宿主劫持才能用 HTML5 拖拽；代价是需自己挡住「文件拖到非落点区 → webview 导航」）
import { installFileDragGuard } from './composables/dragDropGuard'
installFileDragGuard()

// 共享层：注册 entity-core / canvas-engine 等运行时
import { registerValidationApi } from '@worldsea/entity-core'
import { registerBackend } from '@worldsea/canvas-engine/core'
import { injectAllKeyframes } from '@worldsea/motion-kit'
import { installAutoLinkWiring } from './shell/autoLinkWiring'

/**
 * Tauri 端后端初始化
 *
 * Tauri 端 coreBackend 已硬编码 detectBackend() → 'tauri'，无需 setWasmAvailable
 * Tauri 运行时会自动注入 window.__TAURI_INTERNALS__，getTauriInvoke() 可正常工作
 */
async function initializeBackend() {
  // AutoLink ② 批装配（策略注册 / 设置桥 / 确认桥 / 撤销上限）
  installAutoLinkWiring()

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

  // theme-kit manifest 注册已随风格包退役移除（2026-09-13 主题收束，c3e7a3e）；
  // 动画风格现由 theme.css 令牌 + motion-kit keyframes 承载

  // 注入所有 keyframes 动画
  injectAllKeyframes()

  // 芽级 Agent 能力注册（App 侧注册模式：toolbus internal 链，避开 packages 反向依赖）：
  // C 批（2026-09-25）起 mindmap 的能力面改经**能力桥**暴露（`world.mindmap.*`，随树插件装载/撤登记），
  // 不再走此处登记。
}

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
// vue-codemirror 全局默认扩展替换（2026-09-08）：官方 basicSetup 内置 autocompletion()，
// 与各 assist 自建实例并存时 CM 补全互相干扰失效（键入/startCompletion 均不弹，真机实测）；
// wsBasicSetup=等价基础集减 autocompletion，让 assist 的 override 实例成为唯一实例
app.use(VueCodemirror, { extensions: [wsBasicSetup] })

app.mount('#app')

// 在 mount 后初始化后端（避免阻塞首屏渲染）
initializeBackend().catch((err) => {
  console.error('[Tauri 端入口] 后端初始化失败:', err)
})

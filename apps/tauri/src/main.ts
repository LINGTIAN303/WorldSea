/** Tauri 端入口（Phase 3 端分离：硬编码 IPC 后端），详细见 docs/details/注释/tauri/main.md */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import VueCodemirror from 'vue-codemirror'
import App from './App.vue'
import { wsBasicSetup } from './components/files/cmBasicSetup'
import './styles/theme.css'
// Web 端变量名 → Tauri 令牌桥接（必须在 theme.css 之后，覆盖其 A2UI 区同名变量）
import './styles/web-tokens-bridge.css'
// 表面契约必须排在桥接层之后，才能覆盖 --bg-surface / --border / --shadow-* 等通用令牌
import '@worldsea/style-kit/styles.css'
import './styles/liquid-glass-surfaces.css'
import '@worldsea/motion-kit/presets.css'
import { applyPersistedStyle } from '@worldsea/style-kit'

import { startBackendBoot } from './boot/backendBoot'

// 全局文件拖拽兜底：与 tauri.conf.json 的 `dragDropEnabled: false` 配套
// （关掉宿主劫持才能用 HTML5 拖拽；代价是需自己挡住「文件拖到非落点区 → webview 导航」）
import { installFileDragGuard } from './composables/dragDropGuard'
installFileDragGuard()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
// vue-codemirror 全局默认扩展替换（2026-09-08）：官方 basicSetup 内置 autocompletion()，
// 与各 assist 自建实例并存时 CM 补全互相干扰失效（键入/startCompletion 均不弹，真机实测）；
// wsBasicSetup=等价基础集减 autocompletion，让 assist 的 override 实例成为唯一实例
app.use(VueCodemirror, { extensions: [wsBasicSetup] })

// 风格必须在挂载前落地：data-style + 四维变量，避免首帧回退到默认令牌
applyPersistedStyle()

app.mount('#app')

// mount 后启动后端装配；App 启动链 await 同一 Promise（幂等），失败由启动错误页承接
startBackendBoot().catch((err) => {
  console.error('[Tauri 端入口] 后端初始化失败:', err)
})

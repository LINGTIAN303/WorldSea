import { reactive } from 'vue'

/**
 * uiStore 桩（splash 构建专用）：SplashScreen 只消费 `bootState`（watch → 'ready' 时淡出 600ms）。
 * 壳在导航到 dsh 界面前调用 `window.__wsSplash.ready()` 触发淡出（导航仍由壳执行）；
 * 若未被调用则始终保持 'booting'（启动页停留至整页替换）。
 */
const state = reactive({
  bootState: 'booting' as 'booting' | 'ready' | 'error',
})

declare global {
  interface Window {
    __wsSplash?: { ready: () => void }
  }
}

window.__wsSplash = {
  ready: () => {
    state.bootState = 'ready'
  },
}

export function useUIStore() {
  return state
}

/**
 * splash/accent.ts — 启动页独立入口的强调色还原
 * ─────────────────────────────
 * 主应用的强调色引擎（entity-core useTheme）不随独立入口打包（uiStore 走桩），
 * 启动页原本永远停留在 theme.css 的靛蓝基准。此处在 Vue 挂载前同步读 localStorage
 * 还原用户强调色，注入与主应用同 id、同模板（accentPresets.accentCssBlock 单一真源）的
 * 浅/深双段规则——进度条 / 四角 HUD / 辉光 / Canvas 粒子 / 眼睛虹膜全部跟随。
 */
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_ID,
  accentCssBlock,
  type AccentPreset,
} from '@worldsea/entity-core/composables/accentPresets'

const ACCENT_ID_KEY = 'worldsea-theme'
const CUSTOM_ACCENT_KEY = 'worldsea-accent-custom'
const ACCENT_STYLE_ID = 'ws-accent-override'

/** 从 localStorage 解析当前强调色：custom 取量化锚点；未知 id / 缺失值回退默认（旧版遗留 id 的迁移在主应用加载后才发生） */
function resolveAccent(): AccentPreset | null {
  try {
    const id = localStorage.getItem(ACCENT_ID_KEY)
    if (id === 'custom') {
      const light = localStorage.getItem(CUSTOM_ACCENT_KEY)
      if (light) return { id: 'custom', label: '自定义', light }
    } else if (id) {
      const preset = ACCENT_PRESETS.find(a => a.id === id)
      if (preset) return preset
    }
  } catch {
    /* localStorage 不可用时走默认 */
  }
  return ACCENT_PRESETS.find(a => a.id === DEFAULT_ACCENT_ID) ?? null
}

/** 首帧前同步注入强调色规则；默认靛蓝不注入（theme.css 基准即靛蓝，与主应用行为一致） */
export function applySplashAccent(): void {
  const preset = resolveAccent()
  if (!preset || preset.id === DEFAULT_ACCENT_ID) return
  let el = document.getElementById(ACCENT_STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ACCENT_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = `:root { ${accentCssBlock(preset, 'light')}; }\n[data-theme='dark'] { ${accentCssBlock(preset, 'dark')}; }`
}

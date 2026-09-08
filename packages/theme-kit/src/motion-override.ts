/**
 * @worldsea/theme-kit - Motion Override Engine（动画风格覆盖：缓动/时长/motion-scale/关键帧/交互模式），详细见 docs/details/注释/packages/theme-kit/motion-override.md
 */

import type { MotionStyleConfig } from './types'

let _currentOverrides: MotionStyleConfig | null = null
const _injectedKeyframes = new Set<string>()
let _styleEl: HTMLStyleElement | null = null

function getStyleEl(): HTMLStyleElement {
  if (typeof document === 'undefined') {
    throw new Error('[theme-kit] motion-override: document is not available')
  }
  if (!_styleEl) {
    _styleEl = document.createElement('style')
    _styleEl.setAttribute('data-ws-theme', 'motion-overrides')
    document.head.appendChild(_styleEl)
  }
  return _styleEl
}

export function applyMotionOverrides(config: MotionStyleConfig): void {
  clearMotionOverrides()
  _currentOverrides = config
  const root = document.documentElement

  // 1. 缓动函数覆盖
  if (config.easingOverrides) {
    for (const [key, value] of Object.entries(config.easingOverrides)) {
      const cssVar = key.startsWith('--') ? key : `--${key}`
      root.style.setProperty(cssVar, value ?? null)
    }
  }

  // 2. 时长覆盖
  if (config.durationOverrides) {
    for (const [key, value] of Object.entries(config.durationOverrides)) {
      const cssVar = key.startsWith('--') ? key : `--${key}`
      root.style.setProperty(cssVar, value ?? null)
    }
  }

  // 3. motion-scale 覆盖
  if (config.motionScale !== undefined) {
    root.style.setProperty('--motion-scale', String(config.motionScale))
  }

  // 4. 自定义关键帧注入
  if (config.customKeyframes) {
    injectCustomKeyframes(config.customKeyframes)
  }

  // 5. 交互模式 CSS class
  if (config.interactionMode) {
    document.documentElement.setAttribute('data-interaction-mode', config.interactionMode)
  }
}

export function clearMotionOverrides(): void {
  if (!_currentOverrides) return
  const root = document.documentElement

  // 清除缓动
  if (_currentOverrides.easingOverrides) {
    for (const key of Object.keys(_currentOverrides.easingOverrides)) {
      const cssVar = key.startsWith('--') ? key : `--${key}`
      root.style.removeProperty(cssVar)
    }
  }
  // 清除时长
  if (_currentOverrides.durationOverrides) {
    for (const key of Object.keys(_currentOverrides.durationOverrides)) {
      const cssVar = key.startsWith('--') ? key : `--${key}`
      root.style.removeProperty(cssVar)
    }
  }
  // 清除 motion-scale
  root.style.removeProperty('--motion-scale')
  // 清除自定义关键帧
  if (_styleEl) _styleEl.textContent = ''
  _injectedKeyframes.clear()
  // 清除交互模式
  root.removeAttribute('data-interaction-mode')
  _currentOverrides = null
}

export function injectCustomKeyframes(keyframes: Record<string, string>): void {
  const el = getStyleEl()
  let css = ''
  for (const [name, body] of Object.entries(keyframes)) {
    if (_injectedKeyframes.has(name)) continue
    css += `@keyframes ${name} { ${body} }\n`
    _injectedKeyframes.add(name)
  }
  if (css) {
    el.textContent = (el.textContent || '') + css
  }
}

export function getCurrentMotionOverrides(): MotionStyleConfig | null {
  return _currentOverrides
}

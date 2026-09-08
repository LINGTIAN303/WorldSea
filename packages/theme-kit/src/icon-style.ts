/**
 * @worldsea/theme-kit - Icon Style Engine
 * 
 * 图标风格切换逻辑：
 * - 设置图标 CSS 变量（linecap/linejoin/stroke-width）
 * - 注入毛笔风格 SVG filter（brush 风格）
 * - 提供主题图标覆盖查询
 */

import type { IconStyleConfig, IconOverride } from './types'

let _currentStyle: IconStyleConfig | null = null
let _styleEl: HTMLStyleElement | null = null

function getStyleEl(): HTMLStyleElement {
  if (typeof document === 'undefined') {
    throw new Error('[theme-kit] icon-style: document is not available')
  }
  if (!_styleEl) {
    _styleEl = document.createElement('style')
    _styleEl.setAttribute('data-ws-theme', 'icon-style')
    document.head.appendChild(_styleEl)
  }
  return _styleEl
}

export function applyIconStyle(config: IconStyleConfig): void {
  clearIconStyle()
  _currentStyle = config

  const root = document.documentElement

  // 设置图标 CSS 变量
  if (config.strokeStyle) {
    const linecap = config.strokeStyle === 'square' ? 'square' : 'round'
    const linejoin = config.strokeStyle === 'square' ? 'miter' : 'round'
    root.style.setProperty('--icon-stroke-linecap', linecap)
    root.style.setProperty('--icon-stroke-linejoin', linejoin)
  }
  if (config.defaultStrokeWidth !== undefined) {
    root.style.setProperty('--icon-stroke-width', String(config.defaultStrokeWidth))
  }

  // 注入毛笔风格滤镜（brush 风格需要 SVG filter）
  if (config.strokeStyle === 'brush') {
    const el = getStyleEl()
    el.textContent = `
      /* 毛笔笔触风格：通过 SVG filter 模拟墨迹边缘 */
      .ws-icon--lucide,
      .ws-icon[data-custom-icon] {
        filter: url(#ws-ink-brush-filter);
      }
    `
    // 注入 SVG filter 到 body（如果还没有）
    if (!document.getElementById('ws-ink-brush-filter-svg')) {
      const svgFilter = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svgFilter.id = 'ws-ink-brush-filter-svg'
      svgFilter.setAttribute('width', '0')
      svgFilter.setAttribute('height', '0')
      svgFilter.style.position = 'absolute'
      svgFilter.style.width = '0'
      svgFilter.style.height = '0'
      svgFilter.innerHTML = `
        <defs>
          <filter id="ws-ink-brush-filter" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      `
      document.body.appendChild(svgFilter)
    }
  }
}

export function clearIconStyle(): void {
  if (!_currentStyle) return
  const root = document.documentElement
  root.style.removeProperty('--icon-stroke-linecap')
  root.style.removeProperty('--icon-stroke-linejoin')
  root.style.removeProperty('--icon-stroke-width')
  if (_styleEl) _styleEl.textContent = ''
  // 移除 SVG filter
  const svgFilter = document.getElementById('ws-ink-brush-filter-svg')
  if (svgFilter) svgFilter.remove()
  _currentStyle = null
}

/** 获取当前主题对某个图标的覆盖 */
export function getThemeIconOverride(iconName: string): IconOverride | null {
  if (!_currentStyle?.customIconMap) return null
  return _currentStyle.customIconMap[iconName] ?? null
}

/** 解析图标：优先返回主题覆盖，否则返回 null（让调用方 fallback 到 Lucide） */
export function resolveIconForTheme(iconName: string): IconOverride | null {
  return getThemeIconOverride(iconName)
}

export function getCurrentIconStyle(): IconStyleConfig | null {
  return _currentStyle
}

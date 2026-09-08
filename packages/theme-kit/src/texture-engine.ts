/**
 * @worldsea/theme-kit - Texture Engine
 * 
 * 纹理注入引擎：
 * - 通过 CSS 变量控制背景纹理
 * - 注入装饰元素 CSS 规则
 */

const TEXTURE_CSS_VARS = [
  '--texture-bg',
  '--texture-card',
  '--texture-button',
  '--texture-overlay',
] as const

let _styleEl: HTMLStyleElement | null = null

function getStyleEl(): HTMLStyleElement {
  if (typeof document === 'undefined') {
    throw new Error('[theme-kit] texture-engine: document is not available')
  }
  if (!_styleEl) {
    _styleEl = document.createElement('style')
    _styleEl.setAttribute('data-ws-theme', 'textures')
    document.head.appendChild(_styleEl)
  }
  return _styleEl
}

export function injectTextures(textures: {
  bgPattern?: string
  cardTexture?: string
  buttonTexture?: string
  overlayTexture?: string
}): void {
  const root = document.documentElement
  // 先清除旧的
  clearTextures()
  // 注入新的
  if (textures.bgPattern) root.style.setProperty('--texture-bg', textures.bgPattern)
  if (textures.cardTexture) root.style.setProperty('--texture-card', textures.cardTexture)
  if (textures.buttonTexture) root.style.setProperty('--texture-button', textures.buttonTexture)
  if (textures.overlayTexture) root.style.setProperty('--texture-overlay', textures.overlayTexture)
}

export function clearTextures(): void {
  const root = document.documentElement
  for (const v of TEXTURE_CSS_VARS) {
    root.style.removeProperty(v)
  }
  // 同时清除装饰元素
  if (_styleEl) _styleEl.textContent = ''
}

export function getTextureVars(): Record<string, string> {
  const root = document.documentElement
  const result: Record<string, string> = {}
  for (const v of TEXTURE_CSS_VARS) {
    const val = root.style.getPropertyValue(v).trim()
    if (val) result[v] = val
  }
  return result
}

/** 注入装饰元素的 CSS 规则 */
export function injectDecorationCSS(css: string): void {
  const el = getStyleEl()
  el.textContent = css
}

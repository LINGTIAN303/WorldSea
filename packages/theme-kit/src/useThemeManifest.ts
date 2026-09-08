/**
 * @worldsea/theme-kit - useThemeManifest Composable
 * 
 * 主题 Manifest 应用 composable：
 * - 在 setTheme() 后调用，应用纹理/图标/动画/组件覆盖
 * - 切换主题时自动清理上一个主题的效果
 */

import { getManifest } from './registry'
import { injectTextures, clearTextures, injectDecorationCSS } from './texture-engine'
import { applyIconStyle, clearIconStyle } from './icon-style'
import { applyMotionOverrides, clearMotionOverrides } from './motion-override'
import type { ThemeManifest, DecorativeElement, ComponentOverrides } from './types'

// 组件覆盖的 CSS 变量追踪
const _componentOverrideVars = new Map<string, Record<string, string>>()

export function useThemeManifest() {
  /**
   * 应用指定主题的完整 Manifest（纹理+图标+动画+装饰）。
   * 应在 useTheme.setTheme() 之后调用。
   */
  function applyManifest(themeId: string): void {
    // 先清除上一个主题的 Manifest 效果
    clearManifest()

    const manifest = getManifest(themeId)
    if (!manifest) return

    // 1. 形态令牌
    if (manifest.shapeTokens) {
      applyShapeTokens(manifest.shapeTokens)
    }

    // 2. 纹理
    if (manifest.textureTokens) {
      injectTextures({
        bgPattern: manifest.textureTokens.bgPattern,
        cardTexture: manifest.textureTokens.cardTexture,
        buttonTexture: manifest.textureTokens.buttonTexture,
        overlayTexture: manifest.textureTokens.overlayTexture,
      })
      // 装饰元素
      if (manifest.textureTokens.decorativeElements?.length) {
        injectDecorationElements(manifest.textureTokens.decorativeElements)
      }
    }

    // 3. 图标风格
    if (manifest.iconStyle) {
      applyIconStyle(manifest.iconStyle)
    }

    // 4. 动画风格
    if (manifest.motionStyle) {
      applyMotionOverrides(manifest.motionStyle)
      
      // 设置交互模式属性
      if (manifest.motionStyle.interactionMode) {
        document.documentElement.setAttribute('data-interaction-mode', manifest.motionStyle.interactionMode)
      }
    }

    // 5. 组件形态覆盖
    if (manifest.componentOverrides) {
      applyComponentOverrides(manifest.componentOverrides)
    }
  }

  /** 清除当前主题的所有 Manifest 效果 */
  function clearManifest(): void {
    clearShapeTokens()
    clearTextures()
    clearIconStyle()
    clearMotionOverrides()
    clearComponentOverrides()
    document.documentElement.removeAttribute('data-interaction-mode')
  }

  return { applyManifest, clearManifest }
}

// ─── 形态令牌应用 ───

const _shapeTokenVars: string[] = []

function applyShapeTokens(shapeTokens: NonNullable<ThemeManifest['shapeTokens']>): void {
  const root = document.documentElement

  // 圆角
  if (shapeTokens.radius) {
    for (const [key, value] of Object.entries(shapeTokens.radius)) {
      const cssVar = `--radius-${key}`
      root.style.setProperty(cssVar, value)
      _shapeTokenVars.push(cssVar)
    }
  }

  // 边框
  if (shapeTokens.border) {
    for (const [key, value] of Object.entries(shapeTokens.border)) {
      const cssVar = `--border-${key}`
      root.style.setProperty(cssVar, value)
      _shapeTokenVars.push(cssVar)
    }
  }

  // 阴影
  if (shapeTokens.shadow) {
    const shadowMap: Record<string, string> = {
      card: '--shadow-card',
      cardHover: '--shadow-card-hover',
      modal: '--shadow-modal',
      dropdown: '--shadow-dropdown',
      tooltip: '--shadow-tooltip',
    }
    for (const [key, value] of Object.entries(shapeTokens.shadow)) {
      const cssVar = shadowMap[key]
      if (cssVar) {
        root.style.setProperty(cssVar, value)
        _shapeTokenVars.push(cssVar)
      }
    }
  }
}

function clearShapeTokens(): void {
  const root = document.documentElement
  for (const v of _shapeTokenVars) {
    root.style.removeProperty(v)
  }
  _shapeTokenVars.length = 0
}

// ─── 装饰元素注入 ───

function injectDecorationElements(elements: DecorativeElement[]): void {
  let css = ''
  for (const el of elements) {
    if (el.svg) {
      const encoded = encodeURIComponent(el.svg)
      const positionStyles = getDecorationPositionStyles(el.position)
      css += `[data-decoration~="${el.position}"]::after {
        content: '';
        position: absolute;
        width: ${el.size};
        height: ${el.size};
        background: url("data:image/svg+xml,${encoded}") no-repeat center;
        background-size: contain;
        pointer-events: none;
        opacity: 0.6;
        ${positionStyles}
      }\n`
    }
  }
  if (css) injectDecorationCSS(css)
}

function getDecorationPositionStyles(position: string): string {
  const positions: Record<string, string> = {
    'card-top-right': 'top: 8px; right: 8px;',
    'card-top-left': 'top: 8px; left: 8px;',
    'card-bottom-right': 'bottom: 8px; right: 8px;',
    'card-bottom-left': 'bottom: 8px; left: 8px;',
    'modal-top-right': 'top: 12px; right: 12px;',
    'modal-top-left': 'top: 12px; left: 12px;',
    'sidebar-bottom': 'bottom: 12px; left: 50%; transform: translateX(-50%);',
  }
  return positions[position] || ''
}

// ─── 组件覆盖 ───

function applyComponentOverrides(overrides: ComponentOverrides): void {
  const root = document.documentElement
  for (const [component, preset] of Object.entries(overrides)) {
    if (preset.cssVars) {
      _componentOverrideVars.set(component, preset.cssVars)
      for (const [key, value] of Object.entries(preset.cssVars)) {
        root.style.setProperty(key, value as string)
      }
    }
  }
}

function clearComponentOverrides(): void {
  const root = document.documentElement
  for (const vars of _componentOverrideVars.values()) {
    for (const key of Object.keys(vars)) {
      root.style.removeProperty(key)
    }
  }
  _componentOverrideVars.clear()
}

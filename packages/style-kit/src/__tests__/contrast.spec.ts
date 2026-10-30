import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { READY_STYLE_IDS } from '../packs'

type RGB = { r: number; g: number; b: number; a: number }

function parseColor(raw: string): RGB | null {
  const value = raw.trim()
  const hex = value.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: 1 }
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/)
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] }
  }
  return null
}

function composite(fg: RGB, bg: RGB): RGB {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

function luminance({ r, g, b }: RGB): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function packCss(id: StyleId): string {
  return readFileSync(resolve(process.cwd(), `packages/style-kit/src/presets/${id}.css`), 'utf8')
}

function blockOf(css: string, id: StyleId, dark: boolean): string {
  const selector = dark ? `html[data-style='${id}'][data-theme='dark']` : `html[data-style='${id}']`
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return ''
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

function varOf(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  return match ? match[1].trim() : ''
}

describe('控件边界对比度', () => {
  for (const id of READY_STYLE_IDS) {
    for (const dark of [false, true]) {
      it(`${id} · ${dark ? 'dark' : 'light'} ≥ 3:1`, () => {
        const css = packCss(id)
        const light = blockOf(css, id, false)
        const block = dark ? blockOf(css, id, true) : light
        const pick = (name: string) => varOf(block, name) || varOf(light, name)
        const canvas = parseColor(pick('--sf-canvas-bg'))
        const controlBg = parseColor(pick('--sf-control-bg'))
        const controlEdge = parseColor(pick('--sf-control-edge'))
        expect(canvas, `${id} canvas`).not.toBeNull()
        expect(controlBg, `${id} control-bg`).not.toBeNull()
        expect(controlEdge, `${id} control-edge`).not.toBeNull()
        const surface = composite(controlBg!, canvas!)
        const edge = composite(controlEdge!, surface)
        expect(contrast(edge, surface), `${id} ${dark ? 'dark' : 'light'} 对比度不足`).toBeGreaterThanOrEqual(3)
      })
    }
  }
})

/**
 * 强调色 OKLCH 派生算法（2026-10-24 第一刀）：
 * 浅色锚点（人工定，过 AA 白字线）→ 深色主值 / 渐变末端类比色 / accent 面文字色全部算法派生。
 * sRGB ↔ OKLab 标准矩阵（Björn Ottosson）；OKLCH 下亮度/饱和/色相解耦，深浅派生与色相旋转感知均匀。
 */

export interface Oklch { l: number; c: number; h: number }

export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const v = s.length === 3 ? s.split('').map(ch => ch + ch).join('') : s
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255]
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.min(1, Math.max(0, v))
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    c: Math.sqrt(A * A + B * B),
    h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360,
  }
}

export function oklchToHex({ l, c, h }: Oklch): string {
  // 色度逐级回收防越域：在 gamma 前检查线性域（clamp 会偏色相），越域则降色度重算保持色相
  let chroma = c
  for (let i = 0; i < 12; i++) {
    const rad = h * Math.PI / 180
    const A = Math.cos(rad) * chroma
    const B = Math.sin(rad) * chroma
    const l_ = l + 0.3963377774 * A + 0.2158037573 * B
    const m_ = l - 0.1055613458 * A - 0.0638541728 * B
    const s_ = l - 0.0894841775 * A - 1.2914855480 * B
    const lr = l_ * l_ * l_, mg = m_ * m_ * m_, sb = s_ * s_ * s_
    const rl = 4.0767416621 * lr - 3.3077115913 * mg + 0.2309699292 * sb
    const gl = -1.2684380046 * lr + 2.6097574011 * mg - 0.3413193965 * sb
    const bl = -0.0041960863 * lr - 0.7034186147 * mg + 1.7076147010 * sb
    if (rl >= -1e-6 && rl <= 1 + 1e-6 && gl >= -1e-6 && gl <= 1 + 1e-6 && bl >= -1e-6 && bl <= 1 + 1e-6) {
      const r = linearToSrgb(rl), g = linearToSrgb(gl), b = linearToSrgb(bl)
      const to2 = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
      return `#${to2(r)}${to2(g)}${to2(b)}`
    }
    chroma *= 0.9
  }
  // 兜底：极端参数退化为对应中性灰（正常预设色相走不到这里）
  const g8 = Math.round(Math.min(1, Math.max(0, l)) * 255)
  const pad = g8.toString(16).padStart(2, '0')
  return `#${pad}${pad}${pad}`
}

/** WCAG 相对亮度与对比度 */
export function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a), lb = relLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 深色主值派生：亮度统一抬到 0.72~0.80 带（深底强调面的既定亮度带）、饱和降 30% 防荧光、色相保持 */
export function deriveDark(light: string): string {
  const { l, c, h } = hexToOklch(light)
  return oklchToHex({ l: Math.min(0.80, Math.max(l + 0.15, 0.72)), c: Math.min(c * 0.7, 0.14), h })
}

/** accent 面文字择向：与主值对比更高的一侧获胜（白 / 墨） */
export function pickOnAccent(main: string): string {
  const white = contrastRatio(main, '#ffffff')
  const ink = contrastRatio(main, '#17171b')
  return white >= ink ? '#ffffff' : '#17171b'
}

/** 渐变末端：类比色（色相 +16°、亮度 +0.031、饱和 ×1.072）——参数按靛蓝基准 #7c3aed 精确反推锚定，双色渐变语义全预设统一 */
export function deriveGradTo(main: string): string {
  const { l, c, h } = hexToOklch(main)
  return oklchToHex({ l: Math.min(l + 0.031, 0.92), c: Math.min(c * 1.072, 0.26), h: (h + 16) % 360 })
}

/**
 * 自定义强调色锚点合规化：亮度收进 [0.40, 0.56]、色相保持、色度上限 0.26。
 * 亮度带保证 accent 面白字恒 ≥4.5:1（--on-accent 语义稳定，danger 复用面零风险）；
 * 高明度黄绿类在上限处仍可能差线，逐级回退亮度直到过线。
 */
export function quantizeAnchor(hex: string): string {
  const { c, h } = hexToOklch(hex)
  let l = Math.min(0.56, Math.max(0.40, hexToOklch(hex).l))
  let out = oklchToHex({ l, c: Math.min(c, 0.26), h })
  let guard = 0
  while (contrastRatio(out, '#ffffff') < 4.5 && l > 0.30 && guard++ < 26) {
    l -= 0.01
    out = oklchToHex({ l, c: Math.min(c, 0.26), h })
  }
  return out
}

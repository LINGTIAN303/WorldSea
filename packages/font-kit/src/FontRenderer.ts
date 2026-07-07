import { FONT_FAMILY_VALUES, type FontCategoryToken, type FontSizeToken, FONT_SIZE_VALUES, type FontWeightToken, FONT_WEIGHT_VALUES, type LineHeightToken, LINE_HEIGHT_VALUES, type LetterSpacingToken, LETTER_SPACING_VALUES } from './tokens'

export type ImageFormat = 'png' | 'jpeg' | 'webp'

export interface TextRenderOptions {
  text: string
  fontFamily?: string
  fontCategory?: FontCategoryToken
  fontSize?: FontSizeToken | number
  fontWeight?: FontWeightToken | number
  lineHeight?: LineHeightToken | number
  letterSpacing?: LetterSpacingToken | string
  color?: string
  backgroundColor?: string
  backgroundImage?: CanvasImageSource
  backgroundPosition?: 'cover' | 'contain' | 'stretch'
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number }
  maxWidth?: number
  textAlign?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  devicePixelRatio?: number
  writingMode?: 'horizontal' | 'vertical'
  textShadow?: string
}

export interface RenderResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

function resolveFontFamily(opts: TextRenderOptions): string {
  if (opts.fontFamily) return opts.fontFamily
  const cat = opts.fontCategory ?? 'base'
  return FONT_FAMILY_VALUES[cat]
}

function resolveFontSize(v: FontSizeToken | number | undefined): number {
  if (v === undefined) return FONT_SIZE_VALUES.base
  if (typeof v === 'number') return v
  return FONT_SIZE_VALUES[v]
}

function resolveFontWeight(v: FontWeightToken | number | undefined): number {
  if (v === undefined) return FONT_WEIGHT_VALUES.normal
  if (typeof v === 'number') return v
  return FONT_WEIGHT_VALUES[v]
}

function resolveLineHeight(v: LineHeightToken | number | undefined): number {
  if (v === undefined) return LINE_HEIGHT_VALUES.normal
  if (typeof v === 'number') return v
  return LINE_HEIGHT_VALUES[v]
}

function resolveLetterSpacing(v: LetterSpacingToken | string | undefined): string {
  if (v === undefined) return LETTER_SPACING_VALUES.normal
  if (typeof v === 'string' && v in LETTER_SPACING_VALUES) return LETTER_SPACING_VALUES[v as LetterSpacingToken]
  return v as string
}

function resolvePadding(p: TextRenderOptions['padding']): { top: number; right: number; bottom: number; left: number } {
  if (p === undefined) return { top: 16, right: 16, bottom: 16, left: 16 }
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p }
  return { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 }
}

function buildFontString(family: string, size: number, weight: number): string {
  return `${weight} ${size}px ${family}`
}

/** 以 cover 模式绘制背景图（居中裁剪，保持比例） */
export function drawImageCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, dstW: number, dstH: number) {
  const [srcW, srcH] = img instanceof HTMLVideoElement
    ? [img.videoWidth, img.videoHeight]
    : img instanceof HTMLImageElement
      ? [img.naturalWidth, img.naturalHeight]
      : [(img as HTMLCanvasElement).width, (img as HTMLCanvasElement).height]
  if (!srcW || !srcH) { ctx.drawImage(img, 0, 0, dstW, dstH); return }
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const sw = srcW * scale, sh = srcH * scale
  const sx = (sw - dstW) / 2, sy = (sh - dstH) / 2
  ctx.drawImage(img, -sx, -sy, sw, sh)
}

/** 以 contain 模式绘制背景图（居中完整显示，留白） */
export function drawImageContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource, dstW: number, dstH: number) {
  const [srcW, srcH] = img instanceof HTMLVideoElement
    ? [img.videoWidth, img.videoHeight]
    : img instanceof HTMLImageElement
      ? [img.naturalWidth, img.naturalHeight]
      : [(img as HTMLCanvasElement).width, (img as HTMLCanvasElement).height]
  if (!srcW || !srcH) { ctx.drawImage(img, 0, 0, dstW, dstH); return }
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const sw = srcW * scale, sh = srcH * scale
  const dx = (dstW - sw) / 2, dy = (dstH - sh) / 2
  ctx.drawImage(img, dx, dy, sw, sh)
}

/** 解析 CSS text-shadow 首条阴影，设置 canvas shadow 属性，返回 cleanup 函数 */
export function applyTextShadow(ctx: CanvasRenderingContext2D, shadow: string | undefined): () => void {
  if (!shadow || shadow === 'none') return () => {}
  // 取第一条阴影：只分割顶层逗号（避开 rgba 括号内逗号）
  let first = shadow.trim()
  let depth = 0
  for (let i = 0; i < shadow.length; i++) {
    const ch = shadow[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { first = shadow.slice(0, i).trim(); break }
  }
  const m = first.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(.+)/)
  if (!m) return () => {}
  ctx.shadowOffsetX = parseFloat(m[1])
  ctx.shadowOffsetY = parseFloat(m[2])
  ctx.shadowBlur = parseFloat(m[3])
  ctx.shadowColor = m[4].trim()
  return () => {
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
  }
}

// ── 横排测量 ────────────────────────────────────────────

export function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: TextRenderOptions,
): { width: number; height: number; lines: string[] } {
  const fontSize = resolveFontSize(opts.fontSize)
  const fontWeight = resolveFontWeight(opts.fontWeight)
  const lineHeight = resolveLineHeight(opts.lineHeight)
  const letterSpacing = resolveLetterSpacing(opts.letterSpacing)
  const family = resolveFontFamily(opts)

  ctx.font = buildFontString(family, fontSize, fontWeight)

  const lineH = fontSize * lineHeight
  const maxWidth = opts.maxWidth ?? Infinity
  const lines: string[] = []

  if (maxWidth === Infinity) {
    lines.push(...text.split('\n'))
  } else {
    const paragraphs = text.split('\n')
    for (const para of paragraphs) {
      if (para === '') { lines.push(''); continue }
      let remaining = para
      while (remaining.length > 0) {
        let breakIdx = remaining.length
        while (breakIdx > 0) {
          const testLine = remaining.slice(0, breakIdx)
          const metrics = ctx.measureText(testLine)
          const lsPx = parseFloat(letterSpacing) * testLine.length || 0
          if (metrics.width + lsPx <= maxWidth) break
          breakIdx--
        }
        if (breakIdx === 0) breakIdx = 1
        lines.push(remaining.slice(0, breakIdx))
        remaining = remaining.slice(breakIdx)
      }
    }
  }

  const lsPx = parseFloat(letterSpacing)
  const lsIsEm = letterSpacing.includes('em')
  const lsPxPerChar = lsIsEm ? lsPx * fontSize : lsPx

  let maxLineWidth = 0
  for (const line of lines) {
    const metrics = ctx.measureText(line)
    const lsTotal = isFinite(lsPxPerChar) ? lsPxPerChar * Math.max(0, line.length - 1) : 0
    maxLineWidth = Math.max(maxLineWidth, metrics.width + lsTotal)
  }

  return {
    width: maxLineWidth,
    height: lines.length * lineH,
    lines,
  }
}

// ── 竖排测量 ────────────────────────────────────────────

interface VerticalMeasureResult {
  columns: string[][]
  width: number
  height: number
  charHeight: number
  columnWidth: number
}

function measureTextVertical(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: TextRenderOptions,
): VerticalMeasureResult {
  const fontSize = resolveFontSize(opts.fontSize)
  const fontWeight = resolveFontWeight(opts.fontWeight)
  const lineHeight = resolveLineHeight(opts.lineHeight)
  const family = resolveFontFamily(opts)
  ctx.font = buildFontString(family, fontSize, fontWeight)

  const charHeight = fontSize * lineHeight
  const columnCharWidth = fontSize * 1.2
  // maxWidth 在竖排中当作"列高"约束
  const maxColHeight = (opts.maxWidth ?? 600) - resolvePadding(opts.padding).top - resolvePadding(opts.padding).bottom
  const maxCharsPerCol = Math.max(1, Math.floor(maxColHeight / charHeight))

  const chars = [...text]
  const columns: string[][] = []
  let col: string[] = []

  for (const ch of chars) {
    if (ch === '\n') {
      if (col.length > 0 || columns.length > 0) { columns.push(col); col = [] }
      continue
    }
    if (col.length >= maxCharsPerCol) { columns.push(col); col = [] }
    col.push(ch)
  }
  if (col.length > 0) columns.push(col)

  const padding = resolvePadding(opts.padding)
  const totalWidth = columns.length * columnCharWidth + padding.left + padding.right
  const totalHeight = Math.min(chars.length * charHeight, maxColHeight) + padding.top + padding.bottom

  return { columns, width: totalWidth, height: totalHeight, charHeight, columnWidth: columnCharWidth }
}

// ── 渲染入口 ────────────────────────────────────────────

export function renderText(opts: TextRenderOptions): RenderResult {
  if (typeof document === 'undefined') {
    throw new Error('FontRenderer requires a browser environment')
  }

  const dpr = opts.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1)
  const padding = resolvePadding(opts.padding)
  const isVertical = opts.writingMode === 'vertical'

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  let cssWidth: number, cssHeight: number
  let renderBlock: () => void

  if (isVertical) {
    const vm = measureTextVertical(ctx, opts.text, opts)
    cssWidth = Math.ceil(vm.width)
    cssHeight = Math.ceil(vm.height)

    canvas.width = Math.ceil(cssWidth * dpr)
    canvas.height = Math.ceil(cssHeight * dpr)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
    ctx.scale(dpr, dpr)

    renderBlock = () => {
      if (opts.backgroundImage) {
        const pos = opts.backgroundPosition ?? 'cover'
        if (pos === 'cover') drawImageCover(ctx, opts.backgroundImage, cssWidth, cssHeight)
        else if (pos === 'contain') drawImageContain(ctx, opts.backgroundImage, cssWidth, cssHeight)
        else ctx.drawImage(opts.backgroundImage, 0, 0, cssWidth, cssHeight)
      } else if (opts.backgroundColor) {
        ctx.fillStyle = opts.backgroundColor
        ctx.fillRect(0, 0, cssWidth, cssHeight)
      }

      const fontSize = resolveFontSize(opts.fontSize)
      const fontWeight = resolveFontWeight(opts.fontWeight)
      const family = resolveFontFamily(opts)
      ctx.font = buildFontString(family, fontSize, fontWeight)
      ctx.fillStyle = opts.color ?? '#000000'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const lsPx = parseFloat(resolveLetterSpacing(opts.letterSpacing))
      const lsIsEm = (opts.letterSpacing ?? '').includes('em')
      const lsPxPerChar = lsIsEm ? lsPx * fontSize : lsPx

      const cleanup = applyTextShadow(ctx, opts.textShadow)
      const { columns, charHeight, columnWidth } = vm

      const maxColLen = columns.reduce((a, c) => Math.max(a, c.length), 0)
      const contentH = maxColLen * (charHeight + (isFinite(lsPxPerChar) ? lsPxPerChar : 0)) - (isFinite(lsPxPerChar) ? lsPxPerChar : 0)
      const availH = cssHeight - padding.top - padding.bottom
      let yOffset = padding.top
      const va = opts.textAlign ?? 'left'
      if (va === 'center') yOffset = padding.top + Math.max(0, (availH - contentH) / 2)
      else if (va === 'right') yOffset = padding.top + Math.max(0, availH - contentH)

      for (let ci = 0; ci < columns.length; ci++) {
        const col = columns[ci]
        const cx = cssWidth - padding.right - (ci + 0.5) * columnWidth
        const ySpacing = charHeight + (isFinite(lsPxPerChar) ? lsPxPerChar : 0)
        for (let ri = 0; ri < col.length; ri++) {
          const cy = yOffset + ri * ySpacing + charHeight / 2
          ctx.fillText(col[ri], cx, cy)
        }
      }
      cleanup()
    }
  } else {
    const measurement = measureText(ctx, opts.text, opts)
    cssWidth = Math.ceil(measurement.width) + padding.left + padding.right
    cssHeight = Math.ceil(measurement.height) + padding.top + padding.bottom

    canvas.width = Math.ceil(cssWidth * dpr)
    canvas.height = Math.ceil(cssHeight * dpr)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
    ctx.scale(dpr, dpr)

    renderBlock = () => {
      if (opts.backgroundImage) {
        const pos = opts.backgroundPosition ?? 'cover'
        if (pos === 'cover') drawImageCover(ctx, opts.backgroundImage, cssWidth, cssHeight)
        else if (pos === 'contain') drawImageContain(ctx, opts.backgroundImage, cssWidth, cssHeight)
        else ctx.drawImage(opts.backgroundImage, 0, 0, cssWidth, cssHeight)
      } else if (opts.backgroundColor) {
        ctx.fillStyle = opts.backgroundColor
        ctx.fillRect(0, 0, cssWidth, cssHeight)
      }

      const fontSize = resolveFontSize(opts.fontSize)
      const fontWeight = resolveFontWeight(opts.fontWeight)
      const lineHeight = resolveLineHeight(opts.lineHeight)
      const letterSpacing = resolveLetterSpacing(opts.letterSpacing)
      const family = resolveFontFamily(opts)
      ctx.font = buildFontString(family, fontSize, fontWeight)
      ctx.fillStyle = opts.color ?? '#000000'
      ctx.textAlign = opts.textAlign ?? 'left'
      ctx.textBaseline = opts.baseline ?? 'top'

      const cleanup = applyTextShadow(ctx, opts.textShadow)
      const lineH = fontSize * lineHeight
      const lsPx = parseFloat(letterSpacing)
      const lsIsEm = letterSpacing.includes('em')
      const lsPxPerChar = lsIsEm ? lsPx * fontSize : lsPx

      for (let i = 0; i < measurement.lines.length; i++) {
        const line = measurement.lines[i]
        const y = padding.top + i * lineH
        if (lsPxPerChar !== 0 && isFinite(lsPxPerChar)) {
          let x = padding.left
          for (const ch of line) {
            ctx.fillText(ch, x, y)
            x += ctx.measureText(ch).width + lsPxPerChar
          }
        } else {
          ctx.fillText(line, padding.left, y)
        }
      }
      cleanup()
    }
  }

  renderBlock()
  return { canvas, width: cssWidth, height: cssHeight }
}

export function toBlob(canvas: HTMLCanvasElement, format: ImageFormat = 'png', quality?: number): Promise<Blob> {
  const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      mimeType,
      quality,
    )
  })
}

export function toDataURL(canvas: HTMLCanvasElement, format: ImageFormat = 'png', quality?: number): string {
  const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  return canvas.toDataURL(mimeType, quality)
}

import {
  renderText,
  drawImageCover,
  drawImageContain,
  applyTextShadow,
  type TextRenderOptions,
} from './FontRenderer'

export type TextAnimationEffect =
  | 'fadeIn'
  | 'slideIn'
  | 'typewriter'
  | 'pulse'
  | 'bounce'
  | 'wave'

export interface AnimatedTextOptions {
  text: string
  effect: TextAnimationEffect
  renderOptions: Omit<TextRenderOptions, 'text'>
  fps?: number
  duration?: number
}

export interface AnimatedTextFrame {
  imageData: ImageData
  delay: number
  width: number
  height: number
}

export interface AnimatedTextResult {
  frames: AnimatedTextFrame[]
  width: number
  height: number
  duration: number
  effect: TextAnimationEffect
}

/** 每帧清空并绘制背景 + 文字效果 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  effect: TextAnimationEffect,
  progress: number,
  text: string,
  opts: TextRenderOptions,
  w: number,
  h: number,
): void {
  const paddingInput = typeof opts.padding === 'number'
    ? { top: opts.padding, right: opts.padding, bottom: opts.padding, left: opts.padding }
    : opts.padding ?? {}
  const padding = {
    top: paddingInput.top ?? 16,
    right: paddingInput.right ?? 16,
    bottom: paddingInput.bottom ?? 16,
    left: paddingInput.left ?? 16,
  }

  // 每帧先清空，再画背景（避免帧间残影累积）
  ctx.clearRect(0, 0, w, h)
  if (opts.backgroundImage) {
    const pos = opts.backgroundPosition ?? 'cover'
    if (pos === 'contain') drawImageContain(ctx, opts.backgroundImage, w, h)
    else drawImageCover(ctx, opts.backgroundImage, w, h)
  } else if (opts.backgroundColor) {
    ctx.fillStyle = opts.backgroundColor
    ctx.fillRect(0, 0, w, h)
  }

  const fontSize = typeof opts.fontSize === 'number' ? opts.fontSize : 14
  const fontWeight = typeof opts.fontWeight === 'number' ? opts.fontWeight : 400
  const family = opts.fontFamily ?? "'Inter', 'Segoe UI', system-ui, sans-serif"

  ctx.font = `${fontWeight} ${fontSize}px ${family}`
  ctx.textBaseline = 'top'

  const cleanupShadow = applyTextShadow(ctx, opts.textShadow)

  const lines = text.split('\n')
  const lineH = fontSize * (typeof opts.lineHeight === 'number' ? opts.lineHeight : 1.5)

  switch (effect) {
    case 'fadeIn': {
      ctx.globalAlpha = progress
      ctx.fillStyle = opts.color ?? '#000000'
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], padding.left, padding.top + i * lineH)
      }
      ctx.globalAlpha = 1
      break
    }
    case 'slideIn': {
      const offsetX = (1 - progress) * 24
      ctx.globalAlpha = progress
      ctx.fillStyle = opts.color ?? '#000000'
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], padding.left + offsetX, padding.top + i * lineH)
      }
      ctx.globalAlpha = 1
      break
    }
    case 'typewriter': {
      const totalChars = text.replace(/\n/g, '').length
      const visibleChars = Math.round(progress * totalChars)
      ctx.fillStyle = opts.color ?? '#000000'
      let charCount = 0
      for (let i = 0; i < lines.length; i++) {
        let lineText = ''
        for (const ch of lines[i]) {
          if (charCount >= visibleChars) break
          lineText += ch
          charCount++
        }
        ctx.fillText(lineText, padding.left, padding.top + i * lineH)
        if (charCount >= visibleChars) break
      }
      break
    }
    case 'pulse': {
      const scale = 1 + Math.sin(progress * Math.PI * 2) * 0.05
      const cx = w / 2
      const cy = h / 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(scale, scale)
      ctx.translate(-cx, -cy)
      ctx.fillStyle = opts.color ?? '#000000'
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], padding.left, padding.top + i * lineH)
      }
      ctx.restore()
      break
    }
    case 'bounce': {
      const bounceY = -Math.abs(Math.sin(progress * Math.PI)) * 8
      ctx.fillStyle = opts.color ?? '#000000'
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], padding.left, padding.top + i * lineH + bounceY)
      }
      break
    }
    case 'wave': {
      ctx.fillStyle = opts.color ?? '#000000'
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        let x = padding.left
        for (let c = 0; c < line.length; c++) {
          const waveY = Math.sin((progress * Math.PI * 2) + c * 0.5) * 4
          ctx.fillText(line[c], x, padding.top + i * lineH + waveY)
          x += ctx.measureText(line[c]).width
        }
      }
      break
    }
  }

  cleanupShadow()
}

export function renderAnimatedText(opts: AnimatedTextOptions): AnimatedTextResult {
  const durationMs = opts.duration ?? 350
  const fps = opts.fps ?? 30
  const totalFrames = Math.max(1, Math.round(durationMs / 1000 * fps))
  const delay = Math.round(1000 / fps)

  const baseResult = renderText({ ...opts.renderOptions, text: opts.text })
  const dpr = opts.renderOptions.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1)
  const cssW = baseResult.width
  const cssH = baseResult.height

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(cssW * dpr)
  canvas.height = Math.ceil(cssH * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const fullOpts: TextRenderOptions = { ...opts.renderOptions, text: opts.text }

  const frames: AnimatedTextFrame[] = []
  for (let i = 0; i < totalFrames; i++) {
    const progress = totalFrames > 1 ? i / (totalFrames - 1) : 1
    drawFrame(ctx, opts.effect, progress, opts.text, fullOpts, cssW, cssH)
    frames.push({
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      delay,
      width: canvas.width,
      height: canvas.height,
    })
  }

  return { frames, width: canvas.width, height: canvas.height, duration: durationMs, effect: opts.effect }
}

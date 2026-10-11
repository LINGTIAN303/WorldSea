import { DURATION_VALUES, type DurationToken } from './tokens'

export interface CaptureFrame {
  imageData: ImageData
  delay: number
  width: number
  height: number
}

export interface CaptureOptions {
  duration?: DurationToken | number
  fps?: number
  width?: number
  height?: number
}

export interface CaptureResult {
  frames: CaptureFrame[]
  width: number
  height: number
  duration: number
}

function resolveMs(d: DurationToken | number | undefined): number {
  if (d === undefined) return DURATION_VALUES.slow
  if (typeof d === 'number') return d
  return DURATION_VALUES[d]
}

export function captureFromCanvas(
  source: HTMLCanvasElement,
  renderFrame: (ctx: CanvasRenderingContext2D, progress: number, frameIndex: number) => void,
  options?: CaptureOptions,
): CaptureResult {
  const durationMs = resolveMs(options?.duration)
  const fps = options?.fps ?? 30
  const totalFrames = Math.max(1, Math.round(durationMs / 1000 * fps))
  const w = options?.width ?? source.width
  const h = options?.height ?? source.height

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  const frames: CaptureFrame[] = []
  const delay = Math.round(1000 / fps)

  for (let i = 0; i < totalFrames; i++) {
    const progress = totalFrames > 1 ? i / (totalFrames - 1) : 1
    ctx.clearRect(0, 0, w, h)
    renderFrame(ctx, progress, i)
    const imageData = ctx.getImageData(0, 0, w, h)
    frames.push({
      imageData,
      delay,
      width: w,
      height: h,
    })
  }

  return { frames, width: w, height: h, duration: durationMs }
}

export function captureFromElement(
  el: HTMLElement,
  options?: CaptureOptions,
): CaptureResult {
  const durationMs = resolveMs(options?.duration)
  const fps = options?.fps ?? 30
  const totalFrames = Math.max(1, Math.round(durationMs / 1000 * fps))
  const rect = el.getBoundingClientRect()
  const w = options?.width ?? Math.round(rect.width)
  const h = options?.height ?? Math.round(rect.height)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  const frames: CaptureFrame[] = []
  const delay = Math.round(1000 / fps)

  const anim = el.animate([
    { opacity: 0, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], {
    duration: durationMs,
    fill: 'forwards',
  })

  anim.pause()

  for (let i = 0; i < totalFrames; i++) {
    const time = totalFrames > 1 ? (i / (totalFrames - 1)) * durationMs : durationMs
    anim.currentTime = time

    ctx.clearRect(0, 0, w, h)
    const htmlEl = el as HTMLElement
    if ('draw' in htmlEl) {
      (htmlEl as any).draw(ctx)
    }

    frames.push({
      imageData: ctx.getImageData(0, 0, w, h),
      delay,
      width: w,
      height: h,
    })
  }

  anim.cancel()

  return { frames, width: w, height: h, duration: durationMs }
}

export function framesToImageDataArray(frames: CaptureFrame[]): ImageData[] {
  return frames.map(f => f.imageData)
}

import { ref, readonly } from 'vue'
import {
  captureFromCanvas,
  type CaptureFrame,
  type CaptureOptions,
  type CaptureResult,
} from '../FrameCapture'
import {
  encodeGif,
  gifFrameFromCanvas,
  type GifFrame,
  type GifEncodeOptions,
} from '../GifEncoder'

export type { CaptureFrame, CaptureOptions, CaptureResult }
export type { GifFrame, GifEncodeOptions }

export interface UseAnimationCaptureReturn {
  capturing: ReturnType<typeof readonly<ReturnType<typeof ref<boolean>>>>
  progress: ReturnType<typeof readonly<ReturnType<typeof ref<number>>>>
  frameCount: ReturnType<typeof readonly<ReturnType<typeof ref<number>>>>
  lastResult: CaptureResult | null
  capture: (
    source: HTMLCanvasElement,
    renderFrame: (ctx: CanvasRenderingContext2D, progress: number, frameIndex: number) => void,
    options?: CaptureOptions,
  ) => CaptureResult
  captureToGif: (
    source: HTMLCanvasElement,
    renderFrame: (ctx: CanvasRenderingContext2D, progress: number, frameIndex: number) => void,
    options?: CaptureOptions,
    gifOptions?: Partial<GifEncodeOptions>,
  ) => Blob
  framesToGif: (frames: CaptureFrame[], width: number, height: number, loop?: number) => Blob
  stop: () => void
}

export function useAnimationCapture(): UseAnimationCaptureReturn {
  const capturing = ref(false)
  const progress = ref(0)
  const frameCount = ref(0)
  let _lastResult: CaptureResult | null = null

  function capture(
    source: HTMLCanvasElement,
    renderFrame: (ctx: CanvasRenderingContext2D, progress: number, frameIndex: number) => void,
    options?: CaptureOptions,
  ): CaptureResult {
    capturing.value = true
    progress.value = 0
    frameCount.value = 0

    const result = captureFromCanvas(source, renderFrame, options)
    _lastResult = result

    capturing.value = false
    progress.value = 1
    frameCount.value = result.frames.length
    return result
  }

  function captureToGif(
    source: HTMLCanvasElement,
    renderFrame: (ctx: CanvasRenderingContext2D, progress: number, frameIndex: number) => void,
    options?: CaptureOptions,
    gifOptions?: Partial<GifEncodeOptions>,
  ): Blob {
    const result = capture(source, renderFrame, options)
    return framesToGif(result.frames, result.width, result.height, gifOptions?.loop)
  }

  function framesToGif(frames: CaptureFrame[], width: number, height: number, loop: number = 0): Blob {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    const gifFrames: GifFrame[] = frames.map(f => {
      ctx.clearRect(0, 0, width, height)
      ctx.putImageData(f.imageData, 0, 0)
      return gifFrameFromCanvas(canvas, f.delay)
    })

    const data = encodeGif({ width, height, frames: gifFrames, loop })
    return new Blob([data], { type: 'image/gif' })
  }

  function stop() {
    capturing.value = false
  }

  return {
    capturing: readonly(capturing),
    progress: readonly(progress),
    frameCount: readonly(frameCount),
    get lastResult() { return _lastResult },
    capture,
    captureToGif,
    framesToGif,
    stop,
  }
}

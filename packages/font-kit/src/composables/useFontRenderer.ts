import { ref, readonly, onScopeDispose, getCurrentScope } from 'vue'
import {
  type TextRenderOptions,
  type ImageFormat,
  type RenderResult,
  renderText,
  toBlob,
  toDataURL,
  measureText,
} from '../FontRenderer'

export type { TextRenderOptions, ImageFormat, RenderResult }

export interface UseFontRendererReturn {
  lastResult: ReturnType<typeof readonly<ReturnType<typeof ref<RenderResult | null>>>>
  rendering: ReturnType<typeof readonly<ReturnType<typeof ref<boolean>>>>
  render: (opts: TextRenderOptions) => RenderResult
  measure: (opts: TextRenderOptions) => { width: number; height: number; lines: string[] }
  exportBlob: (format?: ImageFormat, quality?: number) => Promise<Blob | null>
  exportDataURL: (format?: ImageFormat, quality?: number) => string | null
}

export function useFontRenderer(): UseFontRendererReturn {
  const lastResult = ref<RenderResult | null>(null)
  const rendering = ref(false)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      lastResult.value = null
    })
  }

  function render(opts: TextRenderOptions): RenderResult {
    rendering.value = true
    try {
      const result = renderText(opts)
      lastResult.value = result
      return result
    } finally {
      rendering.value = false
    }
  }

  function measure(opts: TextRenderOptions) {
    if (typeof document === 'undefined') {
      return { width: 0, height: 0, lines: [] }
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    return measureText(ctx, opts.text, opts)
  }

  async function exportBlob(format: ImageFormat = 'png', quality?: number): Promise<Blob | null> {
    if (!lastResult.value) return null
    return toBlob(lastResult.value.canvas, format, quality)
  }

  function exportDataURL(format: ImageFormat = 'png', quality?: number): string | null {
    if (!lastResult.value) return null
    return toDataURL(lastResult.value.canvas, format, quality)
  }

  return {
    lastResult: readonly(lastResult),
    rendering: readonly(rendering),
    render,
    measure,
    exportBlob,
    exportDataURL,
  }
}

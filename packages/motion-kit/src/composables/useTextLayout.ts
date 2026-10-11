import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { PreparedText } from '@chenglou/pretext'

export interface TextLayoutResult {
  height: number
  lineCount: number
}

export interface UseTextLayoutReturn {
  measure: (text: string, font: string, maxWidth: number, lineHeight: number) => TextLayoutResult
  measureReactive: (
    text: Ref<string>,
    font: string,
    maxWidth: Ref<number>,
    lineHeight: number,
  ) => Ref<TextLayoutResult>
  isAvailable: Ref<boolean>
}

type PrepareFn = (text: string, font: string, options?: Record<string, unknown>) => PreparedText
type LayoutFn = (prepared: PreparedText, maxWidth: number, lineHeight: number) => TextLayoutResult

let _prepareFn: PrepareFn | null = null
let _layoutFn: LayoutFn | null = null
let _loadAttempted = false
let _pretextAvailable = false

async function ensurePretext(): Promise<boolean> {
  if (_pretextAvailable) return true
  if (_loadAttempted) return false
  _loadAttempted = true
  try {
    const mod = await import('@chenglou/pretext')
    _prepareFn = mod.prepare as PrepareFn
    _layoutFn = mod.layout as LayoutFn
    _pretextAvailable = true
    return true
  } catch {
    return false
  }
}

function fallbackMeasure(text: string, font: string, maxWidth: number, lineHeight: number): TextLayoutResult {
  if (typeof document === 'undefined') return { height: 0, lineCount: 0 }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return { height: 0, lineCount: 0 }

  ctx.font = font
  const lines: string[] = []
  const paragraphs = text.split('\n')

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    const words = paragraph.split(/\s+/)
    let currentLine = ''
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const metrics = ctx.measureText(testLine)
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)
  }

  const lineCount = lines.length || 1
  return { height: lineCount * lineHeight, lineCount }
}

export function useTextLayout(): UseTextLayoutReturn {
  const isAvailable = ref(false)

  ensurePretext().then(ok => { isAvailable.value = ok })

  function measure(
    text: string,
    font: string,
    maxWidth: number,
    lineHeight: number,
  ): TextLayoutResult {
    if (_pretextAvailable && _prepareFn && _layoutFn) {
      try {
        const prepared = _prepareFn(text, font)
        const result = _layoutFn(prepared, maxWidth, lineHeight)
        isAvailable.value = true
        return result
      } catch {
        isAvailable.value = false
      }
    }
    return fallbackMeasure(text, font, maxWidth, lineHeight)
  }

  function measureReactive(
    text: Ref<string>,
    font: string,
    maxWidth: Ref<number>,
    lineHeight: number,
  ): Ref<TextLayoutResult> {
    const result = ref<TextLayoutResult>(
      measure(text.value, font, maxWidth.value, lineHeight),
    )

    const stopWatch = watch(
      [text, maxWidth],
      () => {
        result.value = measure(text.value, font, maxWidth.value, lineHeight)
      },
      { flush: 'post' },
    )

    onUnmounted(() => {
      stopWatch()
    })

    return result
  }

  return { measure, measureReactive, isAvailable }
}

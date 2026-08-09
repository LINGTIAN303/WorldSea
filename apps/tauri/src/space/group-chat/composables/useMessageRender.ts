import { ref } from 'vue'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const marked = new Marked({ gfm: true, breaks: true })

function renderMd(text: string): string {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text) as string)
}

function stripJsonBlocks(text: string): string {
  const mdParts: string[] = []
  let lastEnd = 0
  let i = 0
  while (i < text.length) {
    if (text[i] === '{') {
      const jsonStr = tryExtractJson(text, i)
      if (jsonStr) {
        if (i > lastEnd) mdParts.push(text.slice(lastEnd, i))
        lastEnd = i + jsonStr.length
        i = lastEnd
        continue
      }
    }
    i++
  }
  if (lastEnd < text.length) mdParts.push(text.slice(lastEnd))
  return mdParts.map(s => s.trim()).filter(Boolean).join('\n')
}

function tryExtractJson(text: string, start: number): string | null {
  if (text[start] !== '{') return null
  let depth = 0
  let j = start
  let inStr = false
  let esc = false
  while (j < text.length) {
    const ch = text[j]
    if (esc) { esc = false; j++; continue }
    if (ch === '\\' && inStr) { esc = true; j++; continue }
    if (ch === '"') { inStr = !inStr; j++; continue }
    if (!inStr) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const str = text.slice(start, j + 1)
          try {
            const obj = JSON.parse(str)
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return str
          } catch {}
          return null
        }
      }
    }
    j++
  }
  return null
}

export function useMessageRender() {
  function renderContent(content: string): string {
    if (!content) return ''
    const filtered = stripJsonBlocks(content.trim())
    return filtered ? renderMd(filtered) : ''
  }

  function renderPlainText(content: string): string {
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
  }

  function isTextLong(content: string): boolean {
    if (!content) return false
    const lines = content.split('\n').length
    const charLen = content.length
    return lines > 8 || charLen > 600
  }

  const textExpanded = ref(false)

  return {
    renderContent,
    renderPlainText,
    isTextLong,
    textExpanded,
  }
}
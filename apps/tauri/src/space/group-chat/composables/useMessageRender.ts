import { ref } from 'vue'
import { renderMarkdownHtml, stripJsonBlocks } from '@worldsmith/shared-ui/agent/bubbles'

/**
 * 群聊消息 Markdown 渲染（统一走 shared-ui 渲染链路：代码块外壳/复制/语法高亮/流式降级）。
 * 详细见 docs/details/注释/tauri/useMessageRender.md
 * stripJsonBlocks 剥离 Agent 输出中混入的结构化 JSON（Block 指令），复用 shared-ui 实现。
 */
export function useMessageRender() {
  function renderContent(content: string): string {
    if (!content) return ''
    const filtered = stripJsonBlocks(content.trim())
    return filtered ? renderMarkdownHtml(filtered) : ''
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
/**
 * 共享 Markdown 渲染（产品级模块）。
 *
 * 2026-09-27 E7：从 `agent/bubbles` 抽出——文件预览（FilePreview）等**无实体索引**的轻场景
 * 只依赖「渲染 + 复制」两件，不应挂在旧 Agent 面目录下。渲染内核仍是同一份（marked + DOMPurify
 * + Prism 注入 + 代码块外壳），与流式渲染（`createMarkdownStreamRenderer`）共享。
 *
 * 用法：
 * - 渲染：`renderMarkdownHtml(text)` → 已消毒 HTML（v-html 使用）
 * - 复制：容器根元素 `@click="handleCodeCopyClick"`（v-html 内按钮无法直接绑定）
 * - 样式：`import '@worldsea/shared-ui/markdown/markdown.css'`
 */
import './codeHighlight' // 副作用：注入 Prism 高亮实现（须在渲染前加载）

import { renderFullMarkdown } from './markdownStream'

export { renderFullMarkdown, createMarkdownStreamRenderer, setCodeHighlighter } from './markdownStream'
export type {
  StreamRenderedHtml,
  MarkdownStreamRenderer,
  MarkdownStreamRendererOptions,
  MentionMatcher,
} from './markdownStream'
export { highlightCode, clearHighlightCache } from './codeHighlight'

/** 代码块复制按钮事件处理器（v-html 内按钮无法直接绑定，由容器根元素事件委托调用）。
 *  命中 `.ws-code-copy` 时读取 data-copy 写入剪贴板，按钮短暂显示「已复制」。
 *  @returns 是否处理了代码复制（true 时调用方可不再走 mention 分支） */
export function handleCodeCopyClick(e: MouseEvent): boolean {
  const btn = (e.target as HTMLElement).closest?.('.ws-code-copy') as HTMLElement | null
  if (!btn) return false
  const text = btn.dataset.copy ?? ''
  navigator.clipboard.writeText(text).catch(() => {})
  btn.textContent = '已复制'
  setTimeout(() => {
    btn.textContent = '复制'
  }, 1600)
  return true
}

/**
 * 渲染单段 Markdown 为已消毒 HTML（无 mention 注入，无 rAF 节流、无增量）。
 *
 * 供无实体索引的轻场景复用（文件预览/群聊/私聊气泡），与 `useMarkdownRender` 共用同一
 * marked 实例 + 代码块外壳 + 流式降级，保证跨入口代码块体验一致。
 */
export function renderMarkdownHtml(text: string): string {
  return renderFullMarkdown(text, null)
}

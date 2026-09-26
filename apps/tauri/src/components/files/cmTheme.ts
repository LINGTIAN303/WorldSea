/**
 * CM6 主题（2026-09-07 从 CodeEditor 抽出共享）：语法配色 + 容器主题。
 * CodeEditor（编辑）与 CodeDiff（对比）同源消费；全部走项目令牌，明暗自适应。
 */
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** 语法配色：与 agent-markdown.css 的 Prism token 同语义映射（--agent-* 变量明暗自适应） */
export const wsHighlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--agent-text-muted, #7a7a85)' },
  { tag: [t.keyword, t.tagName], color: 'var(--agent-info, #3b82f6)' },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: 'var(--agent-success, #22c55e)' },
  { tag: [t.number, t.integer, t.bool, t.constant(t.variableName)], color: 'var(--agent-warning, #eab308)' },
  { tag: [t.function(t.variableName), t.definition(t.variableName), t.className], color: 'var(--agent-primary, #8b87f8)' },
  { tag: [t.operator, t.punctuation, t.operatorKeyword], color: 'var(--agent-text-secondary, #aaa)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--agent-info, #3b82f6)' },
  { tag: [t.typeName, t.namespace], color: 'var(--agent-warning, #eab308)' },
  { tag: t.meta, color: 'var(--agent-text-muted, #7a7a85)' },
])

/** 语法高亮扩展（随 wsHighlight 一并导出，消费方免于重复包装） */
export const wsSyntax = syntaxHighlighting(wsHighlight)

/** 容器主题：全部走项目令牌，明暗主题自动适配 */
export const wsEditorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--font-size-xs, 12px)', backgroundColor: 'transparent', color: 'var(--color-text-secondary)' },
  '.cm-scroller': {
    fontFamily: "var(--font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace)",
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-content': { caretColor: 'var(--color-primary)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-primary)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--color-primary-muted) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--color-surface)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--color-text-tertiary)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--color-primary-muted)' },
})

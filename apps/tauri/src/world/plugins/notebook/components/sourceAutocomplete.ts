/**
 * sourceAutocomplete —— 源码视图补全（块 3 阶段 2，2026-10-15）
 *
 * 源码态没有 TipTap 弹层——`[[` / `@` 补全是源码态写双链 / mention 的体验补偿
 * （块 3 批计划 §2.4，拍板「并入一期」）。两个 CM6 autocomplete 源以 override
 * 全接管（不与 basicSetup 默认源叠加）：
 * - `[[` → notebook 实体（apply 补名 + 自动闭合 `]]`）
 * - `@`  → 全部实体（apply 补名；mention 语法无闭合，与富文本侧一致）
 *
 * 数据源与富文本弹层同口径（entityStore 全量遍历、双链排除当前笔记）。
 */
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { useEntityStore } from '@worldsea/entity-core'

/** `[[` 双链补全：候选 = notebook 实体（排除当前笔记；selfId 走 getter 实时取） */
function noteLinkSource(selfId: () => string | null) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\[\[([^\[\]\n]*)$/)
    if (!before) return null
    const es = useEntityStore()
    const self = selfId()
    const options = (es.entities ?? [])
      .filter((e) => e.type === 'notebook' && e.id !== self)
      .slice(0, 20)
      .map((e) => ({
        label: e.name,
        apply: `${e.name}]]`, // 补名 + 自动闭合
        type: 'class',
        detail: '笔记',
      }))
    return { from: before.from + 2, options, validFor: /^[^\[\]\n]*$/ }
  }
}

/** `@` mention 补全：候选 = 全部实体（与富文本 mention 弹层同口径） */
function mentionSource() {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/@([\u4e00-\u9fa5A-Za-z0-9_]*)$/)
    if (!before) return null
    const es = useEntityStore()
    const options = (es.entities ?? [])
      .slice(0, 20)
      .map((e) => ({
        label: e.name,
        apply: e.name,
        type: e.type,
        detail: '实体',
      }))
    return { from: before.from + 1, options, validFor: /^[\u4e00-\u9fa5A-Za-z0-9_]*$/ }
  }
}

/**
 * 组装源码态补全扩展（NotebookTipTapEditor 经 CodeEditor 的 extraExtensions 注入）。
 * selfId 用 getter——闭包内实时取当前笔记 id，切笔记无需重建扩展。
 */
export function sourceAutocompleteExts(selfId: () => string | null): Extension[] {
  return [
    autocompletion({
      override: [noteLinkSource(selfId), mentionSource()],
    }),
  ]
}

import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

/**
 * 章内查找替换（TipTap 无官方实现，自研装饰插件）。
 * 快捷键在扩展内注册（Mod-f / Mod-h / Escape）——useShortcuts 注册表对 contentEditable
 * 聚焦有 isInput 守卫（modal scope 才放行），编辑器内按键必须走 TipTap 自身接管。
 * 已知限制：跨文本节点的匹配不识别（同段内被 mark 拆开的文本），与排版规则同口径。
 */

export interface FindMatch {
  from: number
  to: number
}

export interface FindReplaceState {
  searchTerm: string
  matches: FindMatch[]
  currentIdx: number
  decorations: DecorationSet
}

export const FindReplaceKey = new PluginKey<FindReplaceState>('msFindReplace')

export interface FindReplaceOptions {
  /** Ctrl+F：打开查找条（聚焦查找框） */
  onOpenFind?: () => void
  /** Ctrl+H：打开查找条（聚焦替换框） */
  onOpenReplace?: () => void
  /** Esc（搜索激活时）：清搜索并关条 */
  onClose?: () => void
}

type FindMeta = { searchTerm?: string; move?: number }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    msFindReplace: {
      setSearch: (term: string) => ReturnType
      clearSearch: () => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceCurrent: (replacement: string) => ReturnType
      replaceAll: (replacement: string) => ReturnType
    }
  }
}

function wrapIndex(i: number, n: number): number {
  if (n <= 0) return 0
  return ((i % n) + n) % n
}

/** 逐文本节点扫描匹配；大小写不敏感（仅当小写化不改长度时启用，避免个别字符大小写变换错位） */
function findMatches(doc: PMNode, term: string): FindMatch[] {
  if (!term) return []
  const lowerTerm = term.toLowerCase()
  const caseInsensitive = lowerTerm.length === term.length
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = caseInsensitive ? node.text.toLowerCase() : node.text
    const needle = caseInsensitive ? lowerTerm : term
    let idx = text.indexOf(needle)
    while (idx !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + needle.length })
      idx = text.indexOf(needle, idx + needle.length)
    }
  })
  return matches
}

function buildDecorations(doc: PMNode, matches: FindMatch[], currentIdx: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === currentIdx ? 'ms-find-match ms-find-match--current' : 'ms-find-match',
      })
    ),
  )
}

export const FindReplaceExtension = Extension.create<FindReplaceOptions>({
  name: 'msFindReplace',

  addOptions() {
    return {}
  },

  addCommands() {
    return {
      setSearch: (term: string) => ({ tr, dispatch }: CommandProps) => {
        if (dispatch) tr.setMeta(FindReplaceKey, { searchTerm: term } satisfies FindMeta)
        return true
      },
      clearSearch: () => ({ tr, dispatch }: CommandProps) => {
        if (dispatch) tr.setMeta(FindReplaceKey, { searchTerm: '' } satisfies FindMeta)
        return true
      },
      findNext: () => ({ tr, dispatch }: CommandProps) => {
        if (dispatch) tr.setMeta(FindReplaceKey, { move: 1 } satisfies FindMeta)
        return true
      },
      findPrev: () => ({ tr, dispatch }: CommandProps) => {
        if (dispatch) tr.setMeta(FindReplaceKey, { move: -1 } satisfies FindMeta)
        return true
      },
      replaceCurrent: (replacement: string) => ({ state, tr, dispatch }: CommandProps) => {
        const st = FindReplaceKey.getState(state)
        const m = st?.matches[st.currentIdx]
        if (!m) return true
        if (dispatch) {
          if (replacement) tr.replaceWith(m.from, m.to, state.schema.text(replacement))
          else tr.delete(m.from, m.to)
          // docChanged 触发重扫；currentIdx 原位夹取 = 自然落在替换后的下一处
          tr.setMeta(FindReplaceKey, {})
        }
        return true
      },
      replaceAll: (replacement: string) => ({ state, tr, dispatch }: CommandProps) => {
        const st = FindReplaceKey.getState(state)
        if (!st?.matches.length) return true
        if (dispatch) {
          // 倒序替换：后段替换不影响前段位置（单事务多替换的标准做法）
          const matches = st.matches
          for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i]
            if (replacement) tr.replaceWith(m.from, m.to, state.schema.text(replacement))
            else tr.delete(m.from, m.to)
          }
          tr.setMeta(FindReplaceKey, {})
        }
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => {
        this.options.onOpenFind?.()
        return true
      },
      'Mod-h': () => {
        this.options.onOpenReplace?.()
        return true
      },
      Escape: () => {
        const st = FindReplaceKey.getState(this.editor.state)
        if (!st?.searchTerm) return false
        this.editor.commands.clearSearch()
        this.options.onClose?.()
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplaceState>({
        key: FindReplaceKey,
        state: {
          init: () => ({ searchTerm: '', matches: [], currentIdx: 0, decorations: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(FindReplaceKey) as FindMeta | undefined
            let searchTerm = value.searchTerm
            let currentIdx = value.currentIdx
            let dirty = false
            if (meta?.searchTerm !== undefined && meta.searchTerm !== searchTerm) {
              searchTerm = meta.searchTerm
              currentIdx = 0
              dirty = true
            }
            if (meta?.move) {
              currentIdx = wrapIndex(currentIdx + meta.move, value.matches.length)
              dirty = true
            }
            if (tr.docChanged) dirty = true
            if (!dirty) return value
            // 替换后 currentIdx 原位夹取：当前位被替换消失时自然指向下一处
            const matches = findMatches(tr.doc, searchTerm)
            currentIdx = Math.min(currentIdx, Math.max(0, matches.length - 1))
            return { searchTerm, matches, currentIdx, decorations: buildDecorations(tr.doc, matches, currentIdx) }
          },
        },
        props: {
          decorations(state: EditorState) {
            return FindReplaceKey.getState(state)?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})

/** 读取当前查找状态（FindReplaceBar 展示 n/m 与滚动定位用） */
export function getFindState(state: EditorState): FindReplaceState | undefined {
  return FindReplaceKey.getState(state)
}

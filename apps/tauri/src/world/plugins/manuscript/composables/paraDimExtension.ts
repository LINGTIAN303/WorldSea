import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * 段落淡出（专注模式子项，默认关）：光标所在段落之外的全部顶层块降透明度。
 * 开关读取走 getEnabled()（settingsStore 引用）；开关切换后调 refreshParaDim()
 * 派发 meta 强制重算（无事务时装饰不会自行更新）。
 */

export const ParaDimKey = new PluginKey<DecorationSet>('msParaDim')

export interface ParaDimOptions {
  getEnabled: () => boolean
}

export const ParaDimExtension = Extension.create<ParaDimOptions>({
  name: 'msParaDim',

  addOptions() {
    return {
      getEnabled: () => false,
    }
  },

  addProseMirrorPlugins() {
    const getEnabled = () => this.options.getEnabled()

    /** 当前选区所在的顶层块序号（doc 的直接子块）；不在任何块内返回 -1 */
    function currentTopBlock(doc: import('@tiptap/pm/model').Node, pos: number): number {
      let index = -1
      let cursor = 0
      let found = -1
      doc.forEach((child) => {
        const end = cursor + child.nodeSize
        if (pos >= cursor && pos < end) found = index + 1
        cursor = end
        index++
      })
      return found
    }

    function build(doc: import('@tiptap/pm/model').Node, selectionFrom: number): DecorationSet {
      const active = currentTopBlock(doc, selectionFrom)
      const decos: Decoration[] = []
      let index = 0
      let cursor = 0
      doc.forEach((child) => {
        const end = cursor + child.nodeSize
        if (child.isBlock) {
          if (index !== active) decos.push(Decoration.node(cursor, end, { class: 'ms-para--dimmed' }))
        }
        cursor = end
        index++
      })
      return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty
    }

    return [
      new Plugin<DecorationSet>({
        key: ParaDimKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const refresh = tr.getMeta(ParaDimKey)
            const relevant = tr.docChanged || tr.selectionSet || refresh
            if (!relevant) return value
            if (!getEnabled()) return DecorationSet.empty
            return build(tr.doc, tr.selection.from)
          },
        },
        props: {
          decorations(state) {
            return ParaDimKey.getState(state) ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})

/** 开关切换后强制重算装饰（否则要等下一次输入/选区变化才生效） */
export function refreshParaDim(editor: { view: { dispatch: (tr: import('@tiptap/pm/state').Transaction) => void }; state: import('@tiptap/pm/state').EditorState }): void {
  editor.view.dispatch(editor.state.tr.setMeta(ParaDimKey, true))
}

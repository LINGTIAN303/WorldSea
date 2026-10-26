import { Extension } from '@tiptap/core'
import suggestion from '@tiptap/suggestion'

export interface SlashCommandItem {
  id: string
  label: string
  icon: string
  description: string
}

// E5（2026-09-26）：5 条 AI 项（续写/润色/角色对话/情节分析/世界观检查）随「AI 辅助」面板一并退场
//（菜单项指向的旧页内 Agent 已不可用）；余「提及实体」为本地编辑器能力。
// icon 须为合法 WsIcon 名（批3 弹层归一后菜单按 WsIcon 渲染，'@' 裸字符会渲染空白）。
export const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: 'mention', label: '提及实体', icon: 'at-sign', description: '插入 @ 提及实体' },
]

const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        items: ({ query }: { query: string }) => {
          if (!query) return SLASH_COMMANDS
          const q = query.toLowerCase()
          return SLASH_COMMANDS.filter(item =>
            item.label.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q)
          )
        },
        command: ({ editor, range }: { editor: any; range: any }) => {
          editor.chain().focus().deleteRange(range).run()
        },
        render: () => ({
          onStart: (_props: any) => {},
          onUpdate: (_props: any) => {},
          onExit: () => {},
          onKeyDown: (): boolean => false,
        }),
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})

export default SlashCommandExtension

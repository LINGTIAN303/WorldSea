import { Extension } from '@tiptap/core'
import suggestion from '@tiptap/suggestion'

export interface SlashCommandItem {
  id: string
  label: string
  icon: string
  description: string
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: 'continue', label: '续写', icon: '✍️', description: 'AI 续写后续内容' },
  { id: 'polish', label: '润色', icon: '✨', description: 'AI 润色选中文本' },
  { id: 'summarize', label: '摘要', icon: '📋', description: 'AI 生成内容摘要' },
  { id: 'link_note', label: '链接笔记', icon: '🔗', description: '插入笔记间链接' },
  { id: 'mention', label: '提及实体', icon: '@', description: '插入 @ 提及实体' },
]

const SlashCommandExtension = Extension.create({
  name: 'notebookSlashCommand',

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
          onStart: () => {},
          onUpdate: () => {},
          onExit: () => {},
          onKeyDown: () => false,
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

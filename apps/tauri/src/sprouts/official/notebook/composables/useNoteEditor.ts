import { ref, onBeforeUnmount, type Ref } from 'vue'
import { useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import SlashCommandExtension, { SLASH_COMMANDS } from './slashCommandExtension'
import type { SlashCommandItem } from './slashCommandExtension'
import { useEntityStore } from '@worldsea/entity-core'
import { entitySchemaRegistry } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

const AUTOSAVE_DELAY = 300

type SaveStatus = 'saved' | 'saving' | 'unsaved'

export interface MentionItem {
  id: string
  name: string
  type: string
  typeLabel: string
  icon: string
}

export function useNoteEditor(currentNote: Ref<Entity | null>, onContentChange?: (html: string) => void) {
  const es = useEntityStore()
  const saveStatus = ref<SaveStatus>('saved')
  const wordCount = ref(0)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  let mentionPopoverRef: { open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null = null
  let mentionCommand: ((props: { id: string; label?: string }) => void) | null = null

  function setMentionPopover(ref: { open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null) {
    mentionPopoverRef = ref
  }

  function onMentionSelect(item: MentionItem) {
    if (mentionCommand) {
      mentionCommand({ id: item.id, label: item.name })
    }
  }

  type SlashCommandPopoverApi = {
    open: (clientRect: (() => DOMRect | null) | null, items: SlashCommandItem[]) => void
    close: () => void
    updateItems: (items: SlashCommandItem[]) => void
    onKeyDown: (event: KeyboardEvent) => boolean
  }

  let slashCommandPopoverRef: SlashCommandPopoverApi | null = null
  let slashCommandRef: ((props: { id: string; label?: string }) => void) | null = null
  let slashCommandCallback: ((commandId: string) => void) | null = null

  function setSlashCommandPopover(ref: SlashCommandPopoverApi | null) {
    slashCommandPopoverRef = ref
  }

  function setSlashCommandCallback(cb: (commandId: string) => void) {
    slashCommandCallback = cb
  }

  function onSlashCommandSelect(item: SlashCommandItem) {
    if (slashCommandRef) {
      slashCommandRef({ id: item.id, label: item.label })
    }
    if (item.id === 'mention' && editor.value) {
      setTimeout(() => {
        editor.value?.chain().focus().insertContent('@').run()
      }, 0)
    } else if (slashCommandCallback) {
      slashCommandCallback(item.id)
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: { class: 'nb-mention' },
        suggestion: {
          char: '@',
          items: ({ query }: { query: string }) => {
            const all = (es.entities ?? []).map(e => ({
              id: e.id,
              name: e.name,
              type: e.type,
              typeLabel: entitySchemaRegistry.getLabel(e.type),
              icon: entitySchemaRegistry.getIconName(e.type) || 'clipboard-list',
            }))
            if (!query) return all.slice(0, 20)
            const q = query.toLowerCase()
            return all.filter(i =>
              i.name.toLowerCase().includes(q) || i.typeLabel.toLowerCase().includes(q)
            ).slice(0, 20)
          },
          render: () => {
            return {
              onStart: (props: SuggestionProps<MentionItem>) => {
                mentionCommand = props.command
                mentionPopoverRef?.open(props.clientRect ?? null)
              },
              onUpdate: (props: SuggestionProps<MentionItem>) => {
                mentionCommand = props.command
              },
              onExit: () => {
                mentionPopoverRef?.close()
                mentionCommand = null
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  mentionPopoverRef?.close()
                  return true
                }
                return false
              },
            }
          },
        },
        renderText: ({ node }) => {
          return `@${node.attrs.label ?? node.attrs.id}`
        },
      }),
      SlashCommandExtension.configure({
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
          render: (): any => {
            return {
              onStart: (props: SuggestionProps<SlashCommandItem>) => {
                slashCommandRef = props.command
                slashCommandPopoverRef?.open(props.clientRect ?? null, props.items)
              },
              onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
                slashCommandRef = props.command
                slashCommandPopoverRef?.updateItems(props.items)
              },
              onExit: () => {
                slashCommandPopoverRef?.close()
                slashCommandRef = null
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                return slashCommandPopoverRef?.onKeyDown(props.event) ?? false
              },
            }
          },
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'nb-editor-body tiptap',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText()
      wordCount.value = text.length
      if (onContentChange) {
        onContentChange(ed.getHTML())
      }
      scheduleAutosave()
    },
  })

  function scheduleAutosave() {
    saveStatus.value = 'unsaved'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      await flushSave()
    }, AUTOSAVE_DELAY)
  }

  /**
   * 内容持久化。
   *
   * 自动保存类写入统一带 `skipUndo`：编辑器内容按「输入暂停」落库，每次都记撤销会迅速
   * 填满全局撤销上限（默认 20）并把用户真实操作的撤销历史挤掉。文本级撤销由 TipTap
   * 自身的 undo 栈负责，不进全局撤销栈。
   */
  async function persistContent(html: string): Promise<void> {
    if (!currentNote.value) return
    await es.update(currentNote.value.id, {
      properties: {
        ...currentNote.value.properties,
        content: html,
      },
    }, 'user', { skipUndo: true })
  }

  async function flushSave() {
    if (!currentNote.value || !editor.value) return
    const html = editor.value.getHTML()
    saveStatus.value = 'saving'
    try {
      await persistContent(html)
      saveStatus.value = 'saved'
    } catch {
      saveStatus.value = 'unsaved'
    }
  }

  function loadNote(entity: Entity | null) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (editor.value && currentNote.value && saveStatus.value === 'unsaved') {
      const html = editor.value.getHTML()
      persistContent(html)
    }
    if (entity && editor.value) {
      const content = (entity.properties.content as string) || ''
      editor.value.commands.setContent(content, { emitUpdate: false })
      wordCount.value = editor.value.getText().length
    } else if (editor.value) {
      editor.value.commands.setContent('', { emitUpdate: false })
      wordCount.value = 0
    }
    saveStatus.value = 'saved'
  }

  function getHTML(): string {
    return editor.value?.getHTML() || ''
  }

  function getText(): string {
    return editor.value?.getText() || ''
  }

  onBeforeUnmount(() => {
    // 卸载前必须落盘：此前只清定时器 + destroy，未 flush —— 防抖窗口（300ms）内的改动
    // 会随视图卸载永久丢失。本 composable 是富文本正文的唯一写入方，此处丢即真丢。
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (editor.value && currentNote.value && saveStatus.value === 'unsaved') {
      persistContent(editor.value.getHTML())
    }
    editor.value?.destroy()
  })

  return {
    editor,
    saveStatus,
    wordCount,
    loadNote,
    flushSave,
    getHTML,
    getText,
    setMentionPopover,
    onMentionSelect,
    setSlashCommandPopover,
    setSlashCommandCallback,
    onSlashCommandSelect,
  }
}

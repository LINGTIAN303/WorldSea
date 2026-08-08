import { ref, onBeforeUnmount, type Ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import SlashCommandExtension, { SLASH_COMMANDS } from './slashCommandExtension'
import type { SlashCommandItem } from './slashCommandExtension'
import { useEntityStore } from '@worldsmith/entity-core'
import { entitySchemaRegistry } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

const AUTOSAVE_DELAY = 2000

type SaveStatus = 'saved' | 'saving' | 'unsaved'

export interface MentionItem {
  id: string
  name: string
  type: string
  typeLabel: string
  icon: string
}

export function useChapterEditor(currentChapter: Ref<Entity | null>) {
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
        HTMLAttributes: { class: 'ms-mention' },
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
        class: 'ms-editor-body',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText()
      wordCount.value = text.length
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

  async function flushSave() {
    if (!currentChapter.value || !editor.value) return
    const html = editor.value.getHTML()
    const text = editor.value.getText()
    saveStatus.value = 'saving'
    try {
      await es.update(currentChapter.value.id, {
        properties: {
          ...currentChapter.value.properties,
          content: html,
          wordCount: text.length,
        },
      })
      saveStatus.value = 'saved'
    } catch {
      saveStatus.value = 'unsaved'
    }
  }

  function loadChapter(entity: Entity | null) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (editor.value && currentChapter.value && saveStatus.value === 'unsaved') {
      const html = editor.value.getHTML()
      const text = editor.value.getText()
      es.update(currentChapter.value.id, {
        properties: {
          ...currentChapter.value.properties,
          content: html,
          wordCount: text.length,
        },
      })
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
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (editor.value && currentChapter.value) {
      const html = editor.value.getHTML()
      const text = editor.value.getText()
      es.update(currentChapter.value.id, {
        properties: {
          ...currentChapter.value.properties,
          content: html,
          wordCount: text.length,
        },
      })
    }
    editor.value?.destroy()
  })

  return {
    editor,
    EditorContent,
    saveStatus,
    wordCount,
    loadChapter,
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

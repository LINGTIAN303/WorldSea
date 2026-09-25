import { ref, shallowRef, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import SlashCommandExtension, { SLASH_COMMANDS } from './slashCommandExtension'
import type { SlashCommandItem } from './slashCommandExtension'
import { pickImageFiles, insertImageFilesInto } from '@/composables/imageInsert'
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

  // ── 编辑器生命周期自管（勿改回 useEditor）──
  // 缺陷史：useEditor 内部 onBeforeUnmount 会先 destroy，且它注册早于本组合函数自己的
  // 卸载钩子 → 卸载钩子里对「已销毁编辑器」调 getHTML() 抛
  // `Cannot read properties of null (reading 'cached')`，dev 模式下 Vue 对生命周期错误
  // throw → 视图切换失败；且「卸载落盘」实际从未成功过（每次都在 destroy 之后执行）。
  // 自管后顺序自控：卸载时先在活体上取内容落盘，再销毁。与 useChapterEditor 同步修改。
  const editor = shallowRef<Editor>()

  onMounted(() => {
    editor.value = new Editor({
      extensions: [
        StarterKit,
        // 表格（二期）：v3 官方四件套合集（Table/TableRow/TableHeader/TableCell）。
        // resizable 让列宽可拖拽（HTML 产物带 colgroup 宽度）；表格结构操作由工具栏
        // 的光标上下文组提供（见 NotebookTipTapEditor）。
        TableKit.configure({ table: { resizable: true } }),
        // 图片（三期前置）：块级节点；allowBase64 必开 —— 本地图片以 data URL 进正文
        // （MVP 存储决策，见 imageInsert.ts）。导出 docx 的对应映射见 blocksToDocx。
        Image.configure({ inline: false, allowBase64: true }),
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
        // 粘贴 / 拖拽本地图片（截图贴笔记是高频场景）。闭包引用 editor shallowRef：
        // 此时尚在构造中，插入动作发生时 editor.value 必已就绪。
        handlePaste: (_view, event) => {
          const files = pickImageFiles(event.clipboardData?.files)
          if (!files.length) return false
          void insertImageFilesInto(editor.value, files)
          return true
        },
        handleDrop: (_view, event) => {
          const files = pickImageFiles(event.dataTransfer?.files)
          if (!files.length) return false
          event.preventDefault()
          void insertImageFilesInto(editor.value, files)
          return true
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
    // （历史上这段因 useEditor 先销毁而从未成功执行过，见上方「生命周期自管」注释。）
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (editor.value && currentNote.value && saveStatus.value === 'unsaved') {
      void persistContent(editor.value.getHTML())
    }
    editor.value?.destroy()
    editor.value = undefined
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

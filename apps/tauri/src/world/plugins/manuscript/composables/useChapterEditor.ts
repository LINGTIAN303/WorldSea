import { ref, shallowRef, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import SlashCommandExtension, { SLASH_COMMANDS } from './slashCommandExtension'
import type { SlashCommandItem } from './slashCommandExtension'
import { FindReplaceExtension, type FindReplaceBarApi } from '@/composables/findReplaceExtension'
import { ParaDimExtension } from './paraDimExtension'
import { recordChapterDelta } from './useWritingStats'
import { msTypewriter, msParaDim } from './useWritingPrefs'
import { pickImageFiles, insertImageFilesInto } from '@/composables/imageInsert'
import { plainTextToEditorHtml } from '@/composables/plainTextToEditorHtml'
import { useEntityStore } from '@worldsea/entity-core'
import { entitySchemaRegistry } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

const AUTOSAVE_DELAY = 2000

export type SaveStatus = 'saved' | 'saving' | 'unsaved'

export interface MentionItem {
  id: string
  name: string
  type: string
  typeLabel: string
  icon: string
}

// 查找条对外 API 已上移共享模块（批2 与 notebook 共用）；此处保留类型转出口供组件引用
export type { FindReplaceBarApi }

export function useChapterEditor(currentChapter: Ref<Entity | null>) {
  const es = useEntityStore()
  const saveStatus = ref<SaveStatus>('saved')
  const wordCount = ref(0)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  // 编辑器当前实际加载的章节 id —— persistContent 的写入目标（与 currentChapter 解耦：
  // ManuscriptView.select() 先换 current 再调 loadChapter，「切走前落盘」若以 currentChapter
  // 为目标会把旧章节的未落库正文写到新章节上——2026-10-11 修复「切换窗口串写」，与
  // useNoteEditor 同步修改）
  let loadedChapterId: string | null = null

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

  function setSlashCommandPopover(ref: SlashCommandPopoverApi | null) {
    slashCommandPopoverRef = ref
  }

  function onSlashCommandSelect(item: SlashCommandItem) {
    if (slashCommandRef) {
      slashCommandRef({ id: item.id, label: item.label })
    }
    if (item.id === 'mention' && editor.value) {
      setTimeout(() => {
        editor.value?.chain().focus().insertContent('@').run()
      }, 0)
    }
  }

  // ── 查找条 API（扩展快捷键 Mod-f/Mod-h/Esc 经此开合查找条）──
  let findReplaceApi: FindReplaceBarApi | null = null

  function setFindReplaceApi(api: FindReplaceBarApi | null) {
    findReplaceApi = api
  }

  /** 查找条是否开着（视图层 Esc 退出专注模式的让位守卫） */
  function isFindBarOpen(): boolean {
    return findReplaceApi?.isVisible() ?? false
  }

  // ── 编辑器生命周期自管（勿改回 useEditor）──
  // 缺陷史：useEditor 内部 onBeforeUnmount 会先 destroy，且它注册早于本组合函数自己的
  // 卸载钩子 → 卸载钩子里对「已销毁编辑器」调 getHTML() 抛
  // `Cannot read properties of null (reading 'cached')`，dev 模式下 Vue 对生命周期错误
  // throw → 视图切换失败；且「卸载落盘」实际从未成功过（每次都在 destroy 之后执行）。
  // 自管后顺序自控：卸载时先在活体上取内容落盘，再销毁。
  const editor = shallowRef<Editor>()

  // 打字机滚动（专注模式子项）：光标偏离滚动容器中心超过阈值时平滑回中
  function scrollToCursorCenter() {
    const ed = editor.value
    if (!ed) return
    const container = ed.view.dom.closest('.editor-wrap') as HTMLElement | null
    if (!container) return
    const coords = ed.view.coordsAtPos(ed.state.selection.from)
    const rect = container.getBoundingClientRect()
    const delta = coords.top - (rect.top + rect.height / 2)
    if (Math.abs(delta) > 80) container.scrollBy({ top: delta, behavior: 'smooth' })
  }

  onMounted(() => {
    editor.value = new Editor({
      extensions: [
        StarterKit,
        // 表格（二期）：与笔记本同一配置，见 useNoteEditor 注释
        TableKit.configure({ table: { resizable: true } }),
        // 图片（三期前置）：与笔记本同一配置，见 useNoteEditor 注释
        Image.configure({ inline: false, allowBase64: true }),
        // 章内查找替换（批1）：快捷键在扩展内注册（注册表 isInput 守卫不管 contentEditable）
        FindReplaceExtension.configure({
          onOpenFind: () => findReplaceApi?.open(false),
          onOpenReplace: () => findReplaceApi?.open(true),
          onClose: () => findReplaceApi?.close(),
        }),
        // 段落淡出（批1 专注子项，默认关）：开关切换后调 refreshParaDim 强制重算
        ParaDimExtension.configure({ getEnabled: () => msParaDim.value }),
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
        // 粘贴 / 拖拽本地图片（与 useNoteEditor 同一逻辑，见彼处注释）
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
        scheduleAutosave()
      },
    })
    editor.value.on('transaction', ({ transaction }) => {
      if (!msTypewriter.value) return
      if (!transaction.docChanged && !transaction.selectionSet) return
      requestAnimationFrame(scrollToCursorCenter)
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
   * 自动保存类写入统一带 `skipUndo`：章节正文按「输入暂停」落库，每次都记撤销会迅速填满
   * 全局撤销上限（默认 20），把用户真实操作的撤销历史挤掉。文本级撤销由 TipTap 自身的
   * undo 栈与章节快照（useChapterSnapshots）负责，不进全局撤销栈。
   *
   * 【写入目标＝loadedChapterId，勿改回 currentChapter】2026-10-11 修复「切换窗口串写」：
   * select() 先换 current 再调 loadChapter，落盘时 currentChapter 已是新章节——若以它为
   * 目标，旧章节的未落库正文会被写到**新章节**上（实测复现，回归测试锁定）。properties
   * 同理取 store 实时值，而非 props 快照（快照可能在防抖窗口内过期）。
   */
  async function persistContent(html: string, text: string): Promise<void> {
    if (!loadedChapterId) return
    const live = es.entityMap.get(loadedChapterId)
    if (!live) return // 实体已不在（被删除等）——无从落盘
    // 写作统计的 diff 基线必须取落库前值（update 完成后 wordCount 已是新值，diff 恒 0）
    const beforeCount = (live.properties.wordCount as number) || 0
    await es.update(loadedChapterId, {
      properties: {
        ...live.properties,
        content: html,
        wordCount: text.length,
      },
    }, 'user', { skipUndo: true })
    try {
      await recordChapterDelta(es, live, beforeCount, text.length)
    } catch {
      // 统计失败不阻塞正文落盘
    }
  }

  async function flushSave() {
    if (!currentChapter.value || !editor.value) return
    const html = editor.value.getHTML()
    const text = editor.value.getText()
    saveStatus.value = 'saving'
    try {
      await persistContent(html, text)
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
    // 切走前落盘：目标＝**已加载**章节（loadedChapterId），勿改回 currentChapter——
    // select() 调本次 loadChapter 时 current 已是新章节，以 currentChapter 为目标会把旧
    // 章节的未落库正文写到新章节上（2026-10-11 修复，回归测试锁定）。
    if (editor.value && loadedChapterId && saveStatus.value === 'unsaved') {
      void persistContent(editor.value.getHTML(), editor.value.getText())
    }
    if (entity && editor.value) {
      // 纯文本归一：JSON 外部写入的 \n 在 HTML 语境会被折叠成空格，加载边界拆成 <p> 段
      const content = plainTextToEditorHtml((entity.properties.content as string) || '')
      // 同一章节的重复加载**不重载**：内容一致（重复点选/回流）或编辑器持焦（用户输入中）
      // → 直接短路。setContent 是全文档 replaceWith，会重置选区——重载即「光标跳走」。
      if (loadedChapterId === entity.id && (content === editor.value.getHTML() || editor.value.isFocused)) {
        return
      }
      editor.value.commands.setContent(content, { emitUpdate: false })
      wordCount.value = editor.value.getText().length
      loadedChapterId = entity.id
    } else if (editor.value) {
      editor.value.commands.setContent('', { emitUpdate: false })
      wordCount.value = 0
      loadedChapterId = null
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
    // 卸载落盘必须在销毁之前（见上方「编辑器生命周期自管」注释）。
    // 仅脏态才写：非脏时内容已在盘上，切视图不该产生无意义的重复写入。
    if (editor.value && loadedChapterId && saveStatus.value === 'unsaved') {
      void persistContent(editor.value.getHTML(), editor.value.getText())
    }
    editor.value?.destroy()
    editor.value = undefined
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
    onSlashCommandSelect,
    setFindReplaceApi,
    isFindBarOpen,
  }
}

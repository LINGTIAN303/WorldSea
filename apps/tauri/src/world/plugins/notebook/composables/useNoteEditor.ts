import { ref, shallowRef, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { Editor } from '@tiptap/vue-3'
import { pickImageFiles, insertImageFilesInto } from '@/composables/imageInsert'
import { plainTextToEditorHtml } from '@/composables/plainTextToEditorHtml'
import { useEntityStore, useRelationStore, useBidirectional } from '@worldsea/entity-core'
import { buildNotebookExtensions, fireMentionCommand, fireSlashCommand, fireNoteLinkCommand, type MentionItem } from './editorExtensions'
import { findNoteLinkAnchor } from './noteLinkExt'
import type { SlashCommandItem } from './slashCommandExtension'
import type { Entity } from '@worldsea/entity-core'

const AUTOSAVE_DELAY = 300

type SaveStatus = 'saved' | 'saving' | 'unsaved'

/**
 * @param onNavigate 双链跳转回调（编辑态 Ctrl+点击 / 预览态点击；NotebookTipTapEditor 转发到视图切换笔记）
 */
export function useNoteEditor(
  currentNote: Ref<Entity | null>,
  onContentChange?: (html: string) => void,
  onNavigate?: (noteId: string) => void,
) {
  const es = useEntityStore()
  const relationStore = useRelationStore()
  const { createBidirectional } = useBidirectional()
  const saveStatus = ref<SaveStatus>('saved')
  const wordCount = ref(0)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  // 编辑器当前实际加载的笔记 id —— persistContent 的写入目标（与 props/currentNote 解耦：
  // watch 触发的 loadNote 在「切走前落盘」时 props 已换新笔记，以 currentNote 为目标会把
  // 旧笔记的未落库正文写到新笔记上——2026-10-11 修复「切换窗口串写」）
  let loadedNoteId: string | null = null

  type MentionPopoverApi = { open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void }
  let mentionPopoverRef: MentionPopoverApi | null = null
  // 双链弹层（第二个 MentionPopover 实例，kind=notes；批 3 I4）
  let noteLinkPopoverRef: MentionPopoverApi | null = null
  // 弹层 kind：mention 与 `[[` 双链各用各的实例，select 时按 kind 分派命令句柄
  type PopoverKind = 'mention' | 'noteLink'
  let activePopoverKind: PopoverKind = 'mention'

  function setMentionPopover(ref: MentionPopoverApi | null) {
    mentionPopoverRef = ref
  }

  function setNoteLinkPopover(ref: MentionPopoverApi | null) {
    noteLinkPopoverRef = ref
  }

  function onMentionSelect(item: MentionItem) {
    if (activePopoverKind === 'noteLink') {
      // 双链：回灌 suggestion 命令句柄 → 框架执行 insertNoteLink + 关系落库
      fireNoteLinkCommand(item)
      return
    }
    fireMentionCommand(item)
  }

  type SlashCommandPopoverApi = {
    open: (clientRect: (() => DOMRect | null) | null, items: SlashCommandItem[]) => void
    close: () => void
    updateItems: (items: SlashCommandItem[]) => void
    onKeyDown: (event: KeyboardEvent) => boolean
  }

  let slashCommandPopoverRef: SlashCommandPopoverApi | null = null
  let slashCommandCallback: ((commandId: string) => void) | null = null

  function setSlashCommandPopover(ref: SlashCommandPopoverApi | null) {
    slashCommandPopoverRef = ref
  }

  function setSlashCommandCallback(cb: (commandId: string) => void) {
    slashCommandCallback = cb
  }

  function onSlashCommandSelect(item: SlashCommandItem) {
    fireSlashCommand(item)
    if (item.id === 'mention' && editor.value) {
      setTimeout(() => {
        editor.value?.chain().focus().insertContent('@').run()
      }, 0)
    } else if (item.id === 'task_list' && editor.value) {
      // 空待办：JSON 片段插入（不依赖 HTML 解析）；光标落项内，`- [ ] ` 手敲输入规则亦可
      editor.value.chain().focus().insertContent({
        type: 'taskList',
        content: [{
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph' }],
        }],
      }).run()
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
      extensions: buildNotebookExtensions({
        openMentionPopover: (rect) => { activePopoverKind = 'mention'; mentionPopoverRef?.open(rect) },
        closeMentionPopover: () => mentionPopoverRef?.close(),
        openSlashPopover: (rect, items) => slashCommandPopoverRef?.open(rect, items),
        updateSlashPopover: (items) => slashCommandPopoverRef?.updateItems(items),
        closeSlashPopover: () => slashCommandPopoverRef?.close(),
        onSlashKeyDown: (event) => slashCommandPopoverRef?.onKeyDown(event) ?? false,
        openNoteLinkPopover: (rect) => { activePopoverKind = 'noteLink'; noteLinkPopoverRef?.open(rect) },
        updateNoteLinkPopover: () => { /* 弹层为独立查询模式（自管过滤），无需外部 items 更新 */ },
        closeNoteLinkPopover: () => noteLinkPopoverRef?.close(),
        onNoteLinkKeyDown: (event) => {
          // 弹层自带输入框/键盘导航（与 mention 同模式）；Escape 收层由弹层自处理，这里仅让 suggestion 让路
          if (event.key === 'Escape') {
            noteLinkPopoverRef?.close()
            return true
          }
          return false
        },
        onNoteLinkInsert: (targetId) => { void linkCurrentTo(targetId) },
        currentNoteId: () => loadedNoteId ?? currentNote.value?.id ?? null,
      }),
      content: '',
      editorProps: {
        attributes: {
          class: 'nb-editor-body tiptap ws-nb-prose',
        },
        // 双链跳转：Ctrl/Cmd+点击 a[data-note-id] → 切换到目标笔记（预览态为直接点击，见 NotebookTipTapEditor）
        handleClick: (_view, _pos, event) => {
          const anchor = findNoteLinkAnchor(event.target)
          if (!anchor) return false
          if (!(event.ctrlKey || event.metaKey)) return false
          const noteId = anchor.getAttribute('data-note-id')
          if (!noteId) return false
          onNavigate?.(noteId)
          return true
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
   * 双链关系落库（批 3 I4）：双向 note_link，幂等（存在性检查，与 migrateBacklinks 同口径）。
   * 删除 mark 不清理关系（挂账：BacklinkPanel 展示侧容忍）。
   */
  async function linkCurrentTo(targetId: string): Promise<void> {
    const sourceId = loadedNoteId ?? currentNote.value?.id
    if (!sourceId || sourceId === targetId) return
    const exists = relationStore.relations.some(
      (r) => r.type === 'note_link' &&
        ((r.sourceId === sourceId && r.targetId === targetId) ||
          (r.sourceId === targetId && r.targetId === sourceId)),
    )
    if (exists) return
    await createBidirectional({ type: 'note_link', sourceId, targetId })
  }

  /**
   * 内容持久化。
   *
   * 自动保存类写入统一带 `skipUndo`：编辑器内容按「输入暂停」落库，每次都记撤销会迅速
   * 填满全局撤销上限（默认 20）并把用户真实操作的撤销历史挤掉。文本级撤销由 TipTap
   * 自身的 undo 栈负责，不进全局撤销栈。
   *
   * 【写入目标＝loadedNoteId，勿改回 currentNote】2026-10-11 修复「切换窗口串写」：
   * loadNote 的「切走前落盘」被 watch 触发时 props（currentNote）已是新笔记——若以它为
   * 目标，旧笔记的未落库正文会被写到**新笔记**上。properties 同理取 store 实时值，
   * 而非 props 快照（快照可能在防抖窗口内过期）。
   */
  async function persistContent(html: string): Promise<void> {
    if (!loadedNoteId) return
    const live = es.entityMap.get(loadedNoteId)
    if (!live) return // 实体已不在（被删除等）——无从落盘
    await es.update(loadedNoteId, {
      properties: {
        ...live.properties,
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
    // 切走前落盘：目标＝**已加载**笔记（loadedNoteId），勿改回 currentNote——
    // watch 触发本次 loadNote 时 props 已是新笔记，以 currentNote 为目标会把旧笔记的
    // 未落库正文写到新笔记上（2026-10-11 修复，回归测试锁定）。
    if (editor.value && loadedNoteId && saveStatus.value === 'unsaved') {
      void persistContent(editor.value.getHTML())
    }
    if (entity && editor.value) {
      // 纯文本归一：JSON 外部写入的 \n 在 HTML 语境会被折叠成空格，加载边界拆成 <p> 段
      // （装载网关已把 md 归一为 HTML，此处为网关外的最后兜底——已是 HTML 的内容原样放行）
      const content = plainTextToEditorHtml((entity.properties.content as string) || '')
      // 同一篇笔记的回流/外部更新**不重载**：内容一致（自动保存回流）或编辑器持焦
      // （用户输入中）→ 直接短路。setContent 是全文档 replaceWith，会重置选区——
      // 重载即「光标跳走」（2026-10-11 修复，回归测试锁定）。
      if (loadedNoteId === entity.id && (content === editor.value.getHTML() || editor.value.isFocused)) {
        return
      }
      editor.value.commands.setContent(content, { emitUpdate: false })
      wordCount.value = editor.value.getText().length
      loadedNoteId = entity.id
    } else if (editor.value) {
      editor.value.commands.setContent('', { emitUpdate: false })
      wordCount.value = 0
      loadedNoteId = null
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
    if (editor.value && loadedNoteId && saveStatus.value === 'unsaved') {
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
    setNoteLinkPopover,
    onMentionSelect,
    setSlashCommandPopover,
    setSlashCommandCallback,
    onSlashCommandSelect,
  }
}

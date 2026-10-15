import { ref, shallowRef, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { Editor } from '@tiptap/vue-3'
import { pickImageFiles, insertImageFilesInto } from '@/composables/imageInsert'
import { normalizeNoteContent } from '../contentNormalize'
import { recomputeNoteLinks } from '../backlinkDerive'
import { useEntityStore } from '@worldsea/entity-core'
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
  onContentChange?: (md: string) => void,
  onNavigate?: (noteId: string) => void,
) {
  const es = useEntityStore()
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
        // 块 2 阶段 2：onNoteLinkInsert 关系落库回调已退役——弹层选中仅插入 `[[名]]` 文本，
        // 建联统一由保存后派生（recomputeNoteLinks，见 backlinkDerive §3.4「连接即内容的函数」）
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
        // 批 5 F5（2026-10-12，「先量化再优化」）：**不要**在每键路径调 getHTML()/getMarkdown()。
        // 实测（notebookPerf.bench）：大文档全量序列化 10k≈7ms / 50k≈38ms，而单键
        // transaction 本身仅 ~0.6-1.1ms —— 每键全量序列化是输入延迟的头号来源。
        // contentChange 的 md 改由 flushSave（300ms 防抖）与卸载路径统一发出；
        // 下游（NotebookEditor.editContent）仅是本地状态同步，无实时性依赖。
        const text = ed.getText()
        wordCount.value = text.length
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
   *
   * 【写入目标＝loadedNoteId，勿改回 currentNote】2026-10-11 修复「切换窗口串写」：
   * loadNote 的「切走前落盘」被 watch 触发时 props（currentNote）已是新笔记——若以它为
   * 目标，旧笔记的未落库正文会被写到**新笔记**上。properties 同理取 store 实时值，
   * 而非 props 快照（快照可能在防抖窗口内过期）。
   *
   * 块 2 阶段 2：落库成功后派生重算关系（await 串联——flushSave 收敛即关系收敛）；
   * 本函数是内容落库的**唯一出口**（防抖保存 / 切走前落盘 / 卸载落盘三路径共用），
   * 故此一处接线即覆盖全部保存路径。recomputeNoteLinks 失败不抛出（保存不因派生失败误报）。
   */
  async function persistContent(md: string): Promise<void> {
    const noteId = loadedNoteId
    if (!noteId) return
    const live = es.entityMap.get(noteId)
    if (!live) return // 实体已不在（被删除等）——无从落盘
    await es.update(noteId, {
      properties: {
        ...live.properties,
        content: md,
      },
    }, 'user', { skipUndo: true })
    await recomputeNoteLinks(noteId)
  }

  async function flushSave() {
    if (!currentNote.value || !editor.value) return
    const md = editor.value.getMarkdown()
    // 批 5 F5：contentChange 与落库同帧发出（替代原「每键」调用——见 onUpdate 注释）
    if (onContentChange) onContentChange(md)
    saveStatus.value = 'saving'
    try {
      await persistContent(md)
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
      void persistContent(editor.value.getMarkdown())
    }
    if (entity && editor.value) {
      // 块 1 阶段 3：装载＝md 直装（正文真相源）；解析前容错（表格空行修复等）在此边界施加，
      // 不改写存储原文（见 contentNormalize 头注释）。
      const md = normalizeNoteContent((entity.properties.content as string) || '')
      // 同一篇笔记的回流/外部更新**不重载**：内容一致（自动保存回流）或编辑器持焦
      // （用户输入中）→ 直接短路。setContent 是全文档 replaceWith，会重置选区——
      // 重载即「光标跳走」（2026-10-11 修复，回归测试锁定）。比较基准＝md 形态。
      if (loadedNoteId === entity.id && (md === editor.value.getMarkdown() || editor.value.isFocused)) {
        return
      }
      editor.value.commands.setContent(md, { emitUpdate: false, contentType: 'markdown' })
      wordCount.value = editor.value.getText().length
      loadedNoteId = entity.id
      // 块 2 阶段 2：装载后重算关系（fire-and-forget）——兜底「装载前被外部改过」
      // （Agent 经能力桥写入 / 直改存储等）导致的陈旧关系；幂等短路，无变化零写入。
      void recomputeNoteLinks(entity.id)
    } else if (editor.value) {
      editor.value.commands.setContent('', { emitUpdate: false })
      wordCount.value = 0
      loadedNoteId = null
    }
    saveStatus.value = 'saved'
  }

  /** 当前内容（md 形态——块 1 阶段 3 起正文真相源＝md） */
  function getMarkdown(): string {
    return editor.value?.getMarkdown() || ''
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
      const md = editor.value.getMarkdown()
      void persistContent(md)
      // 批 5 F5：卸载路径同样补发 contentChange（防抖窗口内切走/切类型时下游拿到最新）
      if (onContentChange) onContentChange(md)
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
    getMarkdown,
    getText,
    setMentionPopover,
    setNoteLinkPopover,
    onMentionSelect,
    setSlashCommandPopover,
    setSlashCommandCallback,
    onSlashCommandSelect,
  }
}

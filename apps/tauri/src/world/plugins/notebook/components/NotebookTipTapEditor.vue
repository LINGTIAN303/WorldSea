<template>
  <div class="nb-tiptap-editor" :style="proseVars">
    <NotebookEditorToolbar
      :editor="editor"
      v-model:view-mode="viewMode"
      :save-status="saveStatus"
      :word-count="wordCount"
      @open-find="findBarRef?.open(false)"
    />
    <!-- 批2 平移：章内查找替换（就地条；scrollSelector = 笔记本滚动容器，closest 自编辑器
         DOM 出发，分栏态天然定位到编辑侧 pane） -->
    <FindReplaceBar ref="findBarRef" :editor="editor" scroll-selector=".nb-split-pane" />
    <!-- 定位锚层（批 3 走查修复）：TOC 按钮/面板挂这里（不随正文滚动）；滚动容器是各 pane -->
    <!-- 批 4 V8/I10 三态视图（编辑 / 分栏 / 预览）+ 块 3「源码」，按状态严格隔离（走查修正）：
         ① 预览 = v-if 按状态挂载——编辑态预览完全不渲染（DOM 不存在、previewHtml 不求值）。
         ② 编辑器 = v-show 有意常驻——卸载编辑器 DOM 会销毁 TipTap 视图（丢光标/选区/撤销上下文），
            这是技术硬约束；display:none 不绘制，无渲染开销。
         ③ 源码 = v-if 按状态挂载（CM6 CodeEditor），进入注入 / 编辑防抖冲回（见 sourceBuf 段）。 -->
    <div class="nb-tt-wrap">
      <div class="nb-tt-body" :class="{ 'nb-tt-body--split': viewMode === 'split' }">
        <div v-show="viewMode !== 'preview' && viewMode !== 'source'" ref="editPaneRef" class="nb-split-pane nb-split-pane--editor">
          <div class="nb-editor-wrap">
            <EditorContent v-if="editor" :editor="editor" />
            <textarea v-else v-model="fallbackContent" class="editor-fallback" aria-label="文本编辑器（备选）" @input="onFallbackInput" />
            <BubbleToolbar :editor="editor" />
          </div>
        </div>
        <div v-if="viewMode === 'split' || viewMode === 'preview'" ref="previewPaneRef" class="nb-split-pane nb-split-pane--preview">
          <div class="nb-preview-wrap ws-nb-prose" v-html="previewHtml" @click="onPreviewClick"></div>
        </div>
        <div v-if="viewMode === 'source'" class="nb-split-pane nb-split-pane--source">
          <CodeEditor
            :model-value="sourceBuf"
            lang="markdown"
            :extra-extensions="sourceExts"
            class="nb-source-editor"
            @update:model-value="onSourceChange"
            @save="flushSourceToDoc"
          />
        </div>
      </div>
      <!-- 目录（批 3 I5）：右下角悬浮按钮 + 标题层级面板 -->
      <button class="nb-toc-btn" :class="{ active: showToc }" title="目录" aria-label="目录" @click="showToc = !showToc">
        <WsIcon name="outline" size="xs" />
      </button>
      <!-- 块手柄层（批 5 V4）：悬停块左侧手柄 + 拖拽重排 + 快捷菜单；预览/源码态无编辑语义不挂 -->
      <BlockHandleLayer v-if="viewMode === 'edit' || viewMode === 'split'" :editor="editor" />
      <div v-if="showToc && tocItems.length > 0" class="nb-toc-panel">
        <div
          v-for="item in tocItems"
          :key="item.pos"
          :class="['nb-toc-item', `lv${item.level}`]"
          role="button"
          tabindex="0"
          @click="scrollToHeading(item.pos)"
          @keydown.enter.prevent="scrollToHeading(item.pos)"
        >{{ item.text }}</div>
      </div>
    </div>
    <MentionPopover ref="mentionPopoverRef" @select="onMentionSelect" @close="() => {}" />
    <!-- 双链选择器（批 3 I4）：仅 notebook 实体、排除当前笔记 -->
    <MentionPopover ref="noteLinkPopoverRef" kind="notes" :exclude-id="note?.id" @select="onMentionSelect" @close="() => {}" />
    <SlashCommandMenu ref="slashCommandMenuRef" @select="onSlashCommandSelect" @close="() => {}" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import { WsIcon } from '@worldsea/ui-kit'
import { renderMarkdownForEditor } from '@worldsea/shared-ui/markdown'
import NotebookEditorToolbar from './NotebookEditorToolbar.vue'
import type { EditorViewMode } from './notebookEditorTypes'
import MentionPopover from '@/components/editor/MentionPopover.vue'
import SlashCommandMenu from '@/components/editor/SlashCommandMenu.vue'
import BubbleToolbar from './BubbleToolbar.vue'
import BlockHandleLayer from './BlockHandleLayer.vue'
import FindReplaceBar from '@/components/editor/FindReplaceBar.vue'
import { useNoteEditor } from '../composables/useNoteEditor'
import { useSplitScrollSync } from '../composables/useSplitScrollSync'
import { findNoteLinkAnchor } from '../composables/noteLinkExt'
import { SLASH_COMMANDS, type SlashCommandItem } from '../composables/slashCommandExtension'
import { normalizeNoteContent } from '../contentNormalize'
import { nbFontSize, nbLineHeight } from '../composables/useNotePrefs'
import CodeEditor from '@/components/files/CodeEditor.vue'
import { sourceAutocompleteExts } from './sourceAutocomplete'
import '../prose.css'
import { toastWarn } from '@/composables/useToast'
import type { Entity } from '@worldsea/entity-core'

type SlashCommandPopoverApi = {
  open: (clientRect: (() => DOMRect | null) | null, items: SlashCommandItem[]) => void
  close: () => void
  updateItems: (items: SlashCommandItem[]) => void
  onKeyDown: (event: KeyboardEvent) => boolean
}

const props = defineProps<{ note: Entity }>()
const emit = defineEmits<{ contentChange: [md: string]; navigate: [noteId: string] }>()

const viewMode = ref<EditorViewMode>('edit')
const fallbackContent = ref(String(props.note.properties?.content || ''))

// ── 源码视图（块 3）：md 真相源直读直写 ──
// 数据流：进入态注入（getMarkdown，含未落库输入）→ CM 编辑缓冲（防抖 300ms）→ 冲回 TipTap
//（setContent emitUpdate:true → onUpdate → 既有防抖保存链 → persistContent → 派生重算）。
// 不回写 CM（单向：CM→TipTap）——TipTap 侧的规范化差异一次性，切态收敛即可（Joplin 同款）。
const sourceBuf = ref('')
let sourceDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** 冲回：把源码缓冲喂给 TipTap（emitUpdate 触发既有保存链）；与当前文档无差异时跳过 */
function flushSourceToDoc(): void {
  if (sourceDebounceTimer) {
    clearTimeout(sourceDebounceTimer)
    sourceDebounceTimer = null
  }
  const ed = editor.value
  if (!ed) return
  const md = sourceBuf.value
  if (md === ed.getMarkdown()) return
  ed.commands.setContent(md, { emitUpdate: true, contentType: 'markdown' })
}

function onSourceChange(v: string): void {
  sourceBuf.value = v
  if (sourceDebounceTimer) clearTimeout(sourceDebounceTimer)
  sourceDebounceTimer = setTimeout(flushSourceToDoc, 300)
}

function onFallbackInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  fallbackContent.value = val
  // 与装载网关同语义：编辑器未就绪窗口的输入也归一，避免纯文本绕过边界进内容流
  emit('contentChange', normalizeNoteContent(val))
}

/** 预览态双链点击（编辑态为 Ctrl+点击，见 useNoteEditor 的 handleClick） */
function onPreviewClick(e: MouseEvent): void {
  const anchor = findNoteLinkAnchor(e.target)
  if (!anchor) return
  e.preventDefault()
  const noteId = anchor.getAttribute('data-note-id')
  if (noteId) emit('navigate', noteId)
}

const {
  editor,
  saveStatus,
  wordCount,
  loadNote,
  persistContent,
  setMentionPopover,
  setNoteLinkPopover,
  onMentionSelect,
  setSlashCommandPopover,
  setSlashCommandCallback,
  onSlashCommandSelect,
  setFindReplaceApi,
} = useNoteEditor(
  computed(() => props.note),
  (html) => emit('contentChange', html),
  (noteId) => emit('navigate', noteId),
)

// ── 排版偏好（批2）：字号/行距 → CSS 变量（prose.css 的 .ws-nb-prose 消费，编辑/预览同源）──
const proseVars = computed<Record<string, string>>(() => ({
  '--nb-font-size': `${nbFontSize.value}px`,
  '--nb-line-height': String(nbLineHeight.value),
}))

// 查找条（批2 平移）：容器内就地条，扩展快捷键（Ctrl+F/H/Esc）经 setFindReplaceApi 开合
const findBarRef = ref<InstanceType<typeof FindReplaceBar> | null>(null)

// 源码态补全（块 3 阶段 2，拍板并入一期）：`[[` 双链 / `@` mention——selfId 实时取
const sourceExts = sourceAutocompleteExts(() => props.note?.id ?? null)

const mentionPopoverRef = ref<{ open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null>(null)
const noteLinkPopoverRef = ref<{ open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null>(null)
const slashCommandMenuRef = ref<SlashCommandPopoverApi | null>(null)

onMounted(() => {
  setMentionPopover(mentionPopoverRef.value)
  setNoteLinkPopover(noteLinkPopoverRef.value)
  setSlashCommandPopover(slashCommandMenuRef.value)
  setFindReplaceApi(findBarRef.value)
  // 斜杠命令回调：`mention` 由 useNoteEditor 内部处理（插入 @），其余四条
  // （续写 / 润色 / 摘要 / 链接笔记）在笔记本芽尚无落地实现。此前从未注册回调 →
  // 点击后只删掉 "/" 而毫无反馈（静默失败），违反「禁用不留静默」铁律，故显式提示。
  setSlashCommandCallback((commandId: string) => {
    const cmd = SLASH_COMMANDS.find(c => c.id === commandId)
    toastWarn(`「${cmd?.label ?? commandId}」尚未接入，暂不可用`)
  })
  loadNote(props.note)
})

// 切换笔记才重载（按 id 判断，勿按对象引用）——实体每次更新（含自动保存回流）都会
// 替换引用（useShallowArray 按引用替换），按引用监听会在每次落库后触发 loadNote →
// setContent 重置选区 → 光标跳走（2026-10-11 修复「打字丢光标」，回归测试锁定）。
watch(() => props.note?.id, (id, oldId) => {
  if (id && id !== oldId) {
    // 块 3 源码态切笔记：先冲回缓冲（同「切走前落盘」口径——loadNote 的落盘读 TipTap 文档，
    // 300ms 防抖窗口内的源码编辑不在其中，须先冲回），再装载并重置缓冲为新笔记文档
    if (viewMode.value === 'source') flushSourceToDoc()
    loadNote(props.note)
    if (viewMode.value !== 'edit') previewTick.value++ // 切笔记立即刷预览（不等防抖窗口）
    if (viewMode.value === 'source') sourceBuf.value = editor.value?.getMarkdown() ?? ''
  }
})


// ── 目录（批 3 I5）：transaction 驱动重算；点击 scrollIntoView 定位 ──
const showToc = ref(false)
const tocTick = ref(0)
let offTocTransaction: (() => void) | null = null
watch(editor, (ed) => {
  offTocTransaction?.()
  offTocTransaction = null
  if (!ed) return
  const handler = () => {
    tocTick.value++
    // 批 4 V8：分栏/预览模式下防抖刷新预览（编辑/源码模式不刷——源码态预览面板不挂载，省性能）
    if (viewMode.value === 'split' || viewMode.value === 'preview') schedulePreviewRefresh()
  }
  ed.on('transaction', handler)
  offTocTransaction = () => ed.off('transaction', handler)
}, { immediate: true })
onBeforeUnmount(() => { offTocTransaction?.() })


interface TocItem { pos: number; level: number; text: string }
const tocItems = computed<TocItem[]>(() => {
  // 面板关闭 → 不遍历（此前每次按键 transaction 都全文档 descendants 扫一遍；tocTick 在重开时保证最新）
  if (!showToc.value) return []
  void tocTick.value
  const ed = editor.value
  if (!ed) return []
  const items: TocItem[] = []
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      items.push({ pos, level: node.attrs.level as number, text: node.textContent })
    }
    return true
  })
  return items
})

function scrollToHeading(pos: number): void {
  const ed = editor.value
  if (!ed) return
  const el = ed.view.nodeDOM(pos) as HTMLElement | null
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}


// ── 分栏实时预览（批 4 V8/I10）──
// 旧实现 previewHtml 无文档级响应依赖（getHTML() 非响应式）→ 预览内容只在首次求值时生成（陈旧）。
// 现由 previewTick 驱动：切模式时立即刷新、编辑中防抖刷新（250ms，避免逐键重算全文）。
const previewTick = ref(0)
let previewTimer: ReturnType<typeof setTimeout> | null = null

function schedulePreviewRefresh(): void {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    previewTick.value++
  }, 250)
}

const previewHtml = computed(() => {
  // 块 1 阶段 3：预览渲染源＝编辑器 md（真相源形态）→ marked 渲染链（renderMarkdownForEditor，
  // 与装载/导出同源；内含 DOMPurify 消毒与未闭合围栏降级）。协议 §3.1：HTML 作渲染中间态保留。
  void previewTick.value
  return renderMarkdownForEditor(editor.value?.getMarkdown() || '')
})

// ── 分栏滚动同步（批 4 V8/I10）：算法与监听在 useSplitScrollSync（2026-10-18 拆件）──
const editPaneRef = ref<HTMLElement | null>(null)
const previewPaneRef = ref<HTMLElement | null>(null)
const { attachSplitSync, alignToEditor } = useSplitScrollSync(editPaneRef, previewPaneRef)

watch(viewMode, (mode, oldMode) => {
  // 编辑态零预览活动（走查修正·严格状态隔离）：取消挂起的防抖刷新
  // （覆盖「分栏打字后 250ms 内切回编辑」的残留计时器场景；预览 DOM 已随 v-if 卸载）
  if (mode !== 'edit') {
    previewTick.value++ // 进入即刷一次（修复「预览陈旧」）
  } else if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  // 块 3 源码态：进入 = 以编辑器当前文档注入缓冲（含未落库输入）；离开 = 冲回 TipTap
  //（emitUpdate 触发既有防抖保存链 → persistContent → 派生重算）
  if (mode === 'source') {
    sourceBuf.value = editor.value?.getMarkdown() ?? ''
  } else if (oldMode === 'source') {
    flushSourceToDoc()
  }
  void nextTick(() => {
    attachSplitSync(mode === 'split') // 仅 split 模式挂双向监听；其余模式（含切离）解除
    if (mode === 'split') alignToEditor() // 首次进入：以编辑侧为准对齐一次
  })
})

// 预览 v-html 整体替换会重置滚动位 → 更新前保存、更新后恢复（分栏跟随编辑时尤其重要）
let previewScrollSave = 0
watch(previewTick, () => {
  previewScrollSave = previewPaneRef.value?.scrollTop ?? 0
})
watch(previewHtml, () => {
  const pv = previewPaneRef.value
  if (pv && viewMode.value !== 'edit') pv.scrollTop = previewScrollSave
}, { flush: 'post' })


onBeforeUnmount(() => {
  setSlashCommandCallback(null as any)
  if (previewTimer) clearTimeout(previewTimer)
  // 分栏滚动监听的解除在 useSplitScrollSync 自身的 onBeforeUnmount（拆件后不再由本组件卸载）
  // 块 3 源码兜底：源码缓冲未回流（防抖窗口内卸载）→ 直接按 persistContent 口径落库。
  // 本钩子晚于 useNoteEditor 的卸载落盘执行（后者读 TipTap 文档、不含源码未回流编辑），
  // 源码在途编辑只能由此自兜底；随后 timer 复位避免卸载后再触发冲回（editor 已销毁）。
  if (sourceDebounceTimer) {
    clearTimeout(sourceDebounceTimer)
    sourceDebounceTimer = null
    void persistContent(sourceBuf.value)
  }
})
</script>

<style scoped>
.nb-tiptap-editor { display: flex; flex-direction: column; height: 100%; }

/* 定位锚层：TOC 按钮固定于视口右下（不随正文滚动） */
.nb-tt-wrap { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
/* 视图容器（批 4 V8/I10）：panes 型布局——单栏时 pane 占满；分栏时左右各半、preview 侧出分隔线 */
.nb-tt-body { flex: 1; min-height: 0; display: flex; }
.nb-split-pane { flex: 1 1 0; min-width: 0; overflow: auto; padding: 16px 20px; }
.nb-tt-body--split .nb-split-pane--preview { border-left: 1px solid var(--color-border-subtle); }
.nb-editor-wrap { min-height: 100%; }
/* 排版体系（标题/引用/列表/表格/代码块/任务列表等）统一由 prose.css 的 .ws-nb-prose 承载，
   编辑区类名在 useNoteEditor 的 editorProps.attributes（'nb-editor-body tiptap ws-nb-prose'）注入 */
.nb-editor-wrap :deep(.tiptap) { outline: none; min-height: 200px; }

/* 目录（批 3 I5）：右下角悬浮按钮 + 层级面板 */
.nb-toc-btn {
  position: absolute; right: 14px; bottom: 14px; z-index: 5;
  width: 30px; height: 30px; padding: 0; border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); background: var(--color-bg-surface);
  color: var(--color-text-tertiary); cursor: pointer; display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-sm); transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.nb-toc-btn:hover, .nb-toc-btn.active { background: var(--color-bg-hover); color: var(--color-primary); border-color: var(--color-primary); }
.nb-toc-panel {
  position: absolute; right: 14px; bottom: 50px; z-index: 5;
  width: 260px; max-height: 50%; overflow-y: auto;
  background: var(--color-bg-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); padding: 6px; box-shadow: var(--shadow-md);
}
.nb-toc-item {
  padding: 4px 8px; border-radius: var(--radius-xs); cursor: pointer;
  font-size: var(--font-size-xs); color: var(--color-text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}
.nb-toc-item:hover { background: var(--color-bg-hover); color: var(--color-primary); }
.nb-toc-item.lv1 { font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
.nb-toc-item.lv2 { padding-left: 20px; }
.nb-toc-item.lv3 { padding-left: 32px; font-size: var(--font-size-2xs); }

.editor-fallback { width: 100%; height: 100%; min-height: 200px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); padding: 12px; font-family: var(--font-family-content); font-size: var(--font-size-base); line-height: 1.7; color: var(--color-text-primary); background: var(--color-bg-base); resize: vertical; outline: none; }
.editor-fallback:focus { border-color: var(--color-primary); }

/* 源码视图（块 3）：CM6 撑满 pane（CodeEditor 自带 flex 布局与令牌主题；单 pane 全宽） */
.nb-split-pane--source { display: flex; flex-direction: column; padding: 8px; }
.nb-source-editor { flex: 1; min-height: 0; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); overflow: hidden; }
</style>

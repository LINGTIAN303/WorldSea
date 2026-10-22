<template>
  <div class="nb-tt-toolbar">
    <div class="toolbar-group">
      <select class="toolbar-select" :value="headingLevel" @change="setHeading">
        <option value="0">正文</option>
        <option value="1">标题 1</option>
        <option value="2">标题 2</option>
        <option value="3">标题 3</option>
      </select>
    </div>
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button class="tb-btn" :class="{ active: editor?.isActive('bold') }" @click="editor?.chain().focus().toggleBold().run()" title="粗体" aria-label="粗体"><WsIcon name="bold" size="xs" /></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('italic') }" @click="editor?.chain().focus().toggleItalic().run()" title="斜体" aria-label="斜体"><WsIcon name="italic" size="xs" /></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('strike') }" @click="editor?.chain().focus().toggleStrike().run()" title="删除线" aria-label="删除线"><WsIcon name="strikethrough" size="xs" /></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('code') }" @click="editor?.chain().focus().toggleCode().run()" title="行内代码" aria-label="行内代码"><WsIcon name="code" size="xs" /></button>
    </div>
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button class="tb-btn" :class="{ active: editor?.isActive('blockquote') }" @click="editor?.chain().focus().toggleBlockquote().run()" title="引用" aria-label="引用"><WsIcon name="quote" size="xs" /></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('bulletList') }" @click="editor?.chain().focus().toggleBulletList().run()" title="无序列表" aria-label="无序列表"><WsIcon name="list" size="xs" /></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('orderedList') }" @click="editor?.chain().focus().toggleOrderedList().run()" title="有序列表" aria-label="有序列表"><WsIcon name="list-ordered" size="xs" /></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('taskList') }" @click="editor?.chain().focus().toggleTaskList().run()" title="任务列表" aria-label="任务列表"><WsIcon name="task-plan" size="xs" /></button>
      <button class="tb-btn" @click="editor?.chain().focus().setHorizontalRule().run()" title="分割线" aria-label="分割线"><WsIcon name="minus" size="xs" /></button>
      <button class="tb-btn" @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()" title="插入表格" aria-label="插入表格"><WsIcon name="table" size="xs" /></button>
      <button class="tb-btn" @click="imageInput?.click()" title="插入图片（本地文件，≤2MB）" aria-label="插入图片"><WsIcon name="image" size="xs" /></button>
      <input ref="imageInput" type="file" accept="image/*" multiple class="tb-hidden-input" @change="onPickImages" />
    </div>
    <!-- 表格上下文组：光标在表格内才出现（结构操作）；禁用态由 can() 判定（如只剩一行时禁删行），不留无反馈的死按钮 -->
    <template v-if="inTable">
      <div class="toolbar-divider"></div>
      <div class="toolbar-group">
        <span class="tb-group-label">表格</span>
        <button class="tb-btn tb-btn--txt" @click="editor?.chain().focus().addRowAfter().run()" title="在下方插入行">行+</button>
        <button class="tb-btn tb-btn--txt" :disabled="!editor?.can().deleteRow()" @click="editor?.chain().focus().deleteRow().run()" title="删除当前行">行−</button>
        <button class="tb-btn tb-btn--txt" @click="editor?.chain().focus().addColumnAfter().run()" title="在右侧插入列">列+</button>
        <button class="tb-btn tb-btn--txt" :disabled="!editor?.can().deleteColumn()" @click="editor?.chain().focus().deleteColumn().run()" title="删除当前列">列−</button>
        <button class="tb-btn tb-btn--txt" :class="{ active: editor?.isActive('tableHeader') }" @click="editor?.chain().focus().toggleHeaderRow().run()" title="切换表头行">表头</button>
        <button class="tb-btn tb-btn--txt tb-btn--danger" @click="editor?.chain().focus().deleteTable().run()" title="删除整个表格">删除表格</button>
      </div>
    </template>
    <!-- 图片上下文组（批 5 I7）：选中图片才出现——对齐三钮（再点取消回原样）+ alt 编辑；
         宽度由图片四角手柄拖拽（官方 resize 引擎，等比），无需工具栏介入 -->
    <template v-if="onImage">
      <div class="toolbar-divider"></div>
      <div class="toolbar-group">
        <span class="tb-group-label">图片</span>
        <button
          v-for="a in IMAGE_ALIGN_BUTTONS"
          :key="a.value"
          class="tb-btn"
          :class="{ active: imageAlign === a.value }"
          :title="a.title"
          :aria-label="a.title"
          @click="setImageAlign(a.value)"
        ><WsIcon :name="a.icon" size="xs" /></button>
        <input
          class="tb-img-alt"
          :value="imageAlt"
          placeholder="替代文本 alt"
          aria-label="图片替代文本"
          @change="onImageAltChange"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
      </div>
    </template>
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button class="tb-btn" @click="editor?.chain().focus().undo().run()" :disabled="!editor?.can().undo()" title="撤销" aria-label="撤销"><WsIcon name="undo" size="xs" /></button>
      <button class="tb-btn" @click="editor?.chain().focus().redo().run()" :disabled="!editor?.can().redo()" title="重做" aria-label="重做"><WsIcon name="redo" size="xs" /></button>
    </div>
    <div class="toolbar-spacer"></div>
    <!-- 四态视图切换（批 4 V8 三态 + 块 3「源码」）：编辑 / 分栏 / 预览 / 源码 -->
    <div class="nb-view-switch" role="group" aria-label="视图模式">
      <button class="nb-vs-btn" :class="{ active: viewMode === 'edit' }" title="编辑模式" @click="viewMode = 'edit'">编辑</button>
      <button class="nb-vs-btn" :class="{ active: viewMode === 'split' }" title="分栏实时预览" @click="viewMode = 'split'">分栏</button>
      <button class="nb-vs-btn" :class="{ active: viewMode === 'preview' }" title="预览模式" @click="viewMode = 'preview'">预览</button>
      <button class="nb-vs-btn" :class="{ active: viewMode === 'source' }" title="源码模式（md 真相源直读直写）" @click="viewMode = 'source'">源码</button>
    </div>
    <span class="save-status" :class="saveStatus">
      <WsInlineLoading v-if="saveStatus === 'saving'" size="sm" label="正在保存笔记" />
      {{ saveLabel }}
    </span>
    <span class="word-count">{{ wordCount }} 字</span>
  </div>
</template>

<script setup lang="ts">
// 笔记本编辑器工具栏（2026-10-18 从 NotebookTipTapEditor 拆出）：
// 只承载「对编辑器发命令」的呈现层——标题选择 / 行内与块级格式 / 表格与图片上下文组 /
// 四态视图切换 / 保存状态与字数。编辑器实例、视图态、保存态均由父组件以 props 注入。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { WsIcon, WsInlineLoading } from '@worldsea/ui-kit'
import { insertImageFilesInto } from '@/composables/imageInsert'
import { toastSuccess } from '@/composables/useToast'
import type { EditorViewMode } from './notebookEditorTypes'

/** 与 useNoteEditor 的 SaveStatus 同源（该类型未导出，避免改共享 composable 的导出面） */
type SaveStatus = 'saved' | 'saving' | 'unsaved'

const props = defineProps<{
  /** useNoteEditor 的 editor 为 shallowRef，未就绪时为 undefined（两种空态都要接受） */
  editor: Editor | null | undefined
  viewMode: EditorViewMode
  saveStatus: SaveStatus
  wordCount: number
}>()

const emit = defineEmits<{ 'update:viewMode': [EditorViewMode] }>()

const viewMode = computed({
  get: () => props.viewMode,
  set: (v: EditorViewMode) => emit('update:viewMode', v),
})

// 工具栏上下文响应（批 5 I7）：表格/图片上下文组依赖 selection 态（isActive），而
// 「点选节点/光标移动」不一定伴随输入（wordCount/saveStatus 不变）——需要显式 tick
// 驱动重渲，否则选中图片时「图片组」不出现。打字路径本就被 wordCount 触发 re-render，
// 此 tick 不增加实际渲染成本。拆件后由本组件自管：监听注入的编辑器实例。
const toolbarTick = ref(0)
let offTransaction: (() => void) | null = null
watch(
  () => props.editor,
  (ed) => {
    offTransaction?.()
    offTransaction = null
    if (!ed) return
    const handler = () => { toolbarTick.value++ }
    ed.on('transaction', handler)
    offTransaction = () => ed.off('transaction', handler)
  },
  { immediate: true },
)
onBeforeUnmount(() => { offTransaction?.() })

const headingLevel = computed(() => {
  if (!props.editor) return '0'
  for (let i = 1; i <= 3; i++) {
    if (props.editor.isActive('heading', { level: i })) return String(i)
  }
  return '0'
})

function setHeading(e: Event) {
  const val = parseInt((e.target as HTMLSelectElement).value, 10)
  if (val === 0) {
    props.editor?.chain().focus().setParagraph().run()
  } else {
    props.editor?.chain().focus().toggleHeading({ level: val as 1 | 2 | 3 }).run()
  }
}

// 图片插入（工具栏按钮 → 隐藏文件选择器）；粘贴 / 拖拽走 useNoteEditor 的 handlePaste/handleDrop
const imageInput = ref<HTMLInputElement | null>(null)
async function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // 允许连续选择同一文件
  if (!files.length) return
  const n = await insertImageFilesInto(props.editor, files)
  if (n > 0) toastSuccess(`已插入 ${n} 张图片（base64 存入正文，单张上限 2MB）`)
}

// ── 图片上下文（批 5 I7）：对齐 + alt（宽度由图片四角手柄拖拽）──
const IMAGE_ALIGN_BUTTONS = [
  { value: 'left', icon: 'align-left', title: '左对齐' },
  { value: 'center', icon: 'align-center', title: '居中对齐' },
  { value: 'right', icon: 'align-right', title: '右对齐' },
] as const

const inTable = computed(() => {
  void toolbarTick.value
  return props.editor?.isActive('table') ?? false
})
const onImage = computed(() => {
  void toolbarTick.value
  return props.editor?.isActive('image') ?? false
})
const imageAlign = computed(() => {
  void toolbarTick.value
  return (props.editor?.getAttributes('image').align as string | null) ?? null
})
const imageAlt = computed(() => {
  void toolbarTick.value
  return (props.editor?.getAttributes('image').alt as string | null) ?? ''
})

/** 点当前对齐 → 取消回原样（null）；换一个 → 应用 */
function setImageAlign(v: 'left' | 'center' | 'right'): void {
  const ed = props.editor
  if (!ed) return
  const cur = ed.getAttributes('image').align
  ed.chain().focus().updateAttributes('image', { align: cur === v ? null : v }).run()
}

function onImageAltChange(e: Event): void {
  props.editor?.chain().focus().updateAttributes('image', { alt: (e.target as HTMLInputElement).value }).run()
}

const saveLabel = computed(() => {
  switch (props.saveStatus) {
    case 'saved': return '已保存'
    case 'saving': return '保存中...'
    case 'unsaved': return '未保存'
  }
})
</script>

<style scoped>
.nb-tt-toolbar {
  display: flex; align-items: center; gap: 4px; padding: 6px 10px;
  border-bottom: 1px solid var(--color-border-subtle); background: var(--color-bg-surface);
  flex-shrink: 0; flex-wrap: wrap; font-family: var(--font-family-editor-ui);
}
.toolbar-group { display: flex; gap: 2px; }
.toolbar-divider { width: 1px; height: 20px; background: var(--color-border-subtle); margin: 0 4px; }
.toolbar-spacer { flex: 1; }
.tb-btn {
  width: 28px; height: 28px; border: none; background: transparent;
  cursor: pointer; border-radius: var(--radius-xs); font-size: var(--font-size-sm);
  color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center;
}
.tb-btn:hover { background: var(--color-bg-hover); }
.tb-btn.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.tb-btn:disabled { opacity: 0.3; cursor: default; }
/* 工具栏内嵌的隐藏文件选择器（插入图片按钮触发） */
.tb-hidden-input { display: none; }
/* 文字按钮（表格结构操作）：宽度随文字，与图标按钮同高 */
.tb-btn--txt { width: auto; min-width: 28px; padding: 0 7px; font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); }
.tb-btn--danger { color: var(--color-danger); }
.tb-btn--danger:hover { background: var(--danger-soft); }
.tb-group-label { font-size: var(--font-size-2xs); color: var(--color-text-tertiary); align-self: center; padding-right: 2px; user-select: none; }
/* 图片 alt 输入框（批 5 I7）：图片上下文组内联，窄宽、与按钮同高 */
.tb-img-alt {
  width: 150px; height: 24px; padding: 0 8px; margin-left: 2px;
  border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  background: var(--color-bg-base); color: var(--color-text-primary);
  font-size: var(--font-size-xs); outline: none;
}
.tb-img-alt:focus { border-color: var(--color-primary); }
.toolbar-select {
  padding: 2px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  font-size: var(--font-size-sm); background: var(--color-bg-base); color: var(--color-text-primary);
}
/* 四态视图切换（批 4 V8）：编辑 / 分栏 / 预览 / 源码 分段控件 */
.nb-view-switch { display: inline-flex; border: 1px solid var(--color-border); border-radius: var(--radius-xs); overflow: hidden; }
.nb-vs-btn {
  padding: 3px 10px; border: none; background: transparent;
  color: var(--color-text-secondary); font-size: var(--font-size-xs); cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.nb-vs-btn + .nb-vs-btn { border-left: 1px solid var(--color-border); }
.nb-vs-btn:hover { background: var(--color-bg-hover); }
.nb-vs-btn.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.save-status { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); margin-right: 8px; }
.save-status.saved { color: var(--color-text-tertiary); }
.save-status.saving { color: var(--color-primary); }
.save-status.unsaved { color: var(--color-warning); }
.word-count { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
</style>

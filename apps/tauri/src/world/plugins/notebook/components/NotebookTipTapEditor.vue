<template>
  <div class="nb-tiptap-editor">
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
        <button class="tb-btn" @click="editor?.chain().focus().setHorizontalRule().run()" title="分割线" aria-label="分割线"><WsIcon name="minus" size="xs" /></button>
        <button class="tb-btn" @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()" title="插入表格" aria-label="插入表格"><WsIcon name="table" size="xs" /></button>
        <button class="tb-btn" @click="imageInput?.click()" title="插入图片（本地文件，≤2MB）" aria-label="插入图片"><WsIcon name="image" size="xs" /></button>
        <input ref="imageInput" type="file" accept="image/*" multiple class="tb-hidden-input" @change="onPickImages" />
      </div>
      <!-- 表格上下文组：光标在表格内才出现（结构操作）；禁用态由 can() 判定（如只剩一行时禁删行），不留无反馈的死按钮 -->
      <template v-if="editor?.isActive('table')">
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
      <div class="toolbar-divider"></div>
      <div class="toolbar-group">
        <button class="tb-btn" @click="editor?.chain().focus().undo().run()" :disabled="!editor?.can().undo()" title="撤销" aria-label="撤销"><WsIcon name="undo" size="xs" /></button>
        <button class="tb-btn" @click="editor?.chain().focus().redo().run()" :disabled="!editor?.can().redo()" title="重做" aria-label="重做"><WsIcon name="redo" size="xs" /></button>
      </div>
      <div class="toolbar-spacer"></div>
      <button class="nb-preview-toggle" :class="{ active: showPreview }" @click="showPreview = !showPreview" :title="showPreview ? '切回编辑' : '切换到预览'">
        <WsIcon :name="showPreview ? 'edit' : 'eye'" size="xs" /> {{ showPreview ? '编辑' : '预览' }}
      </button>
      <span class="save-status" :class="saveStatus">{{ saveLabel }}</span>
      <span class="word-count">{{ wordCount }} 字</span>
    </div>
    <div class="nb-tt-body">
      <div v-if="!showPreview" class="nb-editor-wrap">
        <EditorContent v-if="editor" :editor="editor" />
        <textarea v-else v-model="fallbackContent" class="editor-fallback" aria-label="文本编辑器（备选）" @input="onFallbackInput" />
      </div>
      <div v-else class="nb-preview-wrap" v-html="previewHtml"></div>
    </div>
    <MentionPopover ref="mentionPopoverRef" @select="onMentionSelect" @close="() => {}" />
    <SlashCommandMenu ref="slashCommandMenuRef" @select="onSlashCommandSelect" @close="() => {}" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import { WsIcon } from '@worldsea/ui-kit'
import { sanitizeMarkdownHtml } from '@worldsea/shared-ui/markdown'
import MentionPopover from './MentionPopover.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { useNoteEditor } from '../composables/useNoteEditor'
import { SLASH_COMMANDS, type SlashCommandItem } from '../composables/slashCommandExtension'
import { normalizeNoteContent } from '../contentNormalize'
import { insertImageFilesInto } from '@/composables/imageInsert'
import { toastSuccess, toastWarn } from '@/composables/useToast'
import type { Entity } from '@worldsea/entity-core'

type SlashCommandPopoverApi = {
  open: (clientRect: (() => DOMRect | null) | null, items: SlashCommandItem[]) => void
  close: () => void
  updateItems: (items: SlashCommandItem[]) => void
  onKeyDown: (event: KeyboardEvent) => boolean
}

const props = defineProps<{ note: Entity }>()
const emit = defineEmits<{ contentChange: [html: string] }>()

const showPreview = ref(false)
const fallbackContent = ref(String(props.note.properties?.content || ''))

// 图片插入（工具栏按钮 → 隐藏文件选择器）；粘贴 / 拖拽走 useNoteEditor 的 handlePaste/handleDrop
const imageInput = ref<HTMLInputElement | null>(null)
async function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // 允许连续选择同一文件
  if (!files.length) return
  const n = await insertImageFilesInto(editor.value, files)
  if (n > 0) toastSuccess(`已插入 ${n} 张图片（base64 存入正文，单张上限 2MB）`)
}

function onFallbackInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  fallbackContent.value = val
  // 与装载网关同语义：编辑器未就绪窗口的输入也归一，避免纯文本绕过边界进内容流
  emit('contentChange', normalizeNoteContent(val))
}

const {
  editor,
  saveStatus,
  wordCount,
  loadNote,
  setMentionPopover,
  onMentionSelect,
  setSlashCommandPopover,
  setSlashCommandCallback,
  onSlashCommandSelect,
} = useNoteEditor(
  computed(() => props.note),
  (html) => emit('contentChange', html),
)

const mentionPopoverRef = ref<{ open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null>(null)
const slashCommandMenuRef = ref<SlashCommandPopoverApi | null>(null)

onMounted(() => {
  setMentionPopover(mentionPopoverRef.value)
  setSlashCommandPopover(slashCommandMenuRef.value)
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
  if (id && id !== oldId) loadNote(props.note)
})

const headingLevel = computed(() => {
  if (!editor.value) return '0'
  for (let i = 1; i <= 3; i++) {
    if (editor.value.isActive('heading', { level: i })) return String(i)
  }
  return '0'
})

const saveLabel = computed(() => {
  switch (saveStatus.value) {
    case 'saved': return '已保存'
    case 'saving': return '保存中...'
    case 'unsaved': return '未保存'
  }
})

const previewHtml = computed(() => {
  // 编辑器产物是 HTML（非 markdown）——历史实现 marked.parse(getHTML()) 是概念错位：
  // HTML passthrough 靠运气，而未解析的外部 md 文本反而会在预览「突然」渲染，与编辑态
  // 自相矛盾。现与编辑态同源：HTML 经 DOMPurify 消毒直渲染（2026-10-11 装载网关配套）。
  return sanitizeMarkdownHtml(editor.value?.getHTML() || '')
})

function setHeading(e: Event) {
  const val = parseInt((e.target as HTMLSelectElement).value, 10)
  if (val === 0) {
    editor.value?.chain().focus().setParagraph().run()
  } else {
    editor.value?.chain().focus().toggleHeading({ level: val as 1 | 2 | 3 }).run()
  }
}

onBeforeUnmount(() => {
  setSlashCommandCallback(null as any)
})
</script>

<style scoped>
.nb-tiptap-editor { display: flex; flex-direction: column; height: 100%; }
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
.toolbar-select {
  padding: 2px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  font-size: var(--font-size-sm); background: var(--color-bg-base); color: var(--color-text-primary);
}
.nb-preview-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  font-size: var(--font-size-xs); background: transparent; color: var(--color-text-secondary); cursor: pointer;
}
.nb-preview-toggle.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); border-color: var(--color-primary); }
.save-status { font-size: var(--font-size-xs); margin-right: 8px; }
.save-status.saved { color: var(--color-text-tertiary); }
.save-status.saving { color: var(--color-primary); }
.save-status.unsaved { color: var(--color-warning); }
.word-count { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }

.nb-tt-body { flex: 1; overflow: auto; padding: 16px 20px; }
.nb-editor-wrap { height: 100%; }
.nb-editor-wrap :deep(.tiptap) {
  outline: none; min-height: 200px; font-family: var(--font-family-content);
  font-size: var(--font-size-base); line-height: 1.7; color: var(--color-text-primary);
}
.nb-editor-wrap :deep(.tiptap h1) { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin: 20px 0 12px; }
.nb-editor-wrap :deep(.tiptap h2) { font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin: 16px 0 10px; }
.nb-editor-wrap :deep(.tiptap h3) { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 12px 0 8px; }
.nb-editor-wrap :deep(.tiptap p) { margin: 0 0 8px; }
.nb-editor-wrap :deep(.tiptap blockquote) {
  border-left: 3px solid var(--color-primary); padding-left: 12px; margin: 8px 0; color: var(--color-text-secondary);
}
.nb-editor-wrap :deep(.tiptap ul), .nb-editor-wrap :deep(.tiptap ol) { padding-left: 20px; margin: 8px 0; }
.nb-editor-wrap :deep(.tiptap hr) { border: none; border-top: 1px solid var(--color-border-subtle); margin: 16px 0; }
.nb-editor-wrap :deep(.tiptap code) { background: var(--color-bg-hover); padding: 2px 4px; border-radius: var(--radius-2xs); font-size: var(--font-size-sm); }
.nb-editor-wrap :deep(.tiptap pre) {
  background: var(--color-bg-hover); padding: 12px; border-radius: var(--radius-sm); overflow-x: auto;
  font-size: var(--font-size-sm); margin: 8px 0;
}
.nb-editor-wrap :deep(.nb-mention) {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary); padding: 1px 6px; border-radius: var(--radius-xs);
  font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); cursor: pointer;
}
.nb-editor-wrap :deep(.nb-mention:hover) { background: var(--color-primary); color: var(--on-accent); }

/* ── 图片（三期前置）：块级 img，宽度自适应不越界；选中态与表格选中同色 ── */
.nb-editor-wrap :deep(.tiptap img) {
  max-width: 100%; height: auto; display: block; margin: 8px 0;
  border-radius: var(--radius-sm);
}
.nb-editor-wrap :deep(.tiptap img.ProseMirror-selectednode) {
  outline: 2px solid var(--color-primary); outline-offset: 2px;
}
.nb-preview-wrap :deep(img) { max-width: 100%; height: auto; border-radius: var(--radius-sm); }

/* ── 表格（二期）：TipTap 官方建议的最小样式集 + 主题令牌化 ── */
.nb-editor-wrap :deep(.tiptap .tableWrapper) { overflow-x: auto; margin: 8px 0; }
.nb-editor-wrap :deep(.tiptap table) {
  border-collapse: collapse; table-layout: fixed; width: 100%; overflow: hidden;
}
.nb-editor-wrap :deep(.tiptap th),
.nb-editor-wrap :deep(.tiptap td) {
  border: 1px solid var(--color-border); padding: 4px 8px; vertical-align: top; position: relative;
  min-width: var(--table-cell-min-width, 3em);
}
.nb-editor-wrap :deep(.tiptap th) {
  background: var(--color-bg-muted); font-weight: var(--font-weight-semibold); text-align: left;
}
/* 多选单元格高亮（拖选 / shift 选区） */
.nb-editor-wrap :deep(.tiptap .selectedCell::after) {
  content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}
/* 列宽拖拽手柄（resizable: true） */
.nb-editor-wrap :deep(.tiptap .column-resize-handle) {
  position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px; z-index: 20;
  background: var(--color-primary); pointer-events: none;
}
.nb-editor-wrap :deep(.tiptap.resize-cursor) { cursor: col-resize; }

.nb-preview-wrap { font-family: var(--font-family-content); font-size: var(--font-size-base); line-height: 1.7; color: var(--color-text-primary); }
.nb-preview-wrap :deep(h1) { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin: 20px 0 12px; }
.nb-preview-wrap :deep(h2) { font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin: 16px 0 10px; }
.nb-preview-wrap :deep(h3) { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 12px 0 8px; }
.nb-preview-wrap :deep(blockquote) {
  border-left: 3px solid var(--color-primary); padding-left: 12px; margin: 8px 0; color: var(--color-text-secondary);
}
.nb-preview-wrap :deep(code) { background: var(--color-bg-hover); padding: 2px 4px; border-radius: var(--radius-2xs); font-size: var(--font-size-sm); }
.nb-preview-wrap :deep(pre) { background: var(--color-bg-hover); padding: 12px; border-radius: var(--radius-sm); overflow-x: auto; margin: 8px 0; }
/* 预览侧表格：marked 渲染 GFM 表格（与编辑态同观感） */
.nb-preview-wrap :deep(table) { border-collapse: collapse; width: 100%; margin: 8px 0; }
.nb-preview-wrap :deep(th),
.nb-preview-wrap :deep(td) { border: 1px solid var(--color-border); padding: 4px 8px; text-align: left; vertical-align: top; }
.nb-preview-wrap :deep(th) { background: var(--color-bg-muted); font-weight: var(--font-weight-semibold); }

.editor-fallback { width: 100%; height: 100%; min-height: 200px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); padding: 12px; font-family: var(--font-family-content); font-size: var(--font-size-base); line-height: 1.7; color: var(--color-text-primary); background: var(--color-bg-base); resize: vertical; outline: none; }
.editor-fallback:focus { border-color: var(--color-primary); }
.editor-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-tertiary); }
</style>

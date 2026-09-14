<template>
  <div class="editor-toolbar">
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
      <button class="tb-btn" :class="{ active: editor?.isActive('bold') }" @click="editor?.chain().focus().toggleBold().run()" title="粗体"><b>B</b></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('italic') }" @click="editor?.chain().focus().toggleItalic().run()" title="斜体"><i>I</i></button>
      <button class="tb-btn" :class="{ active: editor?.isActive('strike') }" @click="editor?.chain().focus().toggleStrike().run()" title="删除线"><s>S</s></button>
    </div>
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button class="tb-btn" :class="{ active: editor?.isActive('blockquote') }" @click="editor?.chain().focus().toggleBlockquote().run()" title="引用">"</button>
      <button class="tb-btn" :class="{ active: editor?.isActive('bulletList') }" @click="editor?.chain().focus().toggleBulletList().run()" title="无序列表">•</button>
      <button class="tb-btn" :class="{ active: editor?.isActive('orderedList') }" @click="editor?.chain().focus().toggleOrderedList().run()" title="有序列表">1.</button>
      <button class="tb-btn" @click="editor?.chain().focus().setHorizontalRule().run()" title="分割线">—</button>
      <button class="tb-btn" @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()" title="插入表格">⊞</button>
      <button class="tb-btn" @click="imageInput?.click()" title="插入图片（本地文件，≤2MB）">图</button>
      <input ref="imageInput" type="file" accept="image/*" multiple class="tb-hidden-input" @change="onPickImages" />
    </div>
    <!-- 表格上下文组：光标在表格内才出现；禁用态由 can() 判定（如只剩一行时禁删行），不留无反馈的死按钮。
         注：本工具栏仍是字符风格（图标化是笔记本侧 257fd8a 的事，文稿侧挂账未做），故沿用字符/文字风格保持内部一致 -->
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
      <button class="tb-btn" @click="editor?.chain().focus().undo().run()" :disabled="!editor?.can().undo()" title="撤销">↩</button>
      <button class="tb-btn" @click="editor?.chain().focus().redo().run()" :disabled="!editor?.can().redo()" title="重做">↪</button>
    </div>
    <div class="toolbar-spacer"></div>
    <span class="save-status" :class="saveStatus">{{ saveLabel }}</span>
    <span class="word-count">{{ wordCount }} 字</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { insertImageFilesInto } from '@/composables/imageInsert'
import { toastSuccess } from '@/composables/useToast'

const props = defineProps<{
  editor: Editor | null
  saveStatus: 'saved' | 'saving' | 'unsaved'
  wordCount: number
}>()

// 图片插入（工具栏按钮 → 隐藏文件选择器）；粘贴 / 拖拽走 useChapterEditor 的 handlePaste/handleDrop
const imageInput = ref<HTMLInputElement | null>(null)
async function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // 允许连续选择同一文件
  if (!files.length) return
  const n = await insertImageFilesInto(props.editor, files)
  if (n > 0) toastSuccess(`已插入 ${n} 张图片（base64 存入正文，单张上限 2MB）`)
}

const headingLevel = computed(() => {
  if (!props.editor) return '0'
  for (let i = 1; i <= 3; i++) {
    if (props.editor.isActive('heading', { level: i })) return String(i)
  }
  return '0'
})

const saveLabel = computed(() => {
  switch (props.saveStatus) {
    case 'saved': return '已保存 ✓'
    case 'saving': return '保存中...'
    case 'unsaved': return '未保存'
  }
})

function setHeading(e: Event) {
  const val = parseInt((e.target as HTMLSelectElement).value, 10)
  if (val === 0) {
    props.editor?.chain().focus().setParagraph().run()
  } else {
    props.editor?.chain().focus().toggleHeading({ level: val as 1 | 2 | 3 }).run()
  }
}
</script>

<style scoped>
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-light);
  background: var(--menubar-bg);
  flex-shrink: 0;
  flex-wrap: wrap;
  font-family: var(--font-family-editor-ui);
}
.toolbar-group { display: flex; gap: 2px; }
.toolbar-divider { width: 1px; height: 20px; background: var(--border-light); margin: 0 4px; }
.toolbar-spacer { flex: 1; }
.tb-btn {
  width: 28px; height: 28px; border: none; background: transparent;
  cursor: pointer; border-radius: var(--radius-xs); font-size: var(--font-size-sm);
  color: var(--text-secondary); display: flex; align-items: center; justify-content: center;
}
.tb-btn:hover { background: var(--hover-bg); }
.tb-btn.active { background: var(--active-bg); color: var(--primary); }
.tb-btn:disabled { opacity: 0.3; cursor: default; }
/* 工具栏内嵌的隐藏文件选择器（插入图片按钮触发） */
.tb-hidden-input { display: none; }
/* 文字按钮（表格结构操作）：宽度随文字，与图标按钮同高 */
.tb-btn--txt { width: auto; min-width: 28px; padding: 0 7px; font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); }
.tb-btn--danger { color: var(--color-danger); }
.tb-btn--danger:hover { background: var(--danger-soft); }
.tb-group-label { font-size: var(--font-size-2xs); color: var(--text-tertiary); align-self: center; padding-right: 2px; user-select: none; }
.toolbar-select {
  padding: 2px 6px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text-color);
}
.save-status { font-size: var(--font-size-xs); margin-right: 8px; }
.save-status.saved { color: var(--text-tertiary); }
.save-status.saving { color: var(--primary); }
.save-status.unsaved { color: var(--warning); }
.word-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>

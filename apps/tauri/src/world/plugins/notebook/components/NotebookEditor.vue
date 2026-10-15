<template>
  <div class="nb-editor">
    <div class="nb-editor-header">
      <input v-model="editName" class="nb-editor-title" placeholder="笔记标题" @change="emitUpdate()" />
      <button class="nb-export-btn" title="导出当前笔记（TXT / Markdown / DOCX）" @click="$emit('export')"><WsIcon name="item" size="sm" /></button>
      <select v-model="editFolder" class="nb-editor-folder" @change="emitUpdate()">
        <option value="">未分类</option>
        <option v-for="f in folders" :key="f.id" :value="f.id"><WsIcon name="folder" size="xs" /> {{ f.name }}</option>
      </select>
      <select v-model="editType" class="nb-editor-type" @change="emitUpdate()">
        <option v-for="t in NOTE_TYPES" :key="t.value" :value="t.value">{{ t.icon }} {{ t.label }}</option>
      </select>
      <button
        class="nb-export-btn"
        :title="editTags.length ? '编辑标签' : '添加标签'"
        @click="startTagEdit"
      ><WsIcon name="tag" size="sm" /></button>
    </div>
    <!-- 标签行（批 3 I8）：实体顶层 tags；有标签或正在输入时显示 -->
    <div v-if="editTags.length > 0 || tagEditing" class="nb-editor-tags">
      <span v-for="tag in editTags" :key="tag" class="nb-tag-chip">
        {{ tag }}
        <button class="nb-tag-del" :title="`移除标签 ${tag}`" @click="removeTag(tag)"><WsIcon name="close" size="2xs" /></button>
      </span>
      <input
        ref="tagInputRef"
        v-model="tagDraft"
        class="nb-tag-input"
        placeholder="新标签，回车添加"
        @keydown.enter.prevent="addTag"
        @keydown.escape="tagEditing = false; tagDraft = ''"
        @blur="tagEditing = false; tagDraft = ''"
      />
    </div>
    <div class="nb-editor-body">
      <ErrorBoundary message="编辑器加载失败">
        <CodeCell
          v-if="editType === 'code'"
          :code="editContent"
          :language="editLanguage"
          @update="editContent = $event; emitUpdate({ skipUndo: true })"
          @run="onCodeRun"
          @language-change="editLanguage = $event; emitUpdate()"
        />
        <NotebookTipTapEditor
          v-else
          :note="note"
          @contentChange="onContentChange"
          @navigate="$emit('navigate', $event)"
        />
      </ErrorBoundary>
    </div>
    <!-- 反向链接面板（块 2 阶段 4：picker 已退役——建联唯一入口＝正文 `[[`，
         关系由保存后派生落库；面板为纯展示） -->
    <BacklinkPanel :links="backlinkNotes" @navigate="$emit('navigate', $event)" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import type { Relation } from '@worldsea/entity-core'
import CodeCell from './CodeCell.vue'
import ErrorBoundary from './ErrorBoundary.vue'
import NotebookTipTapEditor from './NotebookTipTapEditor.vue'
import BacklinkPanel from './BacklinkPanel.vue'
import { NOTE_TYPES } from '../notebookConfig'
import type { NotebookEntity } from '../types'

interface NotebookFolder {
  id: string
  name: string
}

const props = defineProps<{ note: NotebookEntity; folders: NotebookFolder[] }>()
const emit = defineEmits<{
  update: [data: { id: string; changes: Record<string, unknown>; skipUndo?: boolean }]
  navigate: [id: string]
  export: []
}>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()

const editName = ref(props.note.name || '')
const editContent = ref(String(props.note.properties?.content || ''))
const editType = ref(String(props.note.properties?.noteType || 'markdown'))
const editLanguage = ref(String(props.note.properties?.codeLanguage || 'javascript'))
const editFolder = ref(String(props.note.properties?.folderId || ''))

// ── 标签（批 3 I8）：实体顶层 tags；离散元数据变更，保留撤销 ──
const editTags = ref<string[]>([...(props.note.tags ?? [])])
const tagEditing = ref(false)
const tagDraft = ref('')
const tagInputRef = ref<HTMLInputElement | null>(null)

function emitTags(next: string[]): void {
  editTags.value = next
  emit('update', { id: props.note.id, changes: { tags: next } })
}

function addTag(): void {
  const tag = tagDraft.value.trim()
  if (!tag) return
  if (!editTags.value.includes(tag)) emitTags([...editTags.value, tag])
  tagDraft.value = ''
}

function removeTag(tag: string): void {
  emitTags(editTags.value.filter(t => t !== tag))
}

function startTagEdit(): void {
  tagEditing.value = true
  void nextTick(() => tagInputRef.value?.focus())
}

// 仅切换笔记时重置本地编辑态（按 id 判断，勿按对象引用）——按引用会在保存回流
// （store 按引用替换）时误重置，窄时序下可冲掉用户正在输入的标题（2026-10-11 修复）。
watch(() => props.note?.id, (id, oldId) => {
  const n = props.note
  if (!n || !id || id === oldId) return
  editName.value = n.name || ''
  editContent.value = String(n.properties?.content || '')
  editType.value = String(n.properties?.noteType || 'markdown')
  editLanguage.value = String(n.properties?.codeLanguage || 'javascript')
  editFolder.value = String(n.properties?.folderId || '')
  editTags.value = [...(n.tags ?? [])]
  tagEditing.value = false
  tagDraft.value = ''
})

const backlinkNotes = computed(() => {
  const rels = relationStore.relations.filter(
    (r: Relation) => r.type === 'note_link' && r.targetId === props.note.id
  )
  const sourceIds = rels.map((r: Relation) => r.sourceId)
  return entityStore.entities.filter((e) => sourceIds.includes(e.id))
})

/**
 * 富文本正文不再经本组件回写 —— 见 useNoteEditor：它独占持久化富文本正文
 * （300ms 防抖 + skipUndo）。此处只同步本地状态（md 形态，块 1 阶段 3 起），
 * 供 CodeCell 的 code 型取值。
 * 此前每次按键都会 emit → 与 useNoteEditor 形成「一次输入两次写库」的双写入。
 */
function onContentChange(md: string): void {
  editContent.value = md
}

/**
 * 上报元数据变更（名称/文件夹/类型）。
 * @param opts.skipUndo 内容型自动保存传 true；离散的元数据变更不传（保留可撤销）。
 *
 * **只上报本组件负责的字段**，不做 `...props.note.properties` 全量快照 —— 全量快照是
 * emit 时刻的值，经 400ms 防抖落库时会覆盖掉期间由 useNoteEditor 写入的新正文。
 * 落库方（NotebookView.flushPendingWrites）会把这些字段合并到实体的最新 properties 上。
 *
 * 注：content 仅在 code 型笔记时上报 —— code 型走 CodeCell，没有 useNoteEditor 保底。
 */
function emitUpdate(opts?: { skipUndo?: boolean }): void {
  const properties: Record<string, unknown> = {
    noteType: editType.value,
    codeLanguage: editLanguage.value,
    folderId: editFolder.value,
  }
  if (editType.value === 'code') properties.content = editContent.value
  emit('update', {
    id: props.note.id,
    changes: { name: editName.value, properties },
    skipUndo: opts?.skipUndo,
  })
}

function onCodeRun(output: string): void {
  entityStore.update(props.note.id, {
    properties: {
      ...props.note.properties,
      codeOutput: output,
      content: editContent.value,
    },
  })
}
</script>

<style scoped>
.nb-editor { display: flex; flex-direction: column; height: 100%; }
.nb-editor-header { display: flex; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--color-border-subtle); align-items: center; background: var(--color-bg-surface); font-family: var(--font-family-editor-ui); }
.nb-editor-title { flex: 1; background: transparent; border: none; color: var(--color-text-primary); font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); outline: none; }
.nb-export-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--color-text-tertiary); cursor: pointer; flex-shrink: 0; transition: background 0.15s, color 0.15s; }
.nb-export-btn:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.nb-editor-folder { padding: 4px 8px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: var(--color-bg-base); color: var(--color-text-secondary); font-size: var(--font-size-sm); outline: none; max-width: 140px; }
.nb-editor-type { padding: 4px 8px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: var(--color-bg-base); color: var(--color-text-secondary); font-size: var(--font-size-sm); outline: none; }
.nb-editor-folder option, .nb-editor-type option { background: var(--color-bg-surface); color: var(--color-text-primary); }
.nb-editor-body { flex: 1; overflow: hidden; }

/* 标签行（批 3 I8） */
.nb-editor-tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 16px 0; align-items: center; }
.nb-tag-chip {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 2px 4px 2px 8px; border-radius: var(--radius-2xs);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary); font-size: var(--font-size-2xs);
}
.nb-tag-del {
  display: flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; padding: 0; border: none; border-radius: var(--radius-2xs);
  background: transparent; color: var(--color-primary); opacity: 0.6; cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.nb-tag-del:hover { opacity: 1; background: color-mix(in srgb, var(--color-primary) 25%, transparent); }
.nb-tag-input {
  width: 110px; padding: 2px 6px; border: 1px solid var(--color-border);
  border-radius: var(--radius-2xs); background: var(--color-bg-base);
  color: var(--color-text-primary); font-size: var(--font-size-2xs); outline: none;
}
.nb-tag-input:focus { border-color: var(--color-primary); }
</style>

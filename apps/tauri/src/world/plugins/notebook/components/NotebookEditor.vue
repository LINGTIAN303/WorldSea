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
        />
      </ErrorBoundary>
    </div>
    <BacklinkPanel :links="backlinkNotes" @navigate="$emit('navigate', $event)" @createLink="showLinkPicker = true" />
    <div v-if="showLinkPicker" class="nb-link-picker-overlay" @click.self="showLinkPicker = false">
      <div class="nb-link-picker">
        <div class="nlp-header">
          <span>创建链接</span>
          <button class="nlp-close" @click="showLinkPicker = false"><WsIcon name="close" size="xs" /></button>
        </div>
        <input v-model="linkSearch" class="nlp-search" placeholder="搜索笔记..." />
        <div class="nlp-list">
          <div
            v-for="n in linkableNotes"
            :key="n.id"
            class="nlp-item"
            @click="createLink(n.id)"
          >
            <WsIcon :name="getNoteIcon(n)" size="xs" />
            <span class="nlp-item-name">{{ n.name }}</span>
          </div>
          <div v-if="linkableNotes.length === 0" class="nlp-empty">无匹配笔记</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore, useBidirectional } from '@worldsea/entity-core'
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
const { createBidirectional } = useBidirectional()

const editName = ref(props.note.name || '')
const editContent = ref(String(props.note.properties?.content || ''))
const editType = ref(String(props.note.properties?.noteType || 'markdown'))
const editLanguage = ref(String(props.note.properties?.codeLanguage || 'javascript'))
const editFolder = ref(String(props.note.properties?.folderId || ''))

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
 * （300ms 防抖 + skipUndo）。此处只同步本地状态，供 CodeCell 的 code 型取值。
 * 此前每次按键都会 emit → 与 useNoteEditor 形成「一次输入两次写库」的双写入。
 */
function onContentChange(html: string): void {
  editContent.value = html
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

const showLinkPicker = ref(false)
const linkSearch = ref('')

const linkableNotes = computed(() => {
  const all = entityStore.entities.filter((e): e is NotebookEntity => e.type === 'notebook' && e.id !== props.note.id)
  if (!linkSearch.value) return all.slice(0, 50)
  const q = linkSearch.value.toLowerCase()
  return all.filter(n => n.name.toLowerCase().includes(q)).slice(0, 50)
})

function getNoteIcon(note: NotebookEntity): string {
  const noteType = note.properties?.noteType || 'markdown'
  return NOTE_TYPES.find(t => t.value === noteType)?.icon || 'edit'
}

async function createLink(targetId: string): Promise<void> {
  await createBidirectional({ type: 'note_link', sourceId: props.note.id, targetId })
  showLinkPicker.value = false
  linkSearch.value = ''
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

.nb-link-picker-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.nb-link-picker { background: var(--color-bg-surface); border-radius: var(--radius-mid); width: 360px; max-height: 400px; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.nlp-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); border-bottom: 1px solid var(--color-border-subtle); }
.nlp-close { padding: 2px 6px; border: none; background: transparent; color: var(--color-text-tertiary); cursor: pointer; border-radius: var(--radius-xs); }
.nlp-close:hover { background: var(--color-bg-hover); }
.nlp-search { margin: 8px 12px; padding: 6px 8px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); outline: none; }
.nlp-search:focus { border-color: var(--color-primary); }
.nlp-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
.nlp-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-primary); }
.nlp-item:hover { background: var(--color-bg-hover); }
.nlp-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nlp-empty { padding: 16px; text-align: center; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
</style>

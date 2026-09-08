<template>
  <div class="nb-editor">
    <div class="nb-editor-header">
      <input v-model="editName" class="nb-editor-title" placeholder="笔记标题" @change="emitUpdate" />
      <select v-model="editFolder" class="nb-editor-folder" @change="emitUpdate">
        <option value="">未分类</option>
        <option v-for="f in folders" :key="f.id" :value="f.id"><WsIcon name="folder" size="xs" /> {{ f.name }}</option>
      </select>
      <select v-model="editType" class="nb-editor-type" @change="emitUpdate">
        <option v-for="t in NOTE_TYPES" :key="t.value" :value="t.value">{{ t.icon }} {{ t.label }}</option>
      </select>
    </div>
    <div class="nb-editor-body">
      <ErrorBoundary message="编辑器加载失败">
        <CodeCell
          v-if="editType === 'code'"
          :code="editContent"
          :language="editLanguage"
          @update="editContent = $event; emitUpdate()"
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
const emit = defineEmits<{ update: [data: { id: string; changes: Record<string, unknown> }]; navigate: [id: string] }>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { createBidirectional } = useBidirectional()

const editName = ref(props.note.name || '')
const editContent = ref(String(props.note.properties?.content || ''))
const editType = ref(String(props.note.properties?.noteType || 'markdown'))
const editLanguage = ref(String(props.note.properties?.codeLanguage || 'javascript'))
const editFolder = ref(String(props.note.properties?.folderId || ''))

watch(() => props.note, (n) => {
  if (!n) return
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

function onContentChange(html: string): void {
  editContent.value = html
  emitUpdate()
}

function emitUpdate(): void {
  emit('update', {
    id: props.note.id,
    changes: {
      name: editName.value,
      properties: {
        ...props.note.properties,
        content: editContent.value,
        noteType: editType.value,
        codeLanguage: editLanguage.value,
        folderId: editFolder.value,
      },
    },
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

<template>
  <div class="en-node" :class="[`en-${nodeType}`, { 'en-editing': isEditing }]" @click="onClick">
    <div class="en-left">
      <span v-if="node.type === 'custom'" class="en-icon"><WsIcon :name="categoryIcon" size="xs" /></span>
      <span v-else class="en-icon en-icon-rel">{{ relLabel }}</span>
      <div class="en-dot"></div>
    </div>
    <div class="en-body">
      <span class="en-date">{{ displayDate }}</span>
      <template v-if="node.type === 'custom' && !isEditing">
        <span class="en-title">{{ node.event.title }}</span>
        <p v-if="node.event.description" class="en-desc">{{ node.event.description }}</p>
      </template>
      <template v-else-if="node.type === 'custom' && isEditing">
        <input v-model="editData.title" class="en-input" placeholder="标题" />
        <textarea v-model="editData.description" class="en-textarea" placeholder="描述" rows="2"></textarea>
        <div class="en-edit-row">
          <input v-model="editData.date" class="en-input en-input-sm" placeholder="日期" />
          <select v-model="editData.category" class="en-select">
            <option value="birth">出生</option>
            <option value="growth">成长</option>
            <option value="turning">转折</option>
            <option value="death">死亡</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div class="en-edit-actions">
          <button class="en-btn-sm" @click.stop="saveEdit">保存</button>
          <button class="en-btn-sm en-btn-cancel" @click.stop="cancelEdit">取消</button>
          <button class="en-btn-sm en-btn-danger" @click.stop="$emit('delete', node.id)">删除</button>
        </div>
      </template>
      <template v-else-if="node.type === 'relation'">
        <span class="en-title">{{ entityName }}</span>
        <p v-if="entityDesc" class="en-desc">{{ entityDesc }}</p>
        <button class="en-link" @click.stop="$emit('viewEntity', node.entityId)">查看</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import { getRelationLabel } from '@worldsmith/entity-core'
import { WsIcon } from '@worldsmith/ui-kit'

export interface CustomLifeEvent {
  id: string
  date: string
  title: string
  description: string
  category: 'birth' | 'growth' | 'turning' | 'death' | 'other'
  source?: string
}

export interface RelationDrivenNode {
  type: 'relation'
  relType: string
  entityId: string
  date: string
  role?: string
}

export interface CustomNode {
  type: 'custom'
  event: CustomLifeEvent
}

const CATEGORY_ICONS: Record<string, string> = {
  birth: 'character', growth: 'plant', turning: 'lightning', death: 'skull', other: 'pin',
}

const props = defineProps<{
  node: RelationDrivenNode | (CustomNode & { id: string; date: string })
}>()

const emit = defineEmits<{
  viewEntity: [id: string]
  update: [event: CustomLifeEvent]
  delete: [id: string]
}>()

const entityStore = useEntityStore()
const isEditing = ref(false)
const editData = ref({ title: '', description: '', date: '', category: 'other' as CustomLifeEvent['category'] })

const nodeType = computed(() => props.node.type)

const entityName = computed(() => {
  if (nodeType.value !== 'relation') return ''
  const e = entityStore.entityMap.get((props.node as RelationDrivenNode).entityId)
  return e?.name || '(未知)'
})

const entityDesc = computed(() => {
  if (nodeType.value !== 'relation') return ''
  const e = entityStore.entityMap.get((props.node as RelationDrivenNode).entityId)
  return e?.description?.slice(0, 60) || ''
})

const relLabel = computed(() => {
  if (nodeType.value !== 'relation') return ''
  return getRelationLabel((props.node as RelationDrivenNode).relType)
})

const displayDate = computed(() => {
  const d = props.node.date
  if (!d) return '日期未知'
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10)
  return d
})

const categoryIcon = computed(() => {
  if (nodeType.value !== 'custom') return ''
  return CATEGORY_ICONS[(props.node as CustomNode & { id: string }).event?.category || 'other']
})

function onClick() {
  if (nodeType.value === 'custom' && !isEditing.value) {
    const evt = (props.node as CustomNode & { id: string }).event
    editData.value = {
      title: evt.title,
      description: evt.description,
      date: evt.date,
      category: evt.category,
    }
    isEditing.value = true
  }
}

function saveEdit() {
  isEditing.value = false
  const evt = (props.node as CustomNode & { id: string }).event
  const updated = { ...evt, ...editData.value }
  emit('update', updated)
}

function cancelEdit() {
  isEditing.value = false
}
</script>

<style scoped>
.en-node { display: flex; gap: 12px; position: relative; min-height: 48px; cursor: pointer; padding: 4px 0; }
.en-node:hover { background: var(--bg-secondary, rgba(0,0,0,0.02)); border-radius: var(--radius-sm); }
.en-left { display: flex; flex-direction: column; align-items: center; width: 40px; flex-shrink: 0; }
.en-icon { font-size: var(--font-size-base); margin-bottom: 4px; }
.en-icon-rel { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg-secondary); padding: 1px 4px; border-radius: var(--radius-2xs); }
.en-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--primary, #7c3aed); flex-shrink: 0; }
.en-relation .en-dot { background: var(--color-primary); }
.en-custom .en-dot { background: var(--color-warning); }
.en-body { flex: 1; padding-bottom: 12px; }
.en-date { font-size: var(--font-size-xs); color: var(--primary, #7c3aed); font-weight: var(--font-weight-semibold); display: block; }
.en-title { font-size: var(--font-size-sm); color: var(--text-color); font-weight: var(--font-weight-medium); }
.en-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); margin: 2px 0 0; line-height: 1.4; }
.en-link { font-size: var(--font-size-xs); color: var(--primary); background: none; border: none; cursor: pointer; padding: 0; margin-top: 2px; }
.en-link:hover { text-decoration: underline; }
.en-input, .en-select { width: 100%; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); font-size: var(--font-size-sm); margin-bottom: 4px; background: var(--input-bg); color: var(--text-color); }
.en-textarea { width: 100%; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); font-size: var(--font-size-sm); margin-bottom: 4px; resize: vertical; background: var(--input-bg); color: var(--text-color); }
.en-input-sm { width: 120px; }
.en-edit-row { display: flex; gap: 6px; }
.en-edit-actions { display: flex; gap: 4px; margin-top: 4px; }
.en-btn-sm { font-size: var(--font-size-xs); padding: 2px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); background: transparent; color: var(--text-color); cursor: pointer; }
.en-btn-cancel { color: var(--text-tertiary); }
.en-btn-danger { color: var(--danger, #e74c3c); }
</style>


<template>
  <div class="ce-experience">
    <WsEmpty v-if="timelineItems.length === 0 && !showAddForm" preset="no-data" title="暂无经历记录" />
    <div v-else class="ce-timeline">
      <div v-for="(item, idx) in timelineItems" :key="item.key" class="ce-item">
        <div class="ce-line" v-if="idx < timelineItems.length - 1"></div>
        <ExperienceNode
          :node="item as any"
          @view-entity="onViewEntity"
          @update="onUpdateEvent"
          @delete="onDeleteEvent"
        />
      </div>
    </div>
    <div v-if="showAddForm" class="ce-add-form">
      <input v-model="newEvent.date" class="ce-input" placeholder="日期（如：第三纪元120年）" />
      <input v-model="newEvent.title" class="ce-input" placeholder="标题（如：出生、觉醒）" />
      <textarea v-model="newEvent.description" class="ce-textarea" placeholder="描述" rows="2"></textarea>
      <div class="ce-add-row">
        <select v-model="newEvent.category" class="ce-select">
          <option value="birth"><WsIcon name="character" size="xs" /> 出生</option>
          <option value="growth"><WsIcon name="plant" size="xs" /> 成长</option>
          <option value="turning"><WsIcon name="lightning" size="xs" /> 转折</option>
          <option value="death"><WsIcon name="skull" size="xs" /> 死亡</option>
          <option value="other"><WsIcon name="pin" size="xs" /> 其他</option>
        </select>
        <button class="ce-btn ce-btn-primary" @click="addEvent" :disabled="!newEvent.title.trim()">添加</button>
        <button class="ce-btn" @click="showAddForm = false">取消</button>
      </div>
    </div>
    <button v-if="!showAddForm" class="ce-add-btn" @click="showAddForm = true">＋ 添加经历</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import ExperienceNode from './ExperienceNode.vue'
import type { CustomLifeEvent } from './ExperienceNode.vue'

const EXPERIENCE_REL_TYPES = ['participated_in', 'resides_in', 'belongs_to', 'member_of', 'owns', 'owned_by']

const props = defineProps<{ characterId: string }>()
const emit = defineEmits<{ switchToProfile: [] }>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()

const showAddForm = ref(false)
const newEvent = ref({ date: '', title: '', description: '', category: 'other' as const })

const selectedCharacter = computed(() => entityStore.entityMap.get(props.characterId))

const customEvents = computed<CustomLifeEvent[]>(() => {
  try {
    const raw = selectedCharacter.value?.properties?._lifeEvents as string
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
})

const relationDrivenNodes = computed(() => {
  const rels = relationStore.relations.filter(r =>
    EXPERIENCE_REL_TYPES.includes(r.type) &&
    (r.sourceId === props.characterId || r.targetId === props.characterId)
  )
  return rels.map(r => {
    const otherId = r.sourceId === props.characterId ? r.targetId : r.sourceId
    const entity = entityStore.entityMap.get(otherId)
    return {
      type: 'relation' as const,
      relType: r.type,
      entityId: otherId,
      date: (r.properties?.since as string) || (entity?.properties?.date as string) || '',
      role: r.properties?.role as string || '',
    }
  })
})

interface TimelineItem {
  key: string
  type: 'relation' | 'custom'
  date: string
  relType: string
  entityId: string
  role?: string
  event?: CustomLifeEvent
}

const timelineItems = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = []

  for (const rn of relationDrivenNodes.value) {
    items.push({
      key: `rel-${rn.relType}-${rn.entityId}`,
      type: 'relation',
      date: rn.date,
      relType: rn.relType,
      entityId: rn.entityId,
      role: rn.role,
    })
  }

  for (const evt of customEvents.value) {
    items.push({
      key: `custom-${evt.id}`,
      type: 'custom',
      date: evt.date,
      relType: '',
      entityId: evt.source || '',
      event: evt,
    })
  }

  items.sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date.localeCompare(b.date)
  })

  return items
})

async function addEvent() {
  if (!newEvent.value.title.trim() || !selectedCharacter.value) return
  const events = [...customEvents.value]
  events.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: newEvent.value.date,
    title: newEvent.value.title.trim(),
    description: newEvent.value.description,
    category: newEvent.value.category,
  })
  await saveEvents(events)
  newEvent.value = { date: '', title: '', description: '', category: 'other' }
  showAddForm.value = false
}

async function onUpdateEvent(updatedEvent: CustomLifeEvent) {
  const events = customEvents.value.map(e => e.id === updatedEvent.id ? updatedEvent : e)
  await saveEvents(events)
}

async function onDeleteEvent(eventId: string) {
  const events = customEvents.value.filter(e => e.id !== eventId)
  await saveEvents(events)
}

async function saveEvents(events: CustomLifeEvent[]) {
  if (!selectedCharacter.value) return
  await entityStore.update(selectedCharacter.value.id, {
    properties: {
      ...selectedCharacter.value.properties,
      _lifeEvents: JSON.stringify(events),
    },
  })
}

function onViewEntity(_id: string) {
  emit('switchToProfile')
}
</script>

<style scoped>
.ce-experience { padding: 4px 0; }
.ce-timeline { position: relative; padding-left: 0; }
.ce-item { position: relative; }
.ce-line { position: absolute; left: 19px; top: 30px; width: 2px; height: calc(100% - 10px); background: var(--border-color); }
.ce-add-form { margin-top: 12px; padding: 10px; background: var(--bg-secondary, rgba(0,0,0,0.02)); border-radius: 8px; }
.ce-input, .ce-select { width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px; font-size: var(--font-size-sm); margin-bottom: 6px; background: var(--input-bg); color: var(--text-color); }
.ce-textarea { width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px; font-size: var(--font-size-sm); margin-bottom: 6px; resize: vertical; background: var(--input-bg); color: var(--text-color); }
.ce-add-row { display: flex; gap: 6px; align-items: center; }
.ce-btn { font-size: var(--font-size-sm); padding: 4px 12px; border: 1px solid var(--border-color); border-radius: 6px; background: transparent; color: var(--text-color); cursor: pointer; }
.ce-btn-primary { background: var(--primary, #7c3aed); color: #fff; border-color: var(--primary, #7c3aed); }
.ce-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.ce-add-btn { margin-top: 8px; font-size: var(--font-size-sm); padding: 5px 12px; border: 1px dashed var(--border-color); border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; width: 100%; }
.ce-add-btn:hover { background: var(--bg-secondary); }
</style>


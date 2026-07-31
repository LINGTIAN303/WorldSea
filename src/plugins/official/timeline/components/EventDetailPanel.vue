<template>
  <Transition name="ws-detail-backdrop">
    <div v-if="event" class="detail-backdrop"></div>
  </Transition>
  <Transition name="ws-detail-slide">
    <div v-if="event" class="detail-panel" :style="{ width: detailResizable.width.value + 'px' }">
      <div class="resize-handle-left" @mousedown="detailResizable.onResizeStart"></div>

      <div class="dp-header">
        <WsIcon :name="importanceIcon" size="lg" />
        <div>
          <input v-if="isEditing" v-model="editForm._name" class="dp-name-input" aria-label="事件名称" />
          <h2 v-else style="margin:0;">{{ event.name }}</h2>
          <p style="margin:2px 0 0;font-size:var(--font-size-sm);color:var(--text-secondary);">
            {{ event.properties.date || '?' }}
            <template v-if="event.properties.dateEnd"> ~ {{ event.properties.dateEnd }}</template>
          </p>
        </div>
        <button class="detail-edit-toggle" :class="{ active: isEditing }" @click="isEditing ? cancelEdit() : startEdit()">
          {{ isEditing ? '取消' : '编辑' }}
        </button>
        <button class="detail-close" @click="$emit('close')"><WsIcon name="close" size="xs" /></button>
      </div>

      <div class="dp-tabs">
        <button v-for="tab in tabs" :key="tab.id" class="dp-tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"><WsIcon :name="tab.icon" size="xs" /> {{ tab.label }}</button>
      </div>

      <div class="dp-scroll-area">
      <div v-if="activeTab === 'info'" class="dp-tab-content">
        <div class="detail-fields">
          <template v-for="(val, key) in visibleFields" :key="key">
            <DetailField :label="fieldLabel(key)" :value="val" :editing="isEditing" type="text"
              @update:value="editForm[key] = $event" @commit="saveEdit" />
          </template>
        </div>
        <DetailField label="描述" :value="event.description" :editing="isEditing" type="textarea"
          @update:value="editForm._description = $event" @commit="saveEdit" />
        <div v-if="involved.length > 0" class="detail-section">
          <h4>涉及实体</h4>
          <div v-for="e in involved" :key="e.id" class="involved-item">{{ e.name }}</div>
        </div>
        <div class="detail-actions" style="margin-top:16px">
          <button v-if="isEditing" class="btn-danger btn-sm" @click="$emit('deleteEvent', event.id)">删除</button>
        </div>
        <DynamicFieldsAdder entity-type="event" v-model="editForm" :field-defs="customFieldDefs" @update:field-defs="customFieldDefs = $event" />
        <div class="detail-edit-bar" v-if="isEditing">
          <button class="btn-primary btn-sm" @click="saveEdit()">保存</button>
        </div>
      </div>

      <div v-else-if="activeTab === 'causal'" class="dp-tab-content">
        <CausalGraph
          :event="event"
          :events="allEvents"
          :relations="allRelations"
          @navigate-to-event="id => $emit('navigateToEvent', id)"
        />
        <EntityRelationSelector v-if="event" :entity-id="event.id" entity-type="event" relation-type="causes" />
      </div>

      <UniversalRelationPanel v-if="event?.id" :entity-id="event.id" entity-type="event" :inline-visible="activeTab === 'info'" storage-scope="event" />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import WsIcon from '../../../../ui/WsIcon.vue'
import type { Entity, Relation } from '@worldsmith/entity-core'
import { DetailField, DynamicFieldsAdder, UniversalRelationPanel, EntityRelationSelector, useEntityEdit, useResizable } from '@worldsmith/plugin-sdk'
import CausalGraph from './CausalGraph.vue'
import { entitySchemaRegistry } from '@worldsmith/entity-core'
import { useSettingsStore } from '../../../../stores/settingsStore'

const props = defineProps<{
  event: Entity
  involvedEntities: Entity[]
  allEvents: Entity[]
  allRelations: Relation[]
}>()

const emit = defineEmits<{
  close: []
  navigateToEvent: [id: string]
  deleteEvent: [id: string]
}>()

const settingsStore = useSettingsStore()
const detailSide = computed(() => settingsStore.detailPanelPosition === 'left' ? 'right' : 'left')
const detailResizable = useResizable({ panelId: 'detail-event', defaultWidth: 380, minWidth: 240, sideRef: detailSide })

const eventSchema = computed(() => entitySchemaRegistry.get('event'))
const activeTab = ref('info')
const customFieldDefs = ref<any[]>([])

const { isEditing, editForm, startEdit, cancelEdit, saveEdit } = useEntityEdit(
  computed(() => props.event)
)

const involved = computed(() => props.involvedEntities)

const visibleFields = computed(() => {
  if (!props.event) return {}
  const { location, ...rest } = props.event.properties as Record<string, unknown>
  return rest
})

function fieldLabel(key: string): string {
  const field = eventSchema.value?.fields.find(f => f.key === key)
  return field?.label || key
}

const importanceIcon = computed(() => {
  if (!props.event) return ''
  const imp = props.event.properties.importance as string
  return imp === '关键' ? 'flag' : imp === '重要' ? 'star' : 'bookmark'
})

const tabs = [
  { id: 'info', icon: 'outline', label: '详情' },
  { id: 'causal', icon: 'link', label: '因果链' },
]
</script>

<style scoped>
.detail-panel { position: fixed; top: 0; right: 0; height: 100vh; z-index: var(--z-detail); background: var(--glass-bg, var(--panel-bg, var(--content-bg))); border-left: 1px solid var(--glass-border, var(--border-color)); display: flex; flex-direction: column; box-shadow: var(--shadow-xl); backdrop-filter: blur(var(--glass-blur)); animation: none; }
.resize-handle-left { position: absolute; left: 0; top: 0; width: 6px; height: 100%; cursor: col-resize; z-index: 10; background: transparent; transition: background 0.15s; }
.resize-handle-left:hover, .resize-handle-left:active { background: var(--primary); opacity: 0.3; }
.detail-backdrop { position: fixed; inset: 0; z-index: var(--z-detail-backdrop); background: rgba(0,0,0,0.2); pointer-events: none; }
.detail-close { background: none; border: none; font-size: var(--font-size-lg); cursor: pointer; color: var(--text-secondary); padding: 4px; margin-left: 4px; flex-shrink: 0; }


.dp-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.dp-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border-color); margin-bottom: 12px; overflow-x: auto; flex-shrink: 0; scrollbar-width: none; }
.dp-tabs::-webkit-scrollbar { display: none; }
.dp-tab { padding: 4px 8px; border: none; background: none; cursor: pointer; font-size: var(--font-size-xs); color: var(--text-tertiary); border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap; transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast); flex-shrink: 0; }
.dp-tab:hover { color: var(--text-color); }
.dp-tab.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: var(--font-weight-semibold); }
.dp-scroll-area { flex: 1; overflow-y: auto; }
.dp-tab-content { }
.dp-name-input { font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin: 0; border: none; border-bottom: 1px solid var(--border-color); background: transparent; color: var(--text-color); width: 100%; padding: 2px 0; }
.detail-edit-toggle { margin-left: auto; margin-right: 20px; }
.detail-section { margin: 12px 0; }
.detail-section h4 { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: 6px; border-bottom: 1px solid var(--border-light); padding-bottom: 4px; }
.involved-item { padding: 4px 8px; font-size: var(--font-size-sm); border-radius: var(--radius-sm); }
.involved-item:hover { background: var(--hover-bg); }
.btn-sm { padding: 5px 12px; font-size: var(--font-size-sm); }
</style>
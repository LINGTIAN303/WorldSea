<template>
  <Transition name="ws-panel">
    <div v-if="visible" class="mm-detail-panel">
      <div class="mm-dp-header">
        <span class="mm-dp-icon"><WsIcon :name="iconForType(nodeType)" size="md" /></span>
        <span class="mm-dp-name">{{ nodeName }}</span>
        <button class="mm-dp-close" @click="$emit('close')">✕</button>
      </div>

      <div class="mm-dp-section">
        <div class="mm-dp-row"><span class="mm-dp-label">类型</span><span class="mm-dp-value">{{ typeLabel(nodeType) }}</span></div>
        <div v-if="nodeTags" class="mm-dp-row"><span class="mm-dp-label">标签</span><span class="mm-dp-value">{{ nodeTags }}</span></div>
      </div>

      <div class="mm-dp-section">
        <button class="mm-dp-toggle" @click="showRelations = !showRelations">
          {{ showRelations ? '▾' : '▸' }} 关系 ({{ relationCount }})
        </button>
        <div v-if="showRelations" class="mm-dp-relations">
          <div v-for="r in relations" :key="r.id" class="mm-dp-rel-item" role="button" tabindex="0" @click="$emit('navigate', r.targetId)" @keydown.enter="$emit('navigate', r.targetId)">
            <span class="mm-dp-rel-type">{{ r.label }}</span>
            <span class="mm-dp-rel-arrow">→</span>
            <span class="mm-dp-rel-target">{{ r.targetName }}</span>
          </div>
          <WsEmpty v-if="relations.length === 0" preset="no-data" title="暂无关系" />
        </div>
      </div>

      <div class="mm-dp-section">
        <button class="mm-dp-toggle" @click="showDetails = !showDetails">
          {{ showDetails ? '▾' : '▸' }} 详细信息
        </button>
        <div v-if="showDetails" class="mm-dp-details">
          <p v-if="nodeDesc" class="mm-dp-desc">{{ nodeDesc }}</p>
          <div v-if="customFields.length > 0 && !isEditingFields">
            <div v-for="f in customFields" :key="f.key" class="mm-dp-row">
              <span class="mm-dp-label">{{ f.label }}</span>
              <span class="mm-dp-value">{{ f.value }}</span>
            </div>
          </div>
          <DynamicFieldsAdder
            v-if="isEditingFields"
            entity-type="mindmap_node"
            v-model="editProperties"
            :field-defs="customFieldDefs"
            @update:field-defs="customFieldDefs = $event"
          />
          <WsEmpty v-if="!nodeDesc && customFields.length === 0 && !isEditingFields" preset="no-data" title="暂无详细信息" />
          <div class="mm-dp-field-actions">
            <button v-if="!isEditingFields" class="mm-dp-btn-sm" @click="startEditFields"><WsIcon name="plus" size="xs" /> 添加字段</button>
            <template v-else>
              <button class="mm-dp-btn-sm primary" @click="saveFields"><WsIcon name="check" size="xs" /> 保存</button>
              <button class="mm-dp-btn-sm" @click="cancelEditFields">取消</button>
            </template>
          </div>
        </div>
      </div>

      <div class="mm-dp-actions">
        <button class="mm-dp-btn" @click="$emit('edit')"><WsIcon name="edit" size="xs" /> 编辑</button>
        <button v-if="!isCustomType" class="mm-dp-btn" @click="$emit('enter')"><WsIcon name="search" size="xs" /> 进入</button>
        <button class="mm-dp-btn danger" @click="$emit('delete')"><WsIcon name="delete" size="xs" /> 删除</button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'
import { DynamicFieldsAdder } from '@worldsmith/plugin-sdk'
import type { FieldSchema } from '@worldsmith/entity-core'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { typeLabel, iconForType } from './mindmapConfig'

const props = defineProps<{
  visible: boolean
  nodeId: string
  nodeName: string
  nodeType: string
  nodeTags: string
  nodeDesc: string
  nodeProperties: Record<string, unknown>
}>()

const emit = defineEmits<{
  close: []
  edit: []
  enter: []
  delete: []
  navigate: [entityId: string]
  'update-properties': [nodeId: string, properties: Record<string, unknown>]
}>()

const relationStore = useRelationStore()
const entityStore = useEntityStore()

const showRelations = ref(true)
const showDetails = ref(false)
const isEditingFields = ref(false)
const editProperties = ref<Record<string, unknown>>({})
const customFieldDefs = ref<FieldSchema[]>([])

const CUSTOM_TYPES = new Set(['textbox', 'image', 'note', 'link', 'group', 'center', 'section'])
const isCustomType = computed(() => CUSTOM_TYPES.has(props.nodeType))

const relations = computed(() => {
  const rels = relationStore.relations.filter(r => r.sourceId === props.nodeId || r.targetId === props.nodeId)
  return rels.map(r => {
    const targetId = r.sourceId === props.nodeId ? r.targetId : r.sourceId
    const entity = entityStore.entities.find(e => e.id === targetId)
    return {
      id: r.id,
      label: r.label || r.type,
      targetId,
      targetName: entity?.name || targetId,
    }
  })
})

const relationCount = computed(() => relations.value.length)

const customFields = computed(() => {
  const fields: { key: string; label: string; value: string }[] = []
  if (!props.nodeProperties) return fields
  for (const [key, val] of Object.entries(props.nodeProperties)) {
    if (['name', 'description', 'tags'].includes(key)) continue
    if (val === undefined || val === null || val === '') continue
    fields.push({ key, label: key, value: String(val) })
  }
  return fields
})

function startEditFields() {
  // 初始化编辑数据：复制当前 properties，排除内置字段
  const propsCopy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props.nodeProperties ?? {})) {
    if (!['name', 'description', 'tags'].includes(k)) {
      propsCopy[k] = v
    }
  }
  editProperties.value = propsCopy
  isEditingFields.value = true
}

function saveFields() {
  // 合并回原始 properties
  const merged = { ...props.nodeProperties }
  // 移除旧的自定义字段
  for (const key of Object.keys(props.nodeProperties ?? {})) {
    if (['name', 'description', 'tags'].includes(key)) continue
    delete merged[key]
  }
  // 写入新的自定义字段
  for (const [key, val] of Object.entries(editProperties.value)) {
    merged[key] = val
  }
  emit('update-properties', props.nodeId, merged)

  // 同步更新实体 store
  const entity = entityStore.entities.find(e => e.id === props.nodeId)
  if (entity) {
    entityStore.update(entity.id, { properties: merged })
  }

  isEditingFields.value = false
}

function cancelEditFields() {
  isEditingFields.value = false
  editProperties.value = {}
}

// 节点切换时重置编辑状态
watch(() => props.nodeId, () => {
  isEditingFields.value = false
  customFieldDefs.value = []
})
</script>

<style scoped>
.mm-detail-panel {
  width: 280px; background: var(--card-bg);
  border-left: 1px solid var(--border-color);
  display: flex; flex-direction: column;
  overflow-y: auto; flex-shrink: 0;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.04);
}
.mm-dp-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 14px 12px; border-bottom: 1px solid var(--border-color);
  background: linear-gradient(180deg, var(--color-bg-elevated) 0%, transparent 100%);
}
.mm-dp-icon {
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-bg-elevated);
  border: 1px solid var(--border-color);
  color: var(--primary);
  flex-shrink: 0;
}
.mm-dp-name { flex: 1; font-weight: var(--font-weight-semibold); font-size: var(--font-size-base); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-dp-close {
  background: none; border: none; cursor: pointer;
  color: var(--text-tertiary); font-size: var(--font-size-base);
  width: 24px; height: 24px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
}
.mm-dp-close:hover { color: var(--text-color); background: var(--hover-bg); }
.mm-dp-section { padding: 10px 14px; border-bottom: 1px solid var(--border-color); }
.mm-dp-section:last-of-type { border-bottom: none; }
.mm-dp-row { display: flex; gap: 8px; margin-bottom: 4px; font-size: var(--font-size-sm); }
.mm-dp-label { color: var(--text-tertiary); min-width: 40px; font-size: var(--font-size-xs); }
.mm-dp-value { color: var(--text-secondary); flex: 1; word-break: break-all; }
.mm-dp-toggle {
  background: none; border: none; cursor: pointer;
  font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--primary);
  padding: 0; width: 100%; text-align: left;
  display: flex; align-items: center; gap: 6px;
}
.mm-dp-toggle:hover { color: var(--primary-hover, var(--primary)); }
.mm-dp-relations { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.mm-dp-rel-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; font-size: var(--font-size-xs);
  cursor: pointer; transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
  background: var(--color-bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}
.mm-dp-rel-item:hover { color: var(--primary); border-color: var(--primary); transform: translateX(2px); }
.mm-dp-rel-type {
  color: var(--primary); font-weight: var(--font-weight-semibold);
  padding: 1px 6px; background: var(--color-primary-subtle, var(--color-bg-elevated));
  border-radius: 4px; white-space: nowrap;
}
.mm-dp-rel-arrow { color: var(--text-tertiary); }
.mm-dp-rel-target { color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-dp-details { margin-top: 8px; }
.mm-dp-desc {
  font-size: var(--font-size-sm); color: var(--text-secondary);
  line-height: 1.6; padding: 8px 10px;
  background: var(--color-bg-elevated);
  border-left: 3px solid var(--primary);
  border-radius: 4px;
  margin: 0 0 8px;
}
.mm-dp-field-actions {
  display: flex; gap: 6px; margin-top: 8px;
}
.mm-dp-btn-sm {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 8px; font-size: var(--font-size-xs);
  border: 1px solid var(--border-color); border-radius: 4px;
  background: var(--card-bg); color: var(--text-secondary);
  cursor: pointer; transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}
.mm-dp-btn-sm:hover { border-color: var(--primary); color: var(--primary); }
.mm-dp-btn-sm.primary { background: var(--primary); color: #fff; border-color: var(--primary); }
.mm-dp-btn-sm.primary:hover { background: var(--primary-hover, var(--primary)); }
.mm-dp-actions {
  padding: 12px 14px; display: flex; gap: 6px; margin-top: auto;
  border-top: 1px solid var(--border-color);
  background: var(--color-bg-elevated);
}
.mm-dp-btn {
  padding: 6px 12px; border: 1px solid var(--border-color);
  border-radius: 6px; background: var(--card-bg);
  cursor: pointer; font-size: var(--font-size-xs); color: var(--text-secondary);
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
  display: inline-flex; align-items: center; gap: 4px;
  flex: 1; justify-content: center;
}
.mm-dp-btn:hover { background: var(--hover-bg); color: var(--text-color); border-color: var(--primary); }
.mm-dp-btn.danger { color: var(--danger); border-color: var(--danger); }
.mm-dp-btn.danger:hover { background: var(--danger); color: white; }
</style>

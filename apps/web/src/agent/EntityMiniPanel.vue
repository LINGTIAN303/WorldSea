<template>
  <div class="entity-mini-panel">
    <!-- 加载中状态 -->
    <div v-if="loading" class="emp-state">
      <WsIcon name="loading" size="md" />
      <span>加载中...</span>
    </div>

    <!-- 实体不存在 -->
    <div v-else-if="!entity" class="emp-state emp-state-error">
      <WsIcon name="warning" size="md" />
      <span>实体不存在</span>
      <span class="emp-state-sub">ID: {{ entityId }}</span>
    </div>

    <!-- 实体详情内容 -->
    <template v-else>
      <div class="emp-header">
        <WsIcon :name="icon" size="sm" />
        <span class="emp-name">{{ entity.name }}</span>
        <button class="emp-open-main" title="在主面板打开" @click="openInMainPanel">
          <WsIcon name="expand" size="xs" />
        </button>
      </div>

      <div class="emp-body">
        <!-- 类型 -->
        <div class="emp-section">
          <div class="emp-label">类型</div>
          <div class="emp-value">{{ typeLabel }}</div>
        </div>

        <!-- 描述（可编辑） -->
        <div class="emp-section">
          <div class="emp-label">描述</div>
          <textarea
            v-model="editDesc"
            class="emp-input"
            rows="3"
            @blur="saveDesc"
          ></textarea>
        </div>

        <!-- 属性字段（可编辑） -->
        <div v-if="sortedFields.length" class="emp-section">
          <div class="emp-label">属性</div>
          <div v-for="field in sortedFields" :key="field.key" class="emp-prop">
            <div class="emp-prop-label">{{ field.label }}</div>
            <input
              v-if="field.fieldType === 'boolean'"
              type="checkbox"
              :checked="!!editProps[field.key]"
              @change="onPropChange(field.key, ($event.target as HTMLInputElement).checked)"
              class="emp-checkbox"
            />
            <input
              v-else-if="field.fieldType === 'color'"
              type="color"
              :value="String(editProps[field.key] ?? '')"
              @change="onPropChange(field.key, ($event.target as HTMLInputElement).value)"
              class="emp-color-input"
            />
            <textarea
              v-else-if="field.fieldType === 'textarea'"
              :value="stripHtml(String(editProps[field.key] ?? ''))"
              @blur="onPropChange(field.key, ($event.target as HTMLTextAreaElement).value)"
              class="emp-input"
              rows="2"
            ></textarea>
            <select
              v-else-if="field.fieldType === 'select' && field.options?.length"
              :value="String(editProps[field.key] ?? '')"
              @change="onPropChange(field.key, ($event.target as HTMLSelectElement).value)"
              class="emp-input"
            >
              <option value="">—</option>
              <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <input
              v-else
              :value="String(editProps[field.key] ?? '')"
              @blur="onPropChange(field.key, ($event.target as HTMLInputElement).value)"
              class="emp-input"
            />
          </div>
        </div>

        <!-- 关联关系（只读） -->
        <div v-if="relations.length" class="emp-section">
          <div class="emp-label">关联 ({{ relations.length }})</div>
          <div v-for="r in relations" :key="r.id" class="emp-relation">
            <WsIcon :name="relationIcon(r)" size="xs" />
            <span class="emp-relation-type">{{ r.type }}</span>
            <span class="emp-relation-target">{{ relationTarget(r) }}</span>
          </div>
        </div>

        <!-- 标签（只读） -->
        <div v-if="entity.tags?.length" class="emp-section">
          <div class="emp-label">标签</div>
          <div class="emp-tags">
            <span v-for="tag in entity.tags" :key="tag" class="emp-tag">{{ tag }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { entitySchemaRegistry, fieldRegistry } from '@worldsmith/entity-core'
import { useSelection } from '@worldsmith/plugin-sdk/composables'
import { toastSuccess } from '../composables/useToast'
import type { Entity } from '@worldsmith/entity-core'

const props = defineProps<{
  entityId: string
}>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { select } = useSelection()

const loading = ref(false)
const editDesc = ref('')
const editProps = ref<Record<string, unknown>>({})

/** 实体对象：优先从内存 map 同步取，没有则异步加载 */
const entity = computed<Entity | null>(() => entityStore.entityMap.get(props.entityId) || null)

const icon = computed(() => entity.value ? entitySchemaRegistry.getIconName(entity.value.type) : '')
const typeLabel = computed(() => entity.value ? entitySchemaRegistry.getLabel(entity.value.type) : '')

const sortedFields = computed(() => {
  void fieldRegistry.version.value
  if (!entity.value) return []
  return fieldRegistry.getFields(entity.value.type)
})

const relations = computed(() => {
  if (!entity.value) return []
  return relationStore.relations.filter(r => r.sourceId === entity.value!.id || r.targetId === entity.value!.id)
})

function relationTarget(r: any): string {
  if (!entity.value) return ''
  const otherId = r.sourceId === entity.value.id ? r.targetId : r.sourceId
  return entityStore.entityMap.get(otherId)?.name || otherId
}

function relationIcon(r: any): string {
  const otherId = r.sourceId === entity.value?.id ? r.targetId : r.sourceId
  const other = entityStore.entityMap.get(otherId)
  return other ? entitySchemaRegistry.getIconName(other.type) || 'manuscript' : 'manuscript'
}

/** entityId 变化时：若内存无此实体则异步加载，并同步编辑缓存 */
watch(() => props.entityId, async (id) => {
  if (!id) return
  if (!entityStore.entityMap.get(id)) {
    loading.value = true
    try {
      await entityStore.getById(id)
    } finally {
      loading.value = false
    }
  }
  const e = entityStore.entityMap.get(id)
  editDesc.value = e?.description || ''
  editProps.value = e ? { ...e.properties } : {}
}, { immediate: true })

function saveDesc() {
  if (!entity.value) return
  if (editDesc.value === entity.value.description) return
  entityStore.update(entity.value.id, { description: editDesc.value })
  toastSuccess('已保存')
}

function onPropChange(key: string, value: unknown) {
  if (!entity.value) return
  editProps.value = { ...editProps.value, [key]: value }
  entityStore.update(entity.value.id, { properties: { ...editProps.value } })
  toastSuccess('已保存')
}

/** 在主面板（InfoPanel）中打开此实体：通过 useSelection 切换选中 */
function openInMainPanel() {
  if (!entity.value) return
  select(entity.value.id)
}

/** 工具函数：剥离 HTML 标签（与 InfoPanel 保持一致） */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}
</script>

<style scoped>
.entity-mini-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 200px;
  font-size: 12px;
  color: var(--agent-text, #e0e0e0);
  background: var(--agent-bg, #1a1a1a);
}

.emp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 30px 12px;
  color: var(--agent-text-tertiary, #888);
}
.emp-state-error { color: var(--agent-warn, #f59e0b); }
.emp-state-sub { font-size: 10px; opacity: 0.6; word-break: break-all; }

.emp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--agent-border, rgba(255,255,255,0.08));
  background: var(--agent-bg-secondary, rgba(0,0,0,0.2));
}
.emp-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-accent, #b388ff);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.emp-open-main {
  width: 22px; height: 22px;
  border: none; background: transparent;
  cursor: pointer; color: var(--agent-text-tertiary, #888);
  border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.emp-open-main:hover {
  background: rgba(108,92,231,0.15);
  color: var(--agent-accent, #b388ff);
}

.emp-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
}

.emp-section { margin-bottom: 12px; }
.emp-label {
  font-size: 10px;
  color: var(--agent-text-tertiary, #888);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.emp-value {
  font-size: 12px;
  color: var(--agent-text, #e0e0e0);
}

.emp-input {
  width: 100%;
  padding: 4px 6px;
  background: var(--agent-bg-input, rgba(0,0,0,0.3));
  border: 1px solid var(--agent-border, rgba(255,255,255,0.1));
  border-radius: 4px;
  color: var(--agent-text, #e0e0e0);
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
}
.emp-input:focus {
  outline: none;
  border-color: var(--agent-accent, #b388ff);
}
.emp-checkbox { width: 16px; height: 16px; cursor: pointer; }
.emp-color-input { width: 32px; height: 22px; padding: 0; border: none; background: transparent; cursor: pointer; }

.emp-prop { margin-bottom: 6px; }
.emp-prop-label {
  font-size: 11px;
  color: var(--agent-text-secondary, #aaa);
  margin-bottom: 2px;
}

.emp-relation {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 0;
  font-size: 11px;
}
.emp-relation-type {
  color: var(--agent-text-tertiary, #888);
  padding: 1px 4px;
  background: rgba(108,92,231,0.1);
  border-radius: 2px;
}
.emp-relation-target {
  color: var(--agent-text-secondary, #aaa);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.emp-tags { display: flex; flex-wrap: wrap; gap: 3px; }
.emp-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(108,92,231,0.15);
  color: var(--agent-accent, #b388ff);
}
</style>

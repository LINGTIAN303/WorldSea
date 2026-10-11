<template>
  <div v-if="suggestions.length > 0" class="als-root">
    <div class="als-header">
      <WsIcon name="zap" size="xs" />
      <span class="als-title">关联建议</span>
      <span class="als-count">{{ suggestions.length }}</span>
      <button class="als-dismiss-all" @click="dismissAll" title="全部忽略">全部忽略</button>
    </div>
    <div class="als-list">
      <div
        v-for="link in suggestions"
        :key="link.id"
        class="als-item"
        :class="{ 'als-fuzzy': link.confidence === 'fuzzy' }"
      >
        <div class="als-item-main">
          <span class="als-field">{{ getFieldLabel(link.sourceFieldKey) }}</span>
          <WsIcon name="arrow-right" size="xs" class="als-arrow" />
          <span class="als-target">{{ link.targetFieldValue }}</span>
          <span class="als-type-badge">{{ getRelationLabel(link.relationType) }}</span>
          <span v-if="link.confidence === 'fuzzy'" class="als-score">{{ Math.round(link.score * 100) }}%</span>
        </div>
        <div class="als-item-actions">
          <button class="als-confirm" @click="confirmLink(link)" title="确认关联">
            <WsIcon name="check" size="xs" />
          </button>
          <button class="als-dismiss" @click="dismissLink(link)" title="忽略">
            <WsIcon name="x" size="xs" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import {
  potentialLinkIndex,
  indexPotentialLinks,
  entitySchemaRegistryV2,
  relationshipRegistry,
  autoLinkDecisionStore,
  useRelationStore,
  useBidirectional,
} from '@worldsea/entity-core'
import type { PotentialLink } from '@worldsea/entity-core'

const props = defineProps<{
  entityId: string
  entityType: string
  properties: Record<string, unknown>
}>()

const suggestions = ref<PotentialLink[]>([])

/** 获取字段标签 */
function getFieldLabel(fieldKey: string): string {
  const schema = entitySchemaRegistryV2.get(props.entityType)
  if (!schema) return fieldKey
  const field = schema._compiledFields.find(f => f.key === fieldKey)
  return field?.label ?? fieldKey
}

/** 获取关系标签 */
function getRelationLabel(relationType: string): string {
  const schema = relationshipRegistry.get(relationType)
  return schema?.label ?? relationType
}

/** 刷新建议列表 */
async function refresh() {
  await indexPotentialLinks(props.entityId, props.entityType, props.properties)
  suggestions.value = potentialLinkIndex.getBySource(props.entityId)
}

/** 确认关联：经标准双向管线建立（关系和未变时判重跳过；反向按 inverseRegistry） */
async function confirmLink(link: PotentialLink) {
  try {
    const relationStore = useRelationStore()
    const duplicated = relationStore.relations.some(r =>
      r.type === link.relationType &&
      ((r.sourceId === link.sourceEntityId && r.targetId === link.targetEntityId) ||
       (r.sourceId === link.targetEntityId && r.targetId === link.sourceEntityId))
    )
    if (!duplicated) {
      const { createBidirectional } = useBidirectional()
      await createBidirectional({
        type: link.relationType,
        sourceId: link.direction === 'target' ? link.targetEntityId : link.sourceEntityId,
        targetId: link.direction === 'target' ? link.sourceEntityId : link.targetEntityId,
      })
    }
    autoLinkDecisionStore.record(link, 'confirmed')
    potentialLinkIndex.resolve(link.id, 'confirmed')
    suggestions.value = suggestions.value.filter(s => s.id !== link.id)
  } catch (e) {
    console.error('[AutoLink] 确认关联失败:', e)
  }
}

/** 忽略建议（决策持久化：重建索引不复活） */
function dismissLink(link: PotentialLink) {
  autoLinkDecisionStore.record(link, 'dismissed')
  potentialLinkIndex.resolve(link.id, 'dismissed')
  suggestions.value = suggestions.value.filter(s => s.id !== link.id)
}

/** 全部忽略 */
function dismissAll() {
  for (const link of suggestions.value) {
    autoLinkDecisionStore.record(link, 'dismissed')
    potentialLinkIndex.resolve(link.id, 'dismissed')
  }
  suggestions.value = []
}

onMounted(() => refresh())
watch(() => props.properties, () => refresh(), { deep: true })
</script>

<style scoped>
.als-root {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  margin-top: 12px;
  overflow: hidden;
}

.als-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-surface, #f8fafc);
  border-bottom: 1px solid var(--color-border, #e2e8f0);
  font-size: 13px;
}

.als-title {
  font-weight: 600;
  color: var(--color-text, #1e293b);
}

.als-count {
  background: var(--color-primary, #6366f1);
  color: #fff;
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
}

.als-dismiss-all {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--color-text-muted, #94a3b8);
  cursor: pointer;
  font-size: 12px;
}
.als-dismiss-all:hover {
  color: var(--color-danger, #ef4444);
}

.als-list {
  max-height: 240px;
  overflow-y: auto;
}

.als-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
  font-size: 12px;
  transition: background 0.15s;
}
.als-item:last-child {
  border-bottom: none;
}
.als-item:hover {
  background: var(--color-surface-hover, #f1f5f9);
}
.als-item.als-fuzzy {
  border-left: 3px solid var(--color-warning, #f59e0b);
}

.als-item-main {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.als-field {
  color: var(--color-text-muted, #64748b);
  flex-shrink: 0;
}

.als-arrow {
  color: var(--color-text-muted, #94a3b8);
  flex-shrink: 0;
}

.als-target {
  color: var(--color-text, #1e293b);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.als-type-badge {
  background: var(--color-surface, #f1f5f9);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
  color: var(--color-text-muted, #64748b);
  flex-shrink: 0;
}

.als-score {
  color: var(--color-warning, #f59e0b);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.als-item-actions {
  display: flex;
  gap: 2px;
  margin-left: 8px;
  flex-shrink: 0;
}

.als-confirm,
.als-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.als-confirm {
  background: var(--color-success-bg, #dcfce7);
  color: var(--color-success, #16a34a);
}
.als-confirm:hover {
  background: var(--color-success, #16a34a);
  color: #fff;
}

.als-dismiss {
  background: var(--color-surface, #f1f5f9);
  color: var(--color-text-muted, #94a3b8);
}
.als-dismiss:hover {
  background: var(--color-danger, #ef4444);
  color: #fff;
}
</style>

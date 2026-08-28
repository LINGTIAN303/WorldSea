<template>
  <div class="preview-panel">
    <!-- ① 项目产物渲染（实体/场景/知识条目）—— 主 -->
    <div class="preview-section">
      <div class="section-header">
        <WsIcon name="globe" size="sm" /><span>项目产物</span>
      </div>
      <div v-if="entityGroups.length === 0" class="section-empty">
        暂无实体产物。可在对话中创建角色 / 地点 / 物品等。
      </div>
      <div v-else class="entity-list">
        <div v-for="g in entityGroups" :key="g.type" class="entity-group">
          <div class="entity-group-label">{{ g.label }}（{{ g.items.length }}）</div>
          <button
            v-for="e in g.items"
            :key="e.id"
            class="entity-item"
            :class="{ active: selected?.id === e.id }"
            @click="selected = e"
          >{{ e.name || '未命名' }}</button>
        </div>
      </div>
    </div>

    <!-- 选中实体详情预览 -->
    <div v-if="selected" class="preview-detail">
      <div class="detail-header">
        <span class="detail-name">{{ selected.name }}</span>
        <span class="detail-type">{{ selected.type }}</span>
        <button class="detail-close" @click="selected = null" title="关闭预览"><WsIcon name="x" size="xs" /></button>
      </div>
      <div class="detail-body">
        <template v-for="(v, k) in previewFields" :key="k">
          <div class="detail-row"><span class="detail-key">{{ k }}</span><span class="detail-val">{{ v }}</span></div>
        </template>
        <div v-if="previewFields.length === 0" class="detail-empty">该实体无可见字段</div>
      </div>
    </div>

    <!-- ② 素材/文件预览 —— 辅（骨架，TODO：接入 useFileStore） -->
    <div class="preview-section preview-section-files">
      <div class="section-header">
        <WsIcon name="file" size="sm" /><span>素材 / 文件</span>
      </div>
      <div class="section-empty">素材与文件预览即将支持</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore } from '@worldsmith/entity-core'

const entityStore = useEntityStore()
const selected = ref<any>(null)

onMounted(() => {
  if (!entityStore.entities.length) entityStore.loadAll()
})

const entityGroups = computed(() => {
  const map = new Map<string, any[]>()
  for (const e of entityStore.entities) {
    const t = e.type || 'other'
    if (!map.has(t)) map.set(t, [])
    map.get(t)!.push(e)
  }
  return [...map.entries()].map(([type, items]) => ({ type, label: type, items }))
})

const previewFields = computed(() => {
  const e = selected.value
  if (!e) return []
  const skip = new Set(['id', 'type', 'name', 'createdAt', 'updatedAt', 'content'])
  return Object.entries(e).filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && v !== '').slice(0, 8)
})
</script>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 10px;
}
.preview-section {
  flex-shrink: 0;
}
.preview-section-files {
  margin-top: 4px;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
}
.section-empty {
  padding: 14px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  text-align: center;
}
.entity-list {
  padding: 6px 4px;
  max-height: 240px;
  overflow-y: auto;
}
.entity-group {
  margin-bottom: 6px;
}
.entity-group-label {
  padding: 4px 8px 2px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.entity-item {
  display: block;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}
.entity-item:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.entity-item.active {
  background: var(--color-primary-muted);
  color: var(--color-text-primary);
}
.preview-detail {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.detail-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}
.detail-name {
  flex: 1;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-type {
  font-size: var(--font-size-2xs);
  color: var(--color-primary);
}
.detail-close {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.detail-close:hover {
  color: var(--color-text);
  background: var(--color-surface-elevated);
}
.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.detail-row {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  font-size: var(--font-size-xs);
}
.detail-key {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  min-width: 60px;
}
.detail-val {
  color: var(--color-text-secondary);
  word-break: break-all;
}
.detail-empty {
  padding: 12px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
</style>
<template>
  <div class="memory-shelf">
    <div class="panel-header">
      <h3 class="panel-title" :style="{ fontFamily: fontFamily }">记忆架</h3>
      <button class="panel-close-btn" @click="emit('close')" title="关闭">✕</button>
    </div>
    <div class="panel-body">
      <div class="section-label">快速记忆 ({{ quickMemories.length }})</div>
      <div v-if="quickMemories.length === 0" class="panel-empty">暂无快速记忆</div>
      <div
        v-for="mem in quickMemories"
        :key="mem.key"
        class="memory-item"
        :class="getMemoryClass(mem)"
      >
        <div class="mem-key">{{ mem.key }}</div>
        <div class="mem-value">{{ mem.value.slice(0, 60) }}{{ mem.value.length > 60 ? '...' : '' }}</div>
        <div class="mem-meta">
          <span class="mem-access">{{ mem.accessCount }}</span>
          <span v-if="mem.tags.length" class="mem-tags">{{ mem.tags.join(', ') }}</span>
        </div>
      </div>

      <div class="section-divider"></div>
      <div class="section-label">知识空间</div>
      <div v-if="kbStats" class="kb-stats">
        <div class="stat-row"><span>总条目</span><span>{{ kbStats.count }}</span></div>
        <div class="stat-row"><span>全局</span><span>{{ kbStats.global }}</span></div>
        <div class="stat-row"><span>项目</span><span>{{ kbStats.project }}</span></div>
      </div>
      <div v-else class="panel-empty">加载中...</div>

      <div class="section-divider"></div>
      <div class="section-label">实体关联</div>
      <div v-if="entityLinks.length === 0" class="panel-empty">暂无实体关联</div>
      <div v-for="link in entityLinks" :key="link.entityId" class="entity-link">
        <span class="entity-name">{{ link.entityName }}</span>
        <span class="entity-count">{{ link.kbEntries.length }} 条知识</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { loadMemory, type MemoryEntry } from '@agent/tools/memory-internal'
import { kbList } from '@agent/kb/kb-store'
import { usePersonaFont } from '../composables/usePersonaFont'

const emit = defineEmits<{ close: [] }>()

const { fontFamily } = usePersonaFont()

interface KBStats {
  count: number
  global: number
  project: number
}

interface EntityLink {
  entityId: string
  entityName: string
  kbEntries: { id: string; path: string }[]
}

const quickMemories = ref<MemoryEntry[]>([])
const kbStats = ref<KBStats | null>(null)
const entityLinks = ref<EntityLink[]>([])

function getMemoryClass(mem: MemoryEntry): string {
  const ageDays = (Date.now() - mem.lastAccessedAt) / 86400000
  if (ageDays < 1) return 'mem-fresh'
  if (ageDays < 7) return 'mem-normal'
  return 'mem-stale'
}

onMounted(async () => {
  try {
    quickMemories.value = loadMemory()
  } catch {}

  try {
    const all = await kbList()
    kbStats.value = {
      count: all.length,
      global: all.filter(e => e.scope === 'global').length,
      project: all.filter(e => e.scope === 'project').length,
    }

    const entityMap = new Map<string, { id: string; path: string }[]>()
    for (const entry of all) {
      if (!entry.entityId) continue
      if (!entityMap.has(entry.entityId)) {
        entityMap.set(entry.entityId, [])
      }
      entityMap.get(entry.entityId)!.push({ id: entry.id, path: entry.path })
    }

    entityLinks.value = Array.from(entityMap.entries()).map(([entityId, kbEntries]) => ({
      entityId,
      entityName: entityId.slice(0, 16),
      kbEntries,
    }))
  } catch {}
})
</script>

<style scoped>
.memory-shelf {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-left: 1px solid var(--color-border);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}

.panel-close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel-close-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.panel-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  margin: 0;
  letter-spacing: var(--letter-spacing-wide);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px;
}

.panel-empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 16px;
  font-size: var(--font-size-xs);
}

.section-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-divider {
  height: 1px;
  background: var(--color-border);
  margin: 12px 0;
}

.memory-item {
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 4px;
  border-left: 3px solid transparent;
}

.memory-item.mem-fresh { border-left-color: var(--success); }
.memory-item.mem-normal { border-left-color: var(--warning); }
.memory-item.mem-stale { border-left-color: var(--danger); }

.mem-key {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
}

.mem-value {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-top: 2px;
  line-height: 1.4;
}

.mem-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}

.kb-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.entity-link {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}
.entity-link:hover {
  background: var(--color-surface);
}

.entity-name {
  color: var(--color-text);
  font-weight: 500;
}

.entity-count {
  color: var(--color-text-tertiary);
}
</style>

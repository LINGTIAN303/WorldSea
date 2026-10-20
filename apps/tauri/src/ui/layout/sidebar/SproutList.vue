<template>
  <div class="ws-sn-view-list">
    <button
      v-for="view in views"
      :key="view.id"
      class="ws-sn-view"
      :class="{ active: view.id === activeId }"
      :title="view.label"
      :aria-current="view.id === activeId ? 'page' : undefined"
      @click="emit('select', view)"
    >
      <WsIcon v-if="hasIcon(view.icon)" :name="view.icon" size="sm" class="ws-sn-view-icon" />
      <span v-else class="ws-sn-view-icon ws-sn-view-icon-text">{{ view.icon }}</span>
      <span class="ws-sn-view-label">{{ view.label }}</span>
      <CountBadge v-if="uiStore.sproutCountEnabled && countOf(view) > 0" :value="countOf(view)" />
    </button>
    <div v-if="views.length === 0" class="ws-sn-empty">
      当前域暂无可见芽
      <span>可在设置的芽管理中启用</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, useUIStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'
import { hasIcon } from '@/assets/iconRegistry'
import CountBadge from './CountBadge.vue'
import { countEntitiesByPlugin } from './sproutEntityCounts'

defineProps<{
  views: PluginView[]
  activeId: string | null
}>()

const emit = defineEmits<{ select: [view: PluginView] }>()

const uiStore = useUIStore()
const entityStore = useEntityStore()
const counts = computed(() => (
  uiStore.sproutCountEnabled ? countEntitiesByPlugin(entityStore.allTypeCounts) : new Map<string, number>()
))

function countOf(view: PluginView): number {
  return counts.value.get(view.pluginId || '') || 0
}
</script>

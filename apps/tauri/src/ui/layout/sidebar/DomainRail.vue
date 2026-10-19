<template>
  <div class="ws-sn-rail-layout">
    <DomainList
      :domains="domains"
      :active="filter"
      variant="rail"
      @select="(id) => emit('select-domain', id)"
    />
    <SproutList :views="views" :active-id="activeId" @select="(view) => emit('select-view', view)" />
  </div>
</template>

<script setup lang="ts">
import type { PluginView } from '@worldsea/entity-core/types'
import type { SproutDomainFilter } from '@/stores/uiStore'
import DomainList from './DomainList.vue'
import SproutList from './SproutList.vue'
import type { SproutDomainGroup } from './sproutNavigation'

defineProps<{
  domains: SproutDomainGroup[]
  filter: SproutDomainFilter
  views: PluginView[]
  activeId: string | null
}>()

const emit = defineEmits<{
  'select-domain': [id: SproutDomainGroup['id']]
  'select-view': [view: PluginView]
}>()
</script>

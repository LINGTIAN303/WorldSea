<template>
  <div class="ws-sn-dual-layout">
    <div class="ws-sn-dual-domains">
      <div class="ws-sn-dual-head">语义域</div>
      <WheelDomainList
        v-if="uiStore.sproutWheelEnabled"
        :domains="domains"
        :active="filter"
        @select="(id) => emit('select-domain', id)"
        @settle="(id) => emit('select-domain', id)"
      />
      <DomainList v-else :domains="domains" :active="filter" @select="(id) => emit('select-domain', id)" />
    </div>
    <div class="ws-sn-dual-sprouts">
      <div class="ws-sn-dual-head">{{ currentLabel }}</div>
      <WheelSproutList v-if="uiStore.sproutWheelEnabled" :views="views" :active-id="activeId" @select="(view) => emit('select-view', view)" />
      <SproutList v-else :views="views" :active-id="activeId" @select="(view) => emit('select-view', view)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'
import type { SproutDomainFilter } from '@/stores/uiStore'
import DomainList from './DomainList.vue'
import SproutList from './SproutList.vue'
import WheelDomainList from './WheelDomainList.vue'
import WheelSproutList from './WheelSproutList.vue'
import type { SproutDomainGroup } from './sproutNavigation'

const uiStore = useUIStore()

const props = defineProps<{
  domains: SproutDomainGroup[]
  filter: SproutDomainFilter
  views: PluginView[]
  activeId: string | null
}>()

const emit = defineEmits<{
  'select-domain': [id: SproutDomainGroup['id']]
  'select-view': [view: PluginView]
}>()

const currentLabel = computed(() => (
  props.domains.find(domain => domain.id === props.filter)?.label ?? '全部'
))
</script>

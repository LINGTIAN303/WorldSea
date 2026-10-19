<template>
  <div class="ws-sn-tabs-layout">
    <div class="ws-sn-tabbar" role="tablist" aria-label="芽导航">
      <button
        class="ws-sn-tab"
        :class="{ active: tab === 'domains' }"
        role="tab"
        :aria-selected="tab === 'domains'"
        @click="tab = 'domains'"
      >
        语义域
      </button>
      <button
        class="ws-sn-tab"
        :class="{ active: tab === 'sprouts' }"
        role="tab"
        :aria-selected="tab === 'sprouts'"
        @click="tab = 'sprouts'"
      >
        芽
      </button>
    </div>
    <DomainList
      v-if="tab === 'domains'"
      :domains="domains"
      :active="filter"
      @select="onSelectDomain"
    />
    <SproutList
      v-else
      :views="views"
      :active-id="activeId"
      @select="(view) => emit('select-view', view)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
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

const tab = ref<'domains' | 'sprouts'>('domains')

function onSelectDomain(id: SproutDomainGroup['id']) {
  emit('select-domain', id)
  tab.value = 'sprouts'
}
</script>

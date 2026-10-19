<template>
  <SidebarV2 v-if="uiStore.sproutNavMode === 'flat'" />
  <SplitNav v-else-if="uiStore.sproutNavMode === 'split'" />
  <SproutNav v-else :mode="domainMode" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import SidebarV2 from './SidebarV2.vue'
import SplitNav from './SplitNav.vue'
import SproutNav from './SproutNav.vue'

const uiStore = useUIStore()
const domainMode = computed<'popover' | 'rail' | 'tabs' | 'dual'>(() => (
  uiStore.sproutNavMode === 'flat' || uiStore.sproutNavMode === 'split'
    ? 'popover'
    : uiStore.sproutNavMode
))
</script>

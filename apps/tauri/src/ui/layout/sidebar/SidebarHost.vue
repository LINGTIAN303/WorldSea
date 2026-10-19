<template>
  <SidebarV2 v-if="uiStore.sproutNavMode === 'flat'" />
  <SproutNav v-else :mode="domainMode" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import SidebarV2 from './SidebarV2.vue'
import SproutNav from './SproutNav.vue'

const uiStore = useUIStore()
const domainMode = computed<'popover' | 'rail' | 'tabs' | 'dual'>(() => (
  uiStore.sproutNavMode === 'flat' ? 'popover' : uiStore.sproutNavMode
))
</script>

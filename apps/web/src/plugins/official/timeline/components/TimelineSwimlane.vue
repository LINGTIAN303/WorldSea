<template>
  <div class="swimlane" :class="{ collapsed: lane.collapsed }">
    <TimelineSwimlaneHeader :lane="lane" @toggle-collapse="$emit('toggleCollapse', $event)" />
    <div v-if="!lane.collapsed" class="swimlane-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Swimlane } from '../composables/useSwimlaneLayout'
import TimelineSwimlaneHeader from './TimelineSwimlaneHeader.vue'

defineProps<{
  lane: Swimlane
}>()

defineEmits<{
  toggleCollapse: [laneId: string]
}>()
</script>

<style scoped>
.swimlane {
  margin-bottom: 4px;
}
.swimlane.collapsed .swimlane-header {
  opacity: 0.7;
}
.swimlane-body {
  padding: 4px 0 4px 16px;
  position: relative;
  min-height: 40px;
}
</style>

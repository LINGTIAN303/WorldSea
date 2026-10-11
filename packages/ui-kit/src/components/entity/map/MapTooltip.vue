<template>
  <div v-if="show" class="rm-tooltip" :style="ctxPos(x, y, 180, 40)">
    <strong>{{ name }}</strong>
    <span v-if="type"> ({{ type }})</span>
  </div>
</template>

<script setup lang="ts">
import { ctxPos } from './geometry'

defineProps<{
  show: boolean
  x: number
  y: number
  name: string
  type: string
}>()
</script>

<style scoped>
.rm-tooltip { position: fixed; z-index: var(--z-overlay); background: var(--color-bg-surface); border: 1px solid var(--color-border-strong); border-radius: 4px; padding: 4px 8px; font-size: var(--font-size-sm); color: var(--color-text-primary); pointer-events: none; }
</style>

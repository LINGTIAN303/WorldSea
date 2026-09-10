<template>
  <div v-if="show" ref="dialogRef" class="mm-img-viewer" role="dialog" aria-modal="true" aria-label="关闭预览" tabindex="-1" @click="$emit('update:show', false)" @keydown.enter.prevent="$emit('update:show', false)" @keydown.space.prevent="$emit('update:show', false)">
    <img :src="url" class="mm-img-viewer-img" alt="" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps<{
  show: boolean
  url: string
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
}>()

const dialogRef = ref<HTMLElement | null>(null)

const { activate, deactivate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => emit('update:show', false),
})

watch(() => props.show, (v) => {
  if (v) nextTick(() => activate())
  else deactivate()
})
</script>

<style scoped>
.mm-img-viewer { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: calc(var(--z-overlay) + 1); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.mm-img-viewer-img { max-width: 90vw; max-height: 90vh; border-radius: var(--radius-md); }
</style>

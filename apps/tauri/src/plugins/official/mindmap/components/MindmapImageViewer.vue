<template>
  <div v-if="show" class="mm-img-viewer" role="button" tabindex="0" aria-label="关闭预览" @click="$emit('update:show', false)" @keydown.enter.prevent="$emit('update:show', false)" @keydown.space.prevent="$emit('update:show', false)">
    <img :src="url" class="mm-img-viewer-img" />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean
  url: string
}>()

defineEmits<{
  (e: 'update:show', v: boolean): void
}>()
</script>

<style scoped>
.mm-img-viewer { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: calc(var(--z-overlay) + 1); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.mm-img-viewer-img { max-width: 90vw; max-height: 90vh; border-radius: var(--radius-md); }
</style>

<template>
  <div v-if="selectedCount >= 1" class="mm-batch-bar">
    已选 {{ selectedCount }} 个节点
    <button class="mm-btn-sm" @click="$emit('delete')"><WsIcon name="delete" size="xs" /> 删除</button>
    <button class="mm-btn-sm" @click="$emit('cancel')"><WsIcon name="close" size="xs" /> 取消</button>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{
  selectedCount: number
}>()

defineEmits<{
  (e: 'delete'): void
  (e: 'cancel'): void
}>()
</script>

<style scoped>
.mm-batch-bar { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 6px 16px; box-shadow: var(--shadow-lg); display: flex; align-items: center; gap: 8px; font-size: var(--font-size-sm); z-index: 100; }
.mm-btn-sm { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--font-size-sm); }
.mm-btn-sm:hover { background: var(--hover-bg); }
</style>

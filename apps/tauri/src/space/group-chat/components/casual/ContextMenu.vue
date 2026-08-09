<template>
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <div class="context-menu-item" @click="$emit('reply')">回复</div>
      <div class="context-menu-item" @click="$emit('copy')">复制</div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { GroupChatMessage } from '../../types'

defineProps<{
  contextMenu: { visible: boolean; x: number; y: number; msg: GroupChatMessage | null }
}>()

defineEmits<{
  reply: []
  copy: []
}>()
</script>

<style scoped>
.context-menu { position: fixed; background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-mid); box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 4px; min-width: 120px; z-index: 10000; }
.context-menu-item { padding: 8px 12px; font-size: var(--fs-sm); cursor: pointer; border-radius: var(--radius-xs); color: var(--color-text); }
.context-menu-item:hover { background: var(--color-surface); }
</style>
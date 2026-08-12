<template>
  <button
    class="panel-toggle"
    :class="{ active: open }"
    @click="emit('click')"
    :title="open ? '收起侧边栏' : '打开侧边栏'"
    :aria-label="open ? '收起侧边栏' : '打开侧边栏'"
    :aria-pressed="open"
  >
    <WsIcon :name="open ? 'panel-left-close' : 'panel-left-open'" size="sm" />
  </button>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

// 2026-08-12：由「会话列表/知识墙」双图标翻转按钮，简化为单一「侧边栏」开关按钮。
// 会话列表与知识库已合并到侧边栏面板内，由面板内 Tab 切换，不再经此按钮切换。
defineProps<{ open: boolean }>()
const emit = defineEmits<{ click: [] }>()
</script>

<style scoped>
.panel-toggle {
  position: relative;
  width: 32px;
  height: 40px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}
.panel-toggle:hover {
  background: var(--color-surface);
}
.panel-toggle.active {
  color: var(--color-primary);
}
</style>
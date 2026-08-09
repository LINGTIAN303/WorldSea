<template>
  <div v-if="show" class="cv-ctx-menu" :style="{ left: x + 'px', top: y + 'px' }">
    <div class="cv-ctx-item" role="button" tabindex="0" @click="onJump" @keydown.enter="onJump">
      ↗ 跳转到主视图
    </div>
    <div class="cv-ctx-divider"></div>
    <div class="cv-ctx-item" role="button" tabindex="0" @click="onMove(-1)" @keydown.enter="onMove(-1)">
      <WsIcon name="arrow-up" size="xs" /> 前移
    </div>
    <div class="cv-ctx-item" role="button" tabindex="0" @click="onMove(1)" @keydown.enter="onMove(1)">
      <WsIcon name="chevron-right" size="xs" /> 后移
    </div>
    <div class="cv-ctx-divider"></div>
    <div
      class="cv-ctx-item cv-ctx-danger"
      role="button"
      tabindex="0"
      @click="onRemove"
      @keydown.enter="onRemove"
    >
      <WsIcon name="close" size="xs" /> 移除面板
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 面板右键上下文菜单
 * - 由父组件控制显示位置与可见性
 * - 通过 emit 将动作委托回父组件执行
 */
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{
  show: boolean
  x: number
  y: number
}>()

const emit = defineEmits<{
  jump: []
  move: [dir: number]
  remove: []
  action: []
}>()

// 每次点击后需要关闭菜单，统一通过 action 事件通知父组件
function onJump() {
  emit('jump')
  emit('action')
}

function onMove(dir: number) {
  emit('move', dir)
  emit('action')
}

function onRemove() {
  emit('remove')
  emit('action')
}
</script>

<style scoped>
.cv-ctx-menu {
  position: fixed;
  z-index: var(--z-sticky);
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  padding: 4px 0;
  min-width: 160px;
  box-shadow: var(--shadow-md);
}

.cv-ctx-item {
  padding: 7px 14px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  color: var(--text-color);
  display: flex;
  align-items: center;
  gap: 6px;
}

.cv-ctx-item:hover {
  background: var(--hover-bg);
}

.cv-ctx-divider {
  height: 1px;
  background: var(--border-light);
  margin: 4px 0;
}

.cv-ctx-danger {
  color: var(--danger);
}

.cv-ctx-danger:hover {
  background: var(--danger-soft, rgba(220, 53, 69, 0.08));
}
</style>

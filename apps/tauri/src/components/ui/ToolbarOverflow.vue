<template>
  <div ref="rootRef" class="to-wrap">
    <button
      class="to-btn"
      :class="{ 'to-btn--pinned': open }"
      :aria-expanded="open"
      :aria-label="label"
      :title="label"
      aria-haspopup="menu"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <WsIcon name="more-horizontal" size="sm" />
    </button>
    <Transition name="ws-menu">
      <div v-if="open" class="to-menu" role="menu" @click="close">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'

/**
 * 工具栏溢出折叠菜单：收纳上移 R3 后空间不足的次要控件。
 * 用法：把需要折叠的控件放进默认 slot，点击 ⋯ 展开，点外部 / Esc 关闭。
 */
withDefaults(defineProps<{ label?: string }>(), { label: '更多' })

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function toggle() { open.value = !open.value }
function close() { open.value = false }
function onDocClick(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) close()
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
})
// Esc 监听随展开挂载 / 收起卸载（快捷键系统整理批：消除常驻空转监听；外点 click 保持常驻）
watch(open, (v) => {
  if (v) document.addEventListener('keydown', onDocKey)
  else document.removeEventListener('keydown', onDocKey)
})
</script>

<style scoped>
.to-wrap { position: relative; display: inline-flex; flex-shrink: 0; }
.to-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-color, var(--color-border));
  border-radius: var(--radius-sm);
  background: transparent; color: var(--text-secondary, var(--color-text-secondary));
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.to-btn:hover, .to-btn--pinned {
  background: var(--hover-bg, var(--color-bg-hover));
  color: var(--text-color, var(--color-text-primary));
}
.to-menu {
  position: absolute; top: calc(100% + 6px); right: 0;
  min-width: 200px; padding: 4px;
  background: var(--sf-overlay-bg);
  border: 1px solid var(--sf-overlay-edge);
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  box-shadow: var(--sf-overlay-shadow);
  backdrop-filter: var(--sf-overlay-filter, none);
  z-index: 300;
  display: flex; flex-direction: column; gap: 2px;
}
.to-menu :deep(.to-item) {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 7px 10px;
  font-size: var(--font-size-sm); color: var(--text-color, var(--color-text-primary));
  background: transparent; border: none; border-radius: var(--radius-sm);
  cursor: pointer; text-align: left; white-space: nowrap;
}
.to-menu :deep(.to-item:hover) { background: var(--sf-panel-bg-muted, var(--color-bg-hover)); }
.to-menu :deep(.to-item--danger) { color: var(--danger, var(--color-danger)); }
.to-menu :deep(.to-item--check) { color: var(--primary, var(--color-primary)); }
.to-menu :deep(.to-chip) {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid;
  font-size: var(--font-size-xs); cursor: pointer; white-space: nowrap;
}
.to-menu :deep(.to-chip input) { width: 12px; height: 12px; margin: 0; cursor: pointer; accent-color: var(--primary, var(--color-primary)); }
.to-menu :deep(.to-group) {
  font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary));
  padding: 6px 10px 2px; text-transform: uppercase; letter-spacing: 0.5px;
}
.to-menu :deep(.to-divider) { height: 1px; margin: 4px 6px; background: var(--border-color, var(--color-border)); }
</style>

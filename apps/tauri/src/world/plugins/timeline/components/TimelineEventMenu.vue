<template>
  <div class="te-menu" :style="menuStyle" role="menu" aria-label="事件操作" @contextmenu.prevent>
    <div class="te-menu-title" :title="name">{{ name }}</div>
    <button type="button" class="te-menu-item" role="menuitem" @click="$emit('pick', 'edit')">编辑事件</button>
    <button type="button" class="te-menu-item" role="menuitem" @click="$emit('pick', 'focus')">{{ focusLabel }}</button>
    <button type="button" class="te-menu-item te-menu-danger" role="menuitem" @click="$emit('pick', 'delete')">删除事件</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { TimelineEventAction } from '../composables/useTimelineEventMenu'

const props = defineProps<{
  /** 指针位置（视口坐标） */
  x: number
  y: number
  /** 目标事件名（菜单标题） */
  name: string
  /** 「在画布中查看 / 在编年史中查看」按当前视图取反 */
  focusLabel: string
}>()

const emit = defineEmits<{
  pick: [action: TimelineEventAction]
  close: []
}>()

const MENU_WIDTH = 184
const MENU_HEIGHT = 148
/** 贴边翻转：靠右/靠下时向内收，避免菜单跑出视口 */
const menuStyle = computed(() => ({
  left: Math.max(8, Math.min(props.x, window.innerWidth - MENU_WIDTH - 8)) + 'px',
  top: Math.max(8, Math.min(props.y, window.innerHeight - MENU_HEIGHT - 8)) + 'px',
}))

function onPointerDown(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.te-menu')) emit('close')
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<style scoped>
.te-menu {
  position: fixed;
  z-index: 1000;
  min-width: 168px;
  padding: 6px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-dropdown);
}
.te-menu-title {
  max-width: 220px;
  padding: 4px 8px 6px;
  margin-bottom: 4px;
  overflow: hidden;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  text-overflow: ellipsis;
  border-bottom: 1px solid var(--border-color);
}
.te-menu-item {
  display: block;
  width: 100%;
  padding: 6px 8px;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
}
.te-menu-item:hover { background: var(--color-bg-hover); }
.te-menu-item:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.te-menu-danger { color: var(--danger); }
.te-menu-danger:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
</style>

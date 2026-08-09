<template>
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      ref="menuRef"
      role="menu"
      tabindex="-1"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
      @keydown="onMenuKeydown"
    >
      <div
        class="context-menu-item"
        role="menuitem"
        tabindex="-1"
        @click="emit('reply')"
        @keydown.enter.prevent="emit('reply')"
        @keydown.space.prevent="emit('reply')"
      >回复</div>
      <div
        class="context-menu-item"
        role="menuitem"
        tabindex="-1"
        @click="emit('copy')"
        @keydown.enter.prevent="emit('copy')"
        @keydown.space.prevent="emit('copy')"
      >复制</div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { GroupChatMessage } from '../../types'

const props = defineProps<{
  contextMenu: { visible: boolean; x: number; y: number; msg: GroupChatMessage | null }
}>()

const emit = defineEmits<{
  reply: []
  copy: []
  close: []
}>()

const menuRef = ref<HTMLDivElement | null>(null)
let returnFocusEl: HTMLElement | null = null

/** 聚焦指定索引的菜单项（循环环绕） */
function focusItem(index: number): void {
  const items = menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]')
  if (!items || items.length === 0) return
  const target = items[((index % items.length) + items.length) % items.length]
  target.focus()
}

/** 菜单内键盘导航：方向键移动、Esc 关闭（WAI-ARIA Menu 模式） */
function onMenuKeydown(e: KeyboardEvent): void {
  const items = menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
  const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLElement)
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      focusItem(currentIndex + 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      focusItem(currentIndex - 1)
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}

// 打开：记录触发元素并移焦首项；关闭：仅当焦点仍在菜单内时归还焦点（避免与用户点外操作抢焦点）
watch(() => props.contextMenu.visible, (visible) => {
  if (visible) {
    returnFocusEl = document.activeElement as HTMLElement | null
    nextTick(() => focusItem(0))
  } else if (returnFocusEl) {
    const inside = menuRef.value?.contains(document.activeElement as Node)
    if (inside && returnFocusEl.isConnected) returnFocusEl.focus()
    returnFocusEl = null
  }
})
</script>

<style scoped>
.context-menu { position: fixed; background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-mid); box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 4px; min-width: 120px; z-index: 10000; outline: none; }
.context-menu-item { padding: 8px 12px; font-size: var(--fs-sm); cursor: pointer; border-radius: var(--radius-xs); color: var(--color-text); }
.context-menu-item:hover,
.context-menu-item:focus { background: var(--color-surface); }
</style>

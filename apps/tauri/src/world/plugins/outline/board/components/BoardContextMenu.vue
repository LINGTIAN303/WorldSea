<template>
  <!--
    白板右键菜单（BoardContextMenu）—— 纯展示 + 事件上报
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §十三
    · 菜单项由 `contextMenu.buildMenuItems` 纯函数产出（新增动作只改那一处）
    · 键盘可达：↑↓ 在未禁用项间移动、Enter 执行、Esc 关闭（菜单无障碍）
    · Teleport 到 body，避免被画布的 transform 层叠上下文裁剪
  -->
  <Teleport to="body">
    <Transition name="ws-menu">
    <div
      v-if="show"
      ref="menuEl"
      class="ctx"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px`, '--ws-origin': '0 0' }"
      role="menu"
      :aria-label="ariaLabel"
      tabindex="-1"
      @contextmenu.prevent
      @pointerdown.stop
      @keydown="onKeydown"
    >
      <template v-for="(item, i) in items" :key="item.id">
        <div v-if="item.sep && i > 0" class="ctx-sep" role="separator" />
        <button
          class="ctx-item"
          role="menuitem"
          type="button"
          :class="{
            'ctx-item--danger': item.danger,
            'ctx-item--active': i === activeIndex,
          }"
          :disabled="item.disabled"
          :aria-checked="item.checked === undefined ? undefined : item.checked"
          @mousedown.prevent
          @mouseenter="activeIndex = item.disabled ? activeIndex : i"
          @click="pick(item)"
        >
          <span class="ctx-check" aria-hidden="true">{{ item.checked ? '✓' : '' }}</span>
          <span class="ctx-label">{{ item.label }}</span>
          <kbd v-if="item.keys" class="ctx-kbd">{{ item.keys }}</kbd>
        </button>
      </template>
    </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { clampMenuPosition, nextEnabledIndex, type MenuItem } from '../contextMenu'

const props = defineProps<{
  show: boolean
  x: number
  y: number
  items: MenuItem[]
  /** 无障碍标签（如「容器菜单」），便于读屏区分不同落点的菜单 */
  ariaLabel?: string
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'close'): void
}>()

const menuEl = ref<HTMLDivElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const activeIndex = ref(-1)

/** 打开时定位 + 钳位（要先渲染出来才能量到真实尺寸，故 nextTick） */
watch(
  () => [props.show, props.x, props.y] as const,
  async ([show]) => {
    if (!show) return
    pos.value = { x: props.x, y: props.y }
    activeIndex.value = -1
    await nextTick()
    const el = menuEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    pos.value = clampMenuPosition(props.x, props.y, { w: r.width, h: r.height }, {
      w: window.innerWidth,
      h: window.innerHeight,
    })
    el.focus()
  },
  { immediate: true },
)

function pick(item: MenuItem): void {
  if (item.disabled) return
  emit('select', item.id)
  emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = nextEnabledIndex(props.items, activeIndex.value, e.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const item = props.items[activeIndex.value]
    if (item) pick(item)
  }
}
</script>

<style scoped>
.ctx {
  position: fixed;
  /* 令牌档：与项目 --z-dropdown 对齐（原来 z-index 无令牌档是既有欠账，新代码不重复） */
  z-index: var(--z-dropdown, 100);
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  background: var(--modal-bg);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  outline: none;
}
.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-light);
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  /* 显式设色：符号/文字按钮在暗色主题下必须继承确定颜色（项目通用坑） */
  color: var(--text-color);
  font-size: var(--font-size-xs);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.ctx-item--active:not(:disabled) { background: var(--hover-bg); }
.ctx-item:disabled {
  color: var(--text-tertiary);
  cursor: default;
}
.ctx-item--danger { color: var(--danger); }
.ctx-item--danger.ctx-item--active:not(:disabled) {
  background: var(--danger-soft, rgba(220, 53, 69, 0.08));
}
/* 勾选位固定占宽：有无勾选时文字都能对齐 */
.ctx-check {
  width: 10px;
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--primary);
}
.ctx-label {
  flex: 1;
  white-space: nowrap;
}
.ctx-kbd {
  flex-shrink: 0;
  padding: 0 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-family: inherit;
  font-size: var(--font-size-2xs);
  line-height: 1.5;
}
</style>

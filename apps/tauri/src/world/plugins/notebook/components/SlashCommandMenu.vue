<template>
  <div v-if="visible" ref="elRef" class="slash-command-menu" :style="{ left: pos.x + 'px', top: pos.y + 'px', maxHeight: pos.maxHeight ? pos.maxHeight + 'px' : undefined }">
    <div
      v-for="(item, idx) in items"
      :key="item.id"
      class="sc-item"
      :class="{ active: selectedIdx === idx }"
      @click="selectItem(item)"
      @mouseenter="selectedIdx = idx"
    >
      <span class="sc-icon"><WsIcon :name="item.icon" size="xs" /></span>
      <div class="sc-text">
        <span class="sc-label">{{ item.label }}</span>
        <span class="sc-desc">{{ item.description }}</span>
      </div>
    </div>
    <p v-if="items.length === 0" class="sc-empty">无匹配命令</p>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { computePopoverPos, type PopoverDir } from '../composables/popoverPosition'
import type { SlashCommandItem } from '../composables/slashCommandExtension'

const emit = defineEmits<{
  select: [item: SlashCommandItem]
  close: []
}>()

const visible = ref(false)
const items = ref<SlashCommandItem[]>([])
const selectedIdx = ref(0)
const pos = ref({ x: 0, y: 0, maxHeight: undefined as number | undefined })
const elRef = ref<HTMLElement | null>(null)
/** suggestion 的实时位置函数（持久保存：每次调用取当前锚点坐标） */
let rectProvider: (() => DOMRect | null) | null = null
/** 方向粘性：滚动/过滤重算时保持上次方向（见 popoverPosition 头注释） */
let dir: PopoverDir = 'below'
let rafId: number | null = null
/** 弹层尺寸缓存（内容变化时重测；逐帧跟随时不读布局，避免每帧强制重排的"生硬感"） */
const sizeCache = { width: 240, height: 200 }

/** 重测弹层实际尺寸（open / 过滤变化后调用，须在 nextTick 渲染之后） */
function measure(): void {
  if (!elRef.value) return
  sizeCache.width = elRef.value.offsetWidth || sizeCache.width
  sizeCache.height = elRef.value.offsetHeight || sizeCache.height
}

/** 用缓存尺寸重算位置（open / updateItems / 逐帧跟随 时调用） */
function place(): void {
  if (!visible.value) return
  const next = computePopoverPos(rectProvider, sizeCache, dir)
  if (!next) return // 锚点不可得：保持原位（不乱跳兜底位置）
  dir = next.dir
  const maxHeight = next.maxHeight ?? undefined
  if (next.x !== pos.value.x || next.y !== pos.value.y || maxHeight !== pos.value.maxHeight) {
    pos.value = { x: next.x, y: next.y, maxHeight }
  }
}

/**
 * 打开期间的逐帧跟随（走查修复轮 3）：不依赖 scroll 事件链，
 * 滚动/布局变化都会反映到锚点坐标 → 弹层稳定贴住指令符。
 */
function startFollow(): void {
  stopFollow()
  const tick = (): void => {
    if (!visible.value) {
      rafId = null
      return
    }
    place()
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopFollow(): void {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
}

function open(clientRect: (() => DOMRect | null) | null, filteredItems: SlashCommandItem[]) {
  visible.value = true
  items.value = filteredItems
  selectedIdx.value = 0
  rectProvider = clientRect
  dir = 'below' // 每次打开重置方向偏好（默认贴光标下方）
  // 初始定位与 place 同源（估算尺寸；nextTick 后重测实际尺寸修正）
  const initial = computePopoverPos(rectProvider, sizeCache, dir)
  if (initial) {
    dir = initial.dir
    pos.value = { x: initial.x, y: initial.y, maxHeight: initial.maxHeight ?? undefined }
  }
  void nextTick(() => { measure(); place(); startFollow() })
}

function close() {
  visible.value = false
  stopFollow()
  emit('close')
}

function updateItems(filteredItems: SlashCommandItem[]) {
  items.value = filteredItems
  selectedIdx.value = 0
  void nextTick(() => { measure(); place() }) // 过滤后高度变化 → 重测尺寸 + 位置重算
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (!visible.value) return false

  if (event.key === 'ArrowUp') {
    moveSelection(-1)
    return true
  }
  if (event.key === 'ArrowDown') {
    moveSelection(1)
    return true
  }
  if (event.key === 'Enter') {
    confirmSelection()
    return true
  }
  if (event.key === 'Escape') {
    close()
    return true
  }
  return false
}

function moveSelection(dir: number) {
  const len = items.value.length
  if (len === 0) return
  selectedIdx.value = ((selectedIdx.value + dir) % len + len) % len
}

function confirmSelection() {
  const item = items.value[selectedIdx.value]
  if (item) selectItem(item)
}

function selectItem(item: SlashCommandItem) {
  emit('select', item)
  visible.value = false
  stopFollow()
}

onBeforeUnmount(stopFollow)

defineExpose({ open, close, updateItems, onKeyDown })
</script>

<style scoped>
.slash-command-menu {
  position: fixed;
  z-index: var(--z-popover, 400);
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  padding: 4px;
  width: 240px;
  max-height: 320px;
  box-shadow: var(--shadow-md);
  overflow-y: auto;
}
.sc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}
.sc-item:hover,
.sc-item.active {
  background: var(--hover-bg);
}
.sc-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 24px;
}
.sc-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sc-label {
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
}
.sc-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 1px;
}
.sc-empty {
  margin: 8px 0;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  text-align: center;
}
</style>

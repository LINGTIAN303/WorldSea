<template>
  <!-- 块手柄层（批 5 V4）：绝对覆盖编辑区（.nb-tt-wrap），层自身不拦截鼠标；
       手柄/菜单元素单独放行 pointer-events。定位坐标 = 块 rect − wrap rect。 -->
  <div ref="layerRef" class="nb-block-layer">
    <button
      v-if="visible"
      class="nb-block-handle"
      :class="{ 'nb-block-handle--drag': dragging }"
      :style="{ top: handleTop + 'px', left: handleLeft + 'px' }"
      title="拖动移动块；点击打开菜单"
      aria-label="块操作"
      draggable="true"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
      @click="onHandleClick"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
    ><WsIcon name="drag" size="sm" /></button>
    <div
      v-if="menuOpen"
      class="nb-block-menu"
      :style="{ top: menuTop + 'px', left: menuLeft + 'px' }"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
    >
      <button
        v-for="item in MENU_ITEMS"
        :key="item.id"
        class="nb-bm-item"
        :class="{ 'nb-bm-item--danger': item.danger }"
        @click="runMenu(item.id)"
      >
        <WsIcon :name="item.icon" size="xs" />
        <span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { Editor } from '@tiptap/core'
import { findTopBlock, moveBlockBy, duplicateBlock, deleteBlock, blockSlice } from '../composables/blockHandle'

const props = defineProps<{ editor: Editor | undefined }>()

const MENU_ITEMS = [
  { id: 'duplicate', icon: 'copy', label: '复制块', danger: false },
  { id: 'move-up', icon: 'arrow-up', label: '上移', danger: false },
  { id: 'move-down', icon: 'arrow-down', label: '下移', danger: false },
  { id: 'delete', icon: 'trash', label: '删除块', danger: true },
] as const

const layerRef = ref<HTMLElement | null>(null)

/** 手柄可见性与当前位置 */
const visible = ref(false)
const dragging = ref(false)
const menuOpen = ref(false)
const handleTop = ref(0)
const handleLeft = ref(0)
const menuTop = ref(0)
const menuLeft = ref(0)

/** 当前悬停块（pos + size 快照） */
let current: { pos: number; size: number } | null = null

let areaEl: HTMLElement | null = null
let wrapEl: HTMLElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let moveRaf: number | null = null
let scrollRaf: number | null = null
let lastX = 0
let lastY = 0
/** 拖拽开始时高亮的源块 DOM（dragend 复原） */
let dragSrcEl: HTMLElement | null = null
/** 悬停指示背景所在的块 DOM（批 5 V4 增强，随 hover 块迁移；隐藏/解绑时移除） */
let hoverBgEl: HTMLElement | null = null

// ── 生命周期：绑定 / 解绑（editor 就绪且层挂载后）──
watch(() => props.editor, (ed) => {
  unbind()
  if (!ed) return
  void nextTick(() => bind())
}, { immediate: true })

function bind(): void {
  // layer 在 .nb-tt-wrap 内（NotebookTipTapEditor 模板）；鼠标追踪面 = 编辑区 .nb-tt-body
  wrapEl = layerRef.value?.closest('.nb-tt-wrap') as HTMLElement | null
  areaEl = layerRef.value?.closest('.nb-tt-body') as HTMLElement | null
  areaEl?.addEventListener('mousemove', onAreaMouseMove)
  areaEl?.addEventListener('mouseleave', scheduleHide)
  document.addEventListener('scroll', onScrollCapture, true)
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('keydown', onDocKeyDown, true)
}

function unbind(): void {
  areaEl?.removeEventListener('mousemove', onAreaMouseMove)
  areaEl?.removeEventListener('mouseleave', scheduleHide)
  document.removeEventListener('scroll', onScrollCapture, true)
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('keydown', onDocKeyDown, true)
  areaEl = null
  wrapEl = null
  setHoverBg(null)
  cancelHide()
  if (moveRaf != null) { cancelAnimationFrame(moveRaf); moveRaf = null }
  if (scrollRaf != null) { cancelAnimationFrame(scrollRaf); scrollRaf = null }
  restoreDragSrc()
}

onBeforeUnmount(unbind)

// ── 鼠标追踪（rAF 节流）──
function onAreaMouseMove(e: MouseEvent): void {
  cancelHide()
  lastX = e.clientX
  lastY = e.clientY
  if (moveRaf != null) return
  moveRaf = requestAnimationFrame(() => {
    moveRaf = null
    updateHover(lastX, lastY)
  })
}

function updateHover(x: number, y: number): void {
  const ed = props.editor
  if (!ed) return
  if (menuOpen.value || dragging.value) return // 菜单/拖拽期间锁定，不随鼠标漂移
  const hit = ed.view.posAtCoords({ left: x, top: y })
  if (!hit) return // 编辑区 padding/gutter：保持现状（隐藏由 mouseleave 路径负责）
  const block = findTopBlock(ed.state.doc, hit.pos)
  // 空「文本类」块不显示手柄（含拖尾空段）；atom 块（hr/图片等）即使无内容也可操作
  if (!block || (block.node.isTextblock && block.node.content.size === 0)) {
    hideNow()
    return
  }
  if (current?.pos === block.pos && visible.value) {
    place() // 同块：仅更新位置（滚动/布局变化后的重对齐）
    return
  }
  current = { pos: block.pos, size: block.node.nodeSize }
  visible.value = true
  place()
}

// ── 定位 ──
/** 悬停块整块淡背景（Notion 式可见性增强：类规则在 prose.css；换块时迁移，同一元素幂等） */
function setHoverBg(dom: HTMLElement | null): void {
  if (hoverBgEl === dom) return
  hoverBgEl?.classList.remove('nb-block-hover')
  dom?.classList.add('nb-block-hover')
  hoverBgEl = dom
}

function place(): void {
  const ed = props.editor
  if (!ed || !current || !wrapEl) return
  const dom = ed.view.nodeDOM(current.pos) as HTMLElement | null
  if (!dom) return
  setHoverBg(dom)
  const r = dom.getBoundingClientRect()
  const wr = wrapEl.getBoundingClientRect()
  handleTop.value = Math.round(r.top - wr.top + 2)
  handleLeft.value = Math.round(Math.max(2, r.left - wr.left - 26))
  if (menuOpen.value) {
    menuTop.value = handleTop.value + 24
    menuLeft.value = handleLeft.value
  }
}

function onScrollCapture(): void {
  if (!visible.value) return
  if (scrollRaf != null) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null
    place()
  })
}

// ── 显示/隐藏（手柄与菜单 hover 期保持）──
function scheduleHide(): void {
  if (menuOpen.value || dragging.value) return
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(hideNow, 260)
}

function cancelHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function hideNow(): void {
  cancelHide()
  visible.value = false
  menuOpen.value = false
  current = null
  setHoverBg(null)
}

// ── 手柄交互：点击 = 菜单；拖动 = 块重排（ProseMirror 外部拖拽源）──
function onHandleClick(e: MouseEvent): void {
  e.stopPropagation()
  if (dragging.value) return
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) place()
  else hideNow()
}

function onDragStart(e: DragEvent): void {
  const ed = props.editor
  if (!ed || !current) {
    e.preventDefault()
    return
  }
  const slice = blockSlice(ed.state.doc, current.pos)
  if (!slice) {
    e.preventDefault()
    return
  }
  // PM 外部拖拽源模式：dragstart 设 view.dragging，drop 由 PM 内置处理；
  // 落点线 = StarterKit Dropcursor（其读 view.dragging.slice 精确定位）。
  ed.view.dragging = { slice, move: true }
  dragging.value = true
  menuOpen.value = false
  const dt = e.dataTransfer
  if (dt) {
    dt.setData('text/plain', '')
    dt.effectAllowed = 'move'
    // 拖拽预览图 = 源块截图（默认会是手柄小按钮，观感差）
    const dom = ed.view.nodeDOM(current.pos) as HTMLElement | null
    if (dom) {
      const r = dom.getBoundingClientRect()
      dt.setDragImage(dom, Math.min(Math.max(0, e.clientX - r.left), r.width), 12)
      dragSrcEl = dom
      dom.classList.add('nb-block-dragging')
    }
  }
}

function onDragEnd(): void {
  const ed = props.editor
  if (ed) ed.view.dragging = null
  dragging.value = false
  restoreDragSrc()
  // 拖放后文档结构变化 → 旧 pos 失效，收起手柄待下次 hover 重新定位
  hideNow()
}

function restoreDragSrc(): void {
  dragSrcEl?.classList.remove('nb-block-dragging')
  dragSrcEl = null
}

// ── 菜单动作 ──
function runMenu(id: string): void {
  const ed = props.editor
  if (!ed || !current) return
  const { pos } = current
  if (id === 'duplicate') duplicateBlock(ed, pos)
  else if (id === 'move-up') moveBlockBy(ed, pos, -1)
  else if (id === 'move-down') moveBlockBy(ed, pos, 1)
  else if (id === 'delete') deleteBlock(ed, pos)
  // 变换后块位置可能失效 → 收起（鼠标再动一下即重新出现）
  hideNow()
}

// ── 全局关闭（点击层外 / Esc）──
function onDocMouseDown(e: MouseEvent): void {
  if (!menuOpen.value) return
  const t = e.target as Node
  if (layerRef.value?.contains(t)) return
  hideNow()
}

function onDocKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) hideNow()
}
</script>

<style scoped>
.nb-block-layer { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
.nb-block-handle {
  position: absolute; width: 22px; height: 26px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--radius-xs); background: transparent;
  color: var(--color-text-secondary); cursor: grab; pointer-events: auto;
  transition: background 0.12s, color 0.12s;
}
.nb-block-handle:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.nb-block-handle--drag { cursor: grabbing; background: var(--color-bg-hover); color: var(--color-primary); }
.nb-block-menu {
  position: absolute; min-width: 132px; padding: 4px; pointer-events: auto;
  background: var(--color-bg-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); box-shadow: var(--shadow-md);
}
.nb-bm-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 5px 10px; border: none; border-radius: var(--radius-xs);
  background: transparent; color: var(--color-text-secondary);
  font-size: var(--font-size-xs); cursor: pointer; text-align: left;
  transition: background 0.1s, color 0.1s;
}
.nb-bm-item:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.nb-bm-item--danger { color: var(--color-danger); }
.nb-bm-item--danger:hover { background: var(--danger-soft); color: var(--color-danger); }
</style>

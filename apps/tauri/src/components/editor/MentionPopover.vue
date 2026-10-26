<template>
  <div v-if="visible" ref="elRef" class="mention-popover" :style="{ left: pos.x + 'px', top: pos.y + 'px', maxHeight: pos.maxHeight ? pos.maxHeight + 'px' : undefined }">
    <input
      ref="inputRef"
      v-model="query"
      class="mention-input"
      placeholder="搜索实体..."
      @keydown.down.prevent="moveSelection(1)"
      @keydown.up.prevent="moveSelection(-1)"
      @keydown.enter.prevent="confirmSelection"
      @keydown.escape.prevent="close"
    />
    <div class="mention-results">
      <div
        v-for="(item, idx) in filteredItems"
        :key="item.id"
        class="mention-item"
        :class="{ active: selectedIdx === idx }"
        @click="selectItem(item)"
        @mouseenter="selectedIdx = idx"
      >
        <span class="mi-icon"><WsIcon :name="item.icon" size="xs" /></span>
        <span class="mi-name">{{ item.name }}</span>
        <span class="mi-type">{{ item.typeLabel }}</span>
      </div>
      <p v-if="filteredItems.length === 0 && query" class="mention-empty">无结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @实体提及弹层（正文写作/笔记本两芽共用，notebook 超集版为唯一实现：
 * 方向粘性定位 + rAF 逐帧跟随 + maxHeight 动态约束）。manuscript 用默认 props
 * （kind='all'）；notebook [[ 双链用 kind='notes' + excludeId 防自链。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore } from '@worldsea/entity-core'
import { entitySchemaRegistry } from '@worldsea/entity-core'
import { computePopoverPos, type PopoverDir } from '@/composables/popoverPosition'

interface MentionItem {
  id: string
  name: string
  type: string
  typeLabel: string
  icon: string
}

const props = defineProps<{
  /** 'all' = 全部实体（@ 提及）；'notes' = 仅 notebook 实体（[[ 双链，批 3 I4） */
  kind?: 'all' | 'notes'
  /** 双链模式排除的笔记 id（= 当前笔记，不能链自己） */
  excludeId?: string | null
}>()

const emit = defineEmits<{
  select: [item: MentionItem]
  close: []
}>()

const es = useEntityStore()
const visible = ref(false)
const query = ref('')
const selectedIdx = ref(0)
const pos = ref({ x: 0, y: 0, maxHeight: undefined as number | undefined })
const inputRef = ref<HTMLInputElement | null>(null)
const elRef = ref<HTMLElement | null>(null)
/** suggestion 的实时位置函数（持久保存：每次调用取当前锚点坐标） */
let rectProvider: (() => DOMRect | null) | null = null
/** 方向粘性：滚动/过滤重算时保持上次方向（见 popoverPosition 头注释） */
let dir: PopoverDir = 'below'
let rafId: number | null = null
/** 弹层尺寸缓存（内容变化时重测；逐帧跟随时不读布局，避免每帧强制重排的"生硬感"） */
const sizeCache = { width: 260, height: 220 }

/** 重测弹层实际尺寸（open / 过滤变化后调用，须在 nextTick 渲染之后） */
function measure(): void {
  if (!elRef.value) return
  sizeCache.width = elRef.value.offsetWidth || sizeCache.width
  sizeCache.height = elRef.value.offsetHeight || sizeCache.height
}

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

const allItems = computed<MentionItem[]>(() => {
  let pool = (es.entities ?? [])
  if (props.kind === 'notes') {
    pool = pool.filter(e => e.type === 'notebook' && e.id !== props.excludeId)
  }
  return pool.map(e => ({
    id: e.id,
    name: e.name,
    type: e.type,
    typeLabel: e.type === 'notebook' ? '笔记' : entitySchemaRegistry.getLabel(e.type),
    icon: e.type === 'notebook' ? 'notebook' : (entitySchemaRegistry.getIconName(e.type) || 'outline'),
  }))
})

const filteredItems = computed(() => {
  if (!query.value) return allItems.value.slice(0, 20)
  const q = query.value.toLowerCase()
  return allItems.value.filter(i =>
    i.name.toLowerCase().includes(q) || i.typeLabel.toLowerCase().includes(q)
  ).slice(0, 20)
})

function open(clientRect: (() => DOMRect | null) | null) {
  visible.value = true
  query.value = ''
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
  nextTick(() => {
    inputRef.value?.focus()
  })
}

function close() {
  visible.value = false
  stopFollow()
  emit('close')
}

function moveSelection(dir: number) {
  const len = filteredItems.value.length
  if (len === 0) return
  selectedIdx.value = ((selectedIdx.value + dir) % len + len) % len
}

function confirmSelection() {
  const item = filteredItems.value[selectedIdx.value]
  if (item) selectItem(item)
}

function selectItem(item: MentionItem) {
  emit('select', item)
  visible.value = false
  stopFollow()
}

watch(query, () => {
  selectedIdx.value = 0
  void nextTick(() => { measure(); place() }) // 过滤后高度变化 → 重测尺寸 + 位置重算
})

onBeforeUnmount(stopFollow)

defineExpose({ open, close })
</script>

<style scoped>
.mention-popover {
  position: fixed;
  z-index: var(--z-popover, 400);
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  padding: 8px;
  width: 260px;
  max-height: 300px;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
}
.mention-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  background: var(--input-bg);
  color: var(--text-color);
  box-sizing: border-box;
  margin-bottom: 4px;
}
.mention-results {
  overflow-y: auto;
  max-height: 220px;
}
.mention-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  cursor: pointer;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
}
.mention-item:hover,
.mention-item.active {
  background: var(--hover-bg);
}
.mi-icon { font-size: var(--font-size-base); flex-shrink: 0; }
.mi-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mi-type { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.mention-empty { margin: 8px 0 0; font-size: var(--font-size-sm); color: var(--text-tertiary); text-align: center; }
</style>

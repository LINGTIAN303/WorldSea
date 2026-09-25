<template>
  <div ref="containerRef" class="bc-container"></div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useBoardRenderer, type AnimationProvider } from '../composables/useBoardRenderer'
import { useBoardInteraction } from '../composables/useBoardInteraction'
import type { UnitRenderData, HighlightCell, AwarenessCell } from '../composables/boardDraw'

const props = defineProps<{
  gridType: 'square' | 'hex'
  gridWidth: number
  gridHeight: number
  terrain: string[][]
  units: UnitRenderData[]
  highlights: HighlightCell[]
  selectedCell: { x: number; y: number } | null
  awarenessCells: AwarenessCell[]
  awarenessMode: 'none' | 'influence' | 'threat' | 'supply'
  animationProvider?: AnimationProvider
}>()

const emit = defineEmits<{
  (e: 'cellClick', x: number, y: number, evt: MouseEvent): void
  (e: 'cellRightClick', x: number, y: number, evt: MouseEvent): void
  (e: 'cellHover', x: number | null, y: number | null): void
}>()

const containerRef = ref<HTMLElement | null>(null)

const hoveredCell = ref<{ x: number; y: number } | null>(null)

const renderData = computed(() => ({
  gridType: props.gridType,
  width: props.gridWidth,
  height: props.gridHeight,
  terrain: props.terrain,
  units: props.units,
  highlights: props.highlights,
  selectedCell: props.selectedCell,
  hoveredCell: hoveredCell.value,
  awarenessCells: props.awarenessCells,
  awarenessMode: props.awarenessMode,
}))

const renderer = useBoardRenderer(containerRef, renderData, props.animationProvider)

const interaction = useBoardInteraction(
  renderer.canvas,
  renderer.screenToCell,
  renderer.getCamera,
  renderer.setCamera,
  renderer.markDirty,
)

interaction.setCallbacks({
  onCellClick(x, y, evt) {
    emit('cellClick', x, y, evt)
  },
  onCellRightClick(x, y, evt) {
    emit('cellRightClick', x, y, evt)
  },
  onCellHover(x, y) {
    if (x < 0 || y === null || y < 0) {
      hoveredCell.value = null
      emit('cellHover', null, null)
    } else {
      hoveredCell.value = { x, y }
      emit('cellHover', x, y)
    }
    renderer.markDirty()
  },
  onZoom() {
    renderer.markDirty()
  },
  onPan() {
    renderer.markDirty()
  },
})

// 静态层：网格/地形变化 → 重建离屏静态缓存
watch(
  () => [props.gridType, props.gridWidth, props.gridHeight, props.terrain],
  () => {
    renderer.markStaticDirty()
  },
  { deep: true },
)

// 动态层：单位/高亮/选中/视野变化 → 仅重绘动态层
watch(
  () => [props.units, props.highlights, props.selectedCell, props.awarenessCells, props.awarenessMode],
  () => {
    renderer.markDirty()
  },
  { deep: true },
)

watch(
  () => [props.gridType, props.gridWidth, props.gridHeight],
  () => {
    renderer.fitBoard()
  },
)

onMounted(() => {
  renderer.init()
  interaction.bindEvents()
})

onBeforeUnmount(() => {
  interaction.unbindEvents()
  renderer.destroy()
})

defineExpose({
  fitBoard: renderer.fitBoard,
  getCamera: renderer.getCamera,
  setCamera: renderer.setCamera,
})
</script>

<style scoped>
.bc-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
</style>

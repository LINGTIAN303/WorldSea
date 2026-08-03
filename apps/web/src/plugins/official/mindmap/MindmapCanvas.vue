<template>
  <div ref="containerRef" class="mindmap-canvas-container">
    <!-- 选区矩形 overlay -->
    <div
      v-if="selectionRectOverlay"
      class="mm-selection-overlay"
      :style="{
        left: selectionRectOverlay.x + 'px',
        top: selectionRectOverlay.y + 'px',
        width: selectionRectOverlay.w + 'px',
        height: selectionRectOverlay.h + 'px',
      }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useTreeCanvas, type TreeCanvasCallbacks } from '@worldsmith/canvas-engine'
import type { CanvasNode, CanvasEdge } from './composables/canvasTypes'
import { invalidateThemeCache, drawGraph } from './composables/canvasDraw'

const containerRef = ref<HTMLDivElement | null>(null)

const props = defineProps<{
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  freehandDrawFn?: ((ctx: CanvasRenderingContext2D, camera: { x: number; y: number; k: number }) => void) | null
  selectionRectOverlay?: { x: number; y: number; w: number; h: number } | null
}>()

const emit = defineEmits<{
  (e: 'canvas-ready', el: HTMLCanvasElement | null): void
  (e: 'callbacks', cb: TreeCanvasCallbacks<CanvasNode>): void
}>()

const treeCanvas = useTreeCanvas<CanvasNode, CanvasEdge>({
  containerRef,
  nodeWidth: 160,
  nodeHeight: 60,
  drawNode: (_ctx, _node, _state, _nw, _nh) => {
    // 委托给现有的 drawGraph（以 _nodes/_edges 数组重绘）
    // drawGraph 内部自己做了遍历和选择逻辑，这里不重复。
    // useTreeCanvas 的 render() 会按顺序调 drawEdge → drawNode。
  },
  drawEdge: (_ctx, _edge, _source, _target) => {
    // useTreeCanvas 自动 resolve source/target via edge.sourceId
    // 但我们的 drawEdge 需要完整的 CanvasEdge
  },
  onBeforeDraw(_ctx, _w, _h, _camera) {
    // 背景 + 网格 + AI 虚线
  },
  onAfterDraw(_ctx, _w, _h, _camera) {
    // 自由绘图叠加
  },
})

// 重新绘制 — 使用完整的 drawGraph 函数（已有背景/网格/AI/边/节点/自由绘图逻辑）
function redrawAll() {
  const w = containerRef.value?.clientWidth || 800
  const h = containerRef.value?.clientHeight || 600
  const camera = treeCanvas.getCamera()
  const cam = { x: camera.x, y: camera.y, k: camera.k }

  // 创建离屏 canvas 绘制到 treeCanvas
  const offCtx = (treeCanvas.canvas.value as HTMLCanvasElement | null)?.getContext('2d')
  if (!offCtx) return

  drawGraph(
    offCtx, w, h,
    props.nodes, props.edges,
    cam,
    null, // hoveredNodeId
    null, // selectedNodeId
    props.freehandDrawFn,
  )
}

// 监听数据变化
watch(() => [props.nodes, props.edges], () => {
  treeCanvas.setData(props.nodes, props.edges)
}, { deep: true })

// 主题切换侦听
let themeObserver: MutationObserver | null = null
onMounted(() => {
  themeObserver = new MutationObserver(() => {
    invalidateThemeCache()
    redrawAll()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  treeCanvas.destroy()
})

defineExpose({
  canvas: treeCanvas.canvas,
  camera: treeCanvas.camera,
  fitView: (nodes: CanvasNode[]) => {
    if (nodes.length === 0) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodes) {
      if (n.x - n.width / 2 < minX) minX = n.x - n.width / 2
      if (n.x + n.width / 2 > maxX) maxX = n.x + n.width / 2
      if (n.y - n.height / 2 < minY) minY = n.y - n.height / 2
      if (n.y + n.height / 2 > maxY) maxY = n.y + n.height / 2
    }
    const rect = containerRef.value?.getBoundingClientRect()
    if (!rect) return
    const graphW = maxX - minX || 1
    const graphH = maxY - minY || 1
    const k = Math.min((rect.width - 160) / graphW, (rect.height - 160) / graphH, 2)
    treeCanvas.setCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, k: Math.max(0.1, k) })
  },
})
</script>

<style scoped>
.mindmap-canvas-container {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.mm-selection-overlay {
  position: absolute;
  border: 1px dashed var(--primary, #4a6cf7);
  background: rgba(74, 108, 247, 0.06);
  pointer-events: none;
  z-index: 10;
}
</style>

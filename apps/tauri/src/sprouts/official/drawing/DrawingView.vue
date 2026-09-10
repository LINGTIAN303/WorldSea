<template>
  <div class="drawing-view">
    <!-- 画板列表视图 -->
    <div v-if="!selectedDrawingId" class="dv-board">
      <!-- 新建画板按钮上移 R3 视图工具条（图标/标题 R3 面包屑已提供） -->
      <Teleport to="#view-toolbar-create">
        <CreateButton label="新建画板" @click="showCreateDialog = true" />
      </Teleport>
      <div v-if="loading" class="dv-board-loading"><WsSpinner /></div>
      <div v-else-if="drawingEntities.length === 0" class="dv-board-empty">
        <div class="dv-be-icon">🎨</div>
        <h3>还没有画板</h3>
        <p>创建一个画板，开始自由绘画</p>
        <button class="dv-btn dv-btn--primary" @click="showCreateDialog = true">创建第一个画板</button>
      </div>
      <div v-else class="dv-board-grid">
        <div v-for="d in drawingEntities" :key="d.id" class="dv-board-card" role="button" tabindex="0" :aria-label="`打开画板 ${d.name}`" @click="openDrawing(d.id)" @keydown.enter.prevent="openDrawing(d.id)" @keydown.space.prevent="openDrawing(d.id)">
          <div class="dv-card-thumb">
            <img v-if="d.properties.thumbnail" :src="d.properties.thumbnail" alt="" />
            <span v-else class="dv-card-placeholder">🎨</span>
          </div>
          <div class="dv-card-info">
            <span class="dv-card-name">{{ d.name }}</span>
            <span class="dv-card-size">{{ d.properties.width }}×{{ d.properties.height }}</span>
          </div>
          <button class="dv-card-delete" @click.stop="handleDelete(d.id)" title="删除">✕</button>
        </div>
      </div>

      <!-- 新建对话框 -->
      <div v-if="showCreateDialog" class="dv-overlay" @click.self="showCreateDialog = false">
        <div class="dv-dialog">
          <h3>新建画板</h3>
          <div class="dv-field">
            <label>名称</label>
            <input v-model="newName" class="dv-input" placeholder="例如：世界地图" />
          </div>
          <div class="dv-field-row">
            <div class="dv-field">
              <label>宽度</label>
              <input v-model.number="newWidth" type="number" class="dv-input" min="100" max="4096" />
            </div>
            <div class="dv-field">
              <label>高度</label>
              <input v-model.number="newHeight" type="number" class="dv-input" min="100" max="4096" />
            </div>
          </div>
          <div class="dv-field">
            <label>背景色</label>
            <input type="color" v-model="newBgColor" class="dv-color-lg" />
          </div>
          <div class="dv-dialog-actions">
            <button class="dv-btn" @click="showCreateDialog = false">取消</button>
            <button class="dv-btn dv-btn--primary" :disabled="!newName.trim()" @click="handleCreate">创建</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 画板编辑视图 -->
    <template v-else>
      <!-- 画布操作工具栏上移 R3 工具条动作区（#view-toolbar-actions）；次要操作收进折叠菜单 -->
      <Teleport to="#view-toolbar-actions">
        <div class="dv-toolbar">
          <button class="dv-btn dv-btn-back" @click="closeDrawing" title="返回画板列表" aria-label="返回画板列表"><WsIcon name="arrow-left" size="sm" /></button>

          <span class="dv-sep">|</span>

          <!-- 工具选择 -->
          <button
            v-for="tool in DRAWING_TOOLS" :key="tool.value"
            :class="['dv-tool-btn', { active: activeTool === tool.value }]"
            @click="activeTool = tool.value"
            :title="tool.label"
            :aria-label="tool.label"
          >
            <WsIcon :name="tool.icon" size="xs" />
          </button>

          <span class="dv-sep">|</span>
          <input type="color" v-model="strokeColor" class="dv-color" title="描边色" aria-label="描边色" />
          <input type="color" v-model="fillColor" class="dv-color" title="填充色" aria-label="填充色" />
          <input type="range" v-model="strokeWidth" min="1" max="30" class="dv-width" title="笔触粗细" aria-label="笔触粗细" />
          <span class="dv-label">{{ strokeWidth }}px</span>

          <span class="dv-sep">|</span>
          <button class="dv-btn" @click="undo" :disabled="history.length <= 1" title="撤销" data-ws-tip-keys="Ctrl+Z">撤销</button>
          <button class="dv-btn" @click="redo" :disabled="future.length === 0" title="重做" data-ws-tip-keys="Ctrl+Shift+Z">重做</button>

          <span class="dv-sep">|</span>
          <button class="dv-btn" @click="zoomIn" title="放大" data-ws-tip-keys="Ctrl+=">＋</button>
          <span class="dv-zoom">{{ Math.round(scale * 100) }}%</span>
          <button class="dv-btn" @click="zoomOut" title="缩小" data-ws-tip-keys="Ctrl+-">－</button>
          <button class="dv-btn" @click="fitView" title="适应视图" data-ws-tip-keys="Ctrl+0">适应</button>

          <!-- 折叠菜单：清空 / 导出 等次要操作 -->
          <ToolbarOverflow label="更多操作">
            <div class="to-group">操作</div>
            <button class="to-item to-item--danger" @click="clearActiveLayer"><WsIcon name="eraser" size="sm" /> 清空当前图层</button>
            <div class="to-group">导出</div>
            <button class="to-item" @click="exportImage"><WsIcon name="image" size="sm" /> 导出图片</button>
          </ToolbarOverflow>
        </div>
      </Teleport>

      <div class="dv-main">
        <!-- 画布区域 -->
        <div class="dv-viewport" :style="{ cursor: viewportCursor }"
          @wheel.prevent="onWheel"
          @mousedown="onMouseDown"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
          @mouseleave="onMouseUp"
          @touchstart.passive="onTouchStart"
          @touchmove.prevent="onTouchMove"
          @touchend="onTouchEnd"
          @contextmenu.prevent>
          <canvas ref="canvasRef" class="dv-canvas"
            :style="{ transform: `translate(${panX}px, ${panY}px) scale(${scale})`, transformOrigin: '0 0' }" />
        </div>

        <!-- 图层面板 -->
        <div class="dv-layers">
          <div class="dv-layers-header">
            <span>图层</span>
            <button class="dv-layer-add" @click="addLayer()" :disabled="layers.length >= MAX_LAYERS" title="添加图层">+</button>
          </div>
          <div class="dv-layers-list">
            <div
              v-for="(layer, idx) in reversedLayers" :key="layer.id"
              :class="['dv-layer-item', { active: activeLayerIndex === (layers.length - 1 - idx) }]"
              @click="activeLayerIndex = layers.length - 1 - idx"
            >
              <button class="dv-layer-vis" @click.stop="toggleLayerVisibility(layers.length - 1 - idx)" :title="layer.visible ? '隐藏' : '显示'">
                {{ layer.visible ? '👁' : '🚫' }}
              </button>
              <span class="dv-layer-name" v-if="renamingIdx !== idx" @dblclick="startRename(idx)">{{ layer.name }}</span>
              <input v-else class="dv-layer-rename" v-model="renameValue"
                @blur="finishRename(idx)" @keydown.enter="finishRename(idx)" ref="renameInput" />
              <span class="dv-layer-lock" @click.stop="toggleLayerLock(layers.length - 1 - idx)" :title="layer.locked ? '解锁' : '锁定'">
                {{ layer.locked ? '🔒' : '' }}
              </span>
              <button class="dv-layer-del" @click.stop="removeLayer(layers.length - 1 - idx)" :disabled="layers.length <= 1" title="删除">✕</button>
            </div>
          </div>
          <div class="dv-layers-footer">
            <label class="dv-opacity-label">透明度</label>
            <input type="range" :value="activeLayer?.opacity ?? 1" min="0" max="1" step="0.05"
              @input="setLayerOpacity(activeLayerIndex, Number(($event.target as HTMLInputElement).value))" class="dv-opacity-range" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useShortcuts, CreateButton } from '@worldsea/plugin-sdk'
import { useCanvas } from '@worldsea/ui-kit'
import { WsIcon } from '@worldsea/ui-kit'
import { WsSpinner } from '@worldsea/ui-kit'
import ToolbarOverflow from '@/components/ui/ToolbarOverflow.vue'
import { useDrawingPersistence } from './composables/useDrawingPersistence'
import { useDrawingLayers } from './composables/useDrawingLayers'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'
import { DRAWING_TOOLS, DEFAULT_BRUSH_SIZE, DEFAULT_COLOR, DEFAULT_BG_COLOR, MAX_LAYERS, MAX_HISTORY, AUTOSAVE_DELAY } from './drawingConfig'
import type { DrawingTool, DrawingLayer } from './types'

// ─── Canvas 基础 ────────────────────────────────────────────────
const {
  canvasRef,
  getCtx,
  getDrawPos,
  resizeCanvas,
  saveState: canvasSaveState,
  restoreState,
  panX,
  panY,
  scale,
  isPanning,
  spaceHeld,
  onWheel,
  zoomIn,
  zoomOut,
  fitView,
  setupKeyboard,
  startPan,
  doPan,
  endPan,
  saveAsImage,
} = useCanvas()

const { register, unregister } = useShortcuts()

// ─── 持久化 ──────────────────────────────────────────────────────
const {
  drawingEntities,
  selectedDrawingId,
  loadDrawings,
  createDrawing,
  selectDrawing,
  scheduleSave,
  deleteDrawing,
} = useDrawingPersistence()

// ─── 图层 ────────────────────────────────────────────────────────
const {
  layers,
  activeLayerIndex,
  activeLayer,
  addLayer,
  removeLayer,
  toggleLayerVisibility,
  toggleLayerLock,
  setLayerOpacity,
  renameLayer,
  compositeToMain,
  saveAllLayerData,
  restoreLayers,
  getActiveCtx,
  initLayers,
} = useDrawingLayers(canvasRef)

// ─── 状态 ────────────────────────────────────────────────────────
const loading = ref(true)
const showCreateDialog = ref(false)
const newName = ref('')
const newWidth = ref(800)
const newHeight = ref(500)
const newBgColor = ref(DEFAULT_BG_COLOR)

const activeTool = ref<DrawingTool>('brush')
const strokeColor = ref(DEFAULT_COLOR)
const fillColor = ref('#4a6cf7')
const strokeWidth = ref(DEFAULT_BRUSH_SIZE)
const history: ImageData[] = []
const future: ImageData[] = []
let drawing = false
let panStartX = 0
let panStartY = 0

// 形状绘制状态
let shapeStartX = 0
let shapeStartY = 0
let shapeSnapshot: ImageData | null = null

// 图层重命名
const renamingIdx = ref(-1)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement[]>([])

const currentDrawingName = computed(() => {
  if (!selectedDrawingId.value) return ''
  return drawingEntities.value.find(d => d.id === selectedDrawingId.value)?.name ?? ''
})

const reversedLayers = computed(() => [...layers.value].reverse())

const viewportCursor = computed(() => {
  if (isPanning.value) return 'grabbing'
  if (spaceHeld.value) return 'grab'
  if (activeTool.value === 'select') return 'default'
  return 'crosshair'
})

// ─── 画板列表操作 ────────────────────────────────────────────────
async function handleCreate() {
  if (!newName.value.trim()) return
  const entity = await createDrawing({
    name: newName.value.trim(),
    width: newWidth.value,
    height: newHeight.value,
    backgroundColor: newBgColor.value,
  })
  newName.value = ''
  newWidth.value = 800
  newHeight.value = 500
  newBgColor.value = DEFAULT_BG_COLOR
  showCreateDialog.value = false
  openDrawing(entity.id)
}

async function handleDelete(id: string) {
  await deleteDrawing(id)
}

async function openDrawing(id: string) {
  selectDrawing(id)
  const entity = drawingEntities.value.find(d => d.id === id)
  if (!entity) return

  await nextTick()
  resizeCanvas(entity.properties.width, entity.properties.height)

  // 恢复图层数据
  let savedLayers: DrawingLayer[] = []
  try {
    savedLayers = JSON.parse(entity.properties.layers || '[]')
  } catch { savedLayers = [] }

  if (savedLayers.length > 0) {
    restoreLayers(savedLayers, entity.properties.width, entity.properties.height)
  } else {
    // 无图层数据，初始化默认图层
    initLayers(entity.properties.width, entity.properties.height)
  }

  // 恢复视图状态
  panX.value = entity.properties.panX ?? 0
  panY.value = entity.properties.panY ?? 0
  scale.value = entity.properties.zoom ?? 1

  // 合成到主 canvas
  composite()
  localSaveState()
}

function closeDrawing() {
  // 保存当前画板数据
  if (selectedDrawingId.value) {
    flushCurrentDrawing()
  }
  selectDrawing(null)
}

// ─── 合成渲染 ────────────────────────────────────────────────────
function composite() {
  const c = getCtx()
  const canvas = canvasRef.value
  if (!c || !canvas) return

  // 先填充背景色
  const entity = drawingEntities.value.find(d => d.id === selectedDrawingId.value)
  const bgColor = entity?.properties?.backgroundColor ?? DEFAULT_BG_COLOR
  c.fillStyle = bgColor
  c.fillRect(0, 0, canvas.width, canvas.height)

  // 合成图层
  compositeToMain(c, canvas.width, canvas.height)
}

// ─── 撤销/重做 ──────────────────────────────────────────────────
function localSaveState() {
  const c = getCtx()
  const canvas = canvasRef.value
  if (!c || !canvas) return
  canvasSaveState(history, future, MAX_HISTORY)
}

function undo() {
  if (history.length <= 1) return
  future.push(history.pop()!)
  restoreState(history[history.length - 1])
}

function redo() {
  if (future.length === 0) return
  const data = future.pop()!
  history.push(data)
  restoreState(data)
}

function clearActiveLayer() {
  const ctx = getActiveCtx()
  const canvas = canvasRef.value
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  composite()
  localSaveState()
  autoSave()
}

// ─── 绘制逻辑 ────────────────────────────────────────────────────
function isShapeTool(): boolean {
  return ['line', 'rect', 'circle', 'arrow'].includes(activeTool.value)
}

function onMouseDown(e: MouseEvent) {
  if (spaceHeld.value || e.button === 1) {
    e.preventDefault()
    const { startX, startY } = startPan(e)
    panStartX = startX
    panStartY = startY
    return
  }
  if (e.button !== 0) return

  const pos = getDrawPos(e)

  if (activeTool.value === 'select') return

  drawing = true

  if (isShapeTool()) {
    shapeStartX = pos.x
    shapeStartY = pos.y
    // 保存当前活跃图层快照（用于实时预览）
    const c = getActiveCtx()
    const canvas = canvasRef.value
    if (c && canvas) {
      shapeSnapshot = c.getImageData(0, 0, canvas.width, canvas.height)
    }
    return
  }

  // 画笔/橡皮
  const c = getActiveCtx()
  if (!c) return

  if (activeTool.value === 'eraser') {
    c.globalCompositeOperation = 'destination-out'
  } else {
    c.globalCompositeOperation = 'source-over'
  }

  c.beginPath()
  c.moveTo(pos.x, pos.y)
  // 画一个点（处理单击不拖拽的情况）
  c.strokeStyle = strokeColor.value
  c.lineWidth = strokeWidth.value
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.lineTo(pos.x + 0.1, pos.y + 0.1)
  c.stroke()
  composite()
}

function onMouseMove(e: MouseEvent) {
  if (isPanning.value) {
    doPan(e, panStartX, panStartY)
    return
  }
  if (!drawing) return

  const pos = getDrawPos(e)

  if (isShapeTool()) {
    drawShapePreview(pos.x, pos.y)
    return
  }

  const c = getActiveCtx()
  if (!c) return

  c.strokeStyle = strokeColor.value
  c.lineWidth = strokeWidth.value
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.lineTo(pos.x, pos.y)
  c.stroke()
  composite()
}

function onMouseUp() {
  if (drawing) {
    drawing = false

    if (isShapeTool() && shapeSnapshot) {
      // 形状已在 preview 中绘制完成，清除快照
      shapeSnapshot = null
    }

    // 重置合成模式
    const c = getActiveCtx()
    if (c) c.globalCompositeOperation = 'source-over'

    composite()
    localSaveState()
    autoSave()
  }
  endPan()
}

function drawShapePreview(x: number, y: number) {
  const c = getActiveCtx()
  const canvas = canvasRef.value
  if (!c || !canvas || !shapeSnapshot) return

  // 恢复快照
  c.putImageData(shapeSnapshot, 0, 0)

  c.strokeStyle = strokeColor.value
  c.fillStyle = fillColor.value
  c.lineWidth = strokeWidth.value
  c.lineCap = 'round'
  c.lineJoin = 'round'

  const sx = shapeStartX
  const sy = shapeStartY

  switch (activeTool.value) {
    case 'line':
      c.beginPath()
      c.moveTo(sx, sy)
      c.lineTo(x, y)
      c.stroke()
      break
    case 'rect': {
      const w = x - sx
      const h = y - sy
      c.beginPath()
      c.rect(sx, sy, w, h)
      c.stroke()
      break
    }
    case 'circle': {
      const rx = Math.abs(x - sx) / 2
      const ry = Math.abs(y - sy) / 2
      const cx = (sx + x) / 2
      const cy = (sy + y) / 2
      c.beginPath()
      c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      c.stroke()
      break
    }
    case 'arrow': {
      c.beginPath()
      c.moveTo(sx, sy)
      c.lineTo(x, y)
      c.stroke()
      // 箭头头部
      const angle = Math.atan2(y - sy, x - sx)
      const headLen = Math.max(10, strokeWidth.value * 3)
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x - headLen * Math.cos(angle - Math.PI / 6), y - headLen * Math.sin(angle - Math.PI / 6))
      c.moveTo(x, y)
      c.lineTo(x - headLen * Math.cos(angle + Math.PI / 6), y - headLen * Math.sin(angle + Math.PI / 6))
      c.stroke()
      break
    }
  }

  composite()
}

// ─── 触摸支持 ────────────────────────────────────────────────────
let touchDrawing = false

function onTouchStart(e: TouchEvent) {
  if (activeTool.value === 'select') return
  touchDrawing = true
  const c = getActiveCtx()
  if (!c || !e.touches[0]) return
  const pos = getTouchPos(e)
  c.beginPath()
  c.moveTo(pos.x, pos.y)
}

function getTouchPos(e: TouchEvent) {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return {
    x: (e.touches[0].clientX - rect.left) * (canvas.width / rect.width),
    y: (e.touches[0].clientY - rect.top) * (canvas.height / rect.height),
  }
}

function onTouchMove(e: TouchEvent) {
  if (!touchDrawing) return
  const c = getActiveCtx()
  if (!c || !e.touches[0]) return
  const pos = getTouchPos(e)
  c.strokeStyle = strokeColor.value
  c.lineWidth = strokeWidth.value
  c.lineCap = 'round'
  c.lineTo(pos.x, pos.y)
  c.stroke()
  composite()
}

function onTouchEnd() {
  if (touchDrawing) {
    touchDrawing = false
    composite()
    localSaveState()
    autoSave()
  }
}

// ─── 导出 ────────────────────────────────────────────────────────
function exportImage() {
  composite()
  saveAsImage(`${currentDrawingName.value || 'drawing'}-${Date.now()}.png`)
}

// ─── 图层重命名 ──────────────────────────────────────────────────
function startRename(reversedIdx: number) {
  const realIdx = layers.value.length - 1 - reversedIdx
  renamingIdx.value = reversedIdx
  renameValue.value = layers.value[realIdx]?.name ?? ''
  nextTick(() => {
    renameInput.value?.[0]?.focus()
  })
}

function finishRename(reversedIdx: number) {
  const realIdx = layers.value.length - 1 - reversedIdx
  if (renameValue.value.trim()) {
    renameLayer(realIdx, renameValue.value.trim())
  }
  renamingIdx.value = -1
}

// ─── 自动保存 ────────────────────────────────────────────────────
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function autoSave() {
  if (!selectedDrawingId.value) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    flushCurrentDrawing()
  }, AUTOSAVE_DELAY)
}

function flushCurrentDrawing() {
  if (!selectedDrawingId.value) return
  saveAllLayerData()

  // 生成缩略图
  const canvas = canvasRef.value
  let thumbnail = ''
  if (canvas) {
    try {
      const thumbCanvas = document.createElement('canvas')
      thumbCanvas.width = 120
      thumbCanvas.height = 90
      const tctx = thumbCanvas.getContext('2d')
      if (tctx) {
        tctx.drawImage(canvas, 0, 0, 120, 90)
        thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.6)
      }
    } catch { /* ignore */ }
  }

  const entity = drawingEntities.value.find(d => d.id === selectedDrawingId.value)
  scheduleSave(selectedDrawingId.value, {
    layers: layers.value,
    activeLayerIndex: activeLayerIndex.value,
    zoom: scale.value,
    panX: panX.value,
    panY: panY.value,
    thumbnail,
    backgroundColor: entity?.properties?.backgroundColor ?? DEFAULT_BG_COLOR,
  })
}

// ─── Agent 桥接 ──────────────────────────────────────────────────
useAgentPluginBridge('drawing', async (event) => {
  const { action, payload } = event
  switch (action) {
    case 'create_drawing': {
      const entity = await createDrawing({
        name: (payload.name as string) || 'AI 创建的画板',
        width: (payload.width as number) || 800,
        height: (payload.height as number) || 500,
      })
      openDrawing(entity.id)
      break
    }
    case 'export_drawing': {
      const drawingId = (payload.drawingId as string) || selectedDrawingId.value
      if (drawingId) {
        exportImage()
      }
      break
    }
    case 'render_to_drawing': {
      const imageUrl = payload.imageUrl as string
      if (!imageUrl || !selectedDrawingId.value) break
      const c = getActiveCtx()
      const canvas = canvasRef.value
      if (!c || !canvas) break
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        c.drawImage(img, 0, 0, canvas.width, canvas.height)
        composite()
        localSaveState()
        autoSave()
      }
      img.src = imageUrl
      break
    }
    default:
      console.log(`[Agent→drawing] ${action}`, payload)
  }
})

// ─── 生命周期 ────────────────────────────────────────────────────
onMounted(async () => {
  await loadDrawings()
  loading.value = false

  setupKeyboard()
  register({ id: 'drawing.undo', keys: ['ctrl', 'z'], scope: 'view', description: '画板：撤销', handler: () => undo() })
  register({ id: 'drawing.redo', keys: ['ctrl', 'shift', 'z'], scope: 'view', description: '画板：重做', handler: () => redo() })
  register({ id: 'drawing.zoomIn', keys: ['ctrl', '='], scope: 'view', description: '画板：放大', handler: () => zoomIn() })
  register({ id: 'drawing.zoomOut', keys: ['ctrl', '-'], scope: 'view', description: '画板：缩小', handler: () => zoomOut() })
  register({ id: 'drawing.fitView', keys: ['ctrl', '0'], scope: 'view', description: '画板：适应视图', handler: () => fitView() })
})

onBeforeUnmount(() => {
  if (selectedDrawingId.value) {
    flushCurrentDrawing()
  }
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  unregister('drawing.undo')
  unregister('drawing.redo')
  unregister('drawing.zoomIn')
  unregister('drawing.zoomOut')
  unregister('drawing.fitView')
})

// 监听图层变化自动合成
watch([layers, activeLayerIndex], () => {
  if (selectedDrawingId.value) {
    composite()
  }
}, { deep: true })
</script>

<style scoped>
.drawing-view { display: flex; flex-direction: column; height: 100%; }

/* ─── 画板列表 ─── */
.dv-board { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 16px; overflow: auto; }
.dv-board-loading { display: flex; justify-content: center; padding: 48px; }
/* 上移 R3：包裹新建按钮，避免撑满 .vt-controls（flex:1） */
.dv-actions { display: flex; align-items: center; gap: 8px; }
.dv-board-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; opacity: 0.7; }
.dv-be-icon { font-size: 48px; }
.dv-board-empty h3 { margin: 0; font-size: var(--fs-lg); }
.dv-board-empty p { margin: 0; font-size: var(--fs-md); }
.dv-board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.dv-board-card { padding: 12px; border-radius: var(--radius-mid); border: 1px solid var(--color-border-subtle); background: var(--color-bg-surface); cursor: pointer; transition: border-color 0.15s; position: relative; }
.dv-board-card:hover { border-color: var(--color-primary); }
.dv-card-thumb { width: 100%; height: 100px; border-radius: var(--radius-xs); background: var(--color-bg-elevated); display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 8px; }
.dv-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
.dv-card-placeholder { font-size: 32px; }
.dv-card-info { display: flex; justify-content: space-between; align-items: center; }
.dv-card-name { font-size: var(--fs-md); font-weight: 500; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-card-size { font-size: var(--fs-xs); color: var(--color-text-tertiary); }
.dv-card-delete { position: absolute; top: 8px; right: 8px; width: 20px; height: 20px; border: none; background: rgba(0,0,0,0.3); color: #fff; border-radius: 50%; cursor: pointer; font-size: var(--fs-2xs); opacity: 0; transition: opacity 0.15s; display: flex; align-items: center; justify-content: center; }
.dv-board-card:hover .dv-card-delete { opacity: 1; }
.dv-card-delete:hover { background: var(--color-danger); }

/* ─── 对话框 ─── */
.dv-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dv-dialog { background: var(--color-bg-surface); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-2xl); padding: 24px; min-width: 360px; max-width: 500px; }
.dv-dialog h3 { margin: 0 0 16px; font-size: var(--fs-lg); color: var(--color-text-primary); }
.dv-field { margin-bottom: 12px; }
.dv-field label { display: block; font-size: var(--fs-md); margin-bottom: 4px; color: var(--color-text-secondary); }
.dv-input { width: 100%; padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--fs-md); box-sizing: border-box; }
.dv-input:focus { border-color: var(--color-primary); outline: none; }
.dv-field-row { display: flex; gap: 12px; }
.dv-field-row .dv-field { flex: 1; }
.dv-color-lg { width: 100%; height: 36px; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); cursor: pointer; background: var(--color-bg-elevated); }
.dv-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

/* ─── 工具栏（上移 R3：中和背景/边框/padding，单行适配） ─── */
.dv-toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 0; background: transparent; border: none;
  flex-shrink: 0; flex-wrap: nowrap; min-width: 0;
}
.dv-btn { padding: 4px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated); cursor: pointer; font-size: var(--font-size-sm, 13px); color: var(--color-text-primary); transition: background 0.15s; flex-shrink: 0; }
.dv-btn:hover { background: var(--color-bg-hover); }
.dv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dv-btn--primary { background: var(--color-primary, #4a6cf7); color: var(--on-accent); border-color: transparent; }
.dv-btn--primary:hover { opacity: 0.9; }
.dv-btn-danger { color: var(--color-danger, #f85149); }
.dv-btn-danger:hover { background: color-mix(in srgb, var(--color-danger, #f85149) 15%, transparent); }
.dv-btn-back { font-size: var(--font-size-xs, 12px); display: inline-flex; align-items: center; justify-content: center; }

.dv-tool-btn { width: 28px; height: 28px; border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary); flex-shrink: 0; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.dv-tool-btn:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.dv-tool-btn.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); border-color: var(--color-primary); }

.dv-color { width: 28px; height: 28px; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); cursor: pointer; background: var(--color-bg-elevated); flex-shrink: 0; }
.dv-width { width: 80px; flex-shrink: 0; }
.dv-label { font-size: var(--font-size-xs, 11px); color: var(--color-text-tertiary); min-width: 24px; flex-shrink: 0; }
.dv-sep { color: var(--color-border); font-size: var(--font-size-sm, 13px); margin: 0 2px; flex-shrink: 0; }
.dv-zoom { font-size: var(--font-size-xs, 11px); color: var(--color-text-tertiary); width: 40px; text-align: center; flex-shrink: 0; }

/* ─── 主区域 ─── */
.dv-main { display: flex; flex: 1; overflow: hidden; }
.dv-viewport { flex: 1; overflow: hidden; position: relative; background: var(--color-bg-elevated); }
.dv-canvas { display: block; }

/* ─── 图层面板 ─── */
.dv-layers { width: 180px; border-left: 1px solid var(--color-border-subtle); display: flex; flex-direction: column; background: var(--color-bg-surface); flex-shrink: 0; }
.dv-layers-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--color-border-subtle); font-size: var(--font-size-sm, 13px); font-weight: 600; color: var(--color-text-primary); }
.dv-layer-add { width: 20px; height: 20px; border: 1px dashed var(--color-border); border-radius: var(--radius-xs); background: transparent; color: var(--color-primary); cursor: pointer; font-size: var(--fs-base); display: flex; align-items: center; justify-content: center; }
.dv-layer-add:hover { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.dv-layer-add:disabled { opacity: 0.4; cursor: not-allowed; }
.dv-layers-list { flex: 1; overflow-y: auto; padding: 4px; }
.dv-layer-item { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-xs, 12px); color: var(--color-text-secondary); transition: background 0.1s; }
.dv-layer-item:hover { background: var(--color-bg-hover); }
.dv-layer-item.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.dv-layer-vis { border: none; background: none; cursor: pointer; font-size: var(--fs-sm); padding: 0; width: 18px; }
.dv-layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-layer-rename { flex: 1; padding: 1px 4px; border: 1px solid var(--color-primary); border-radius: var(--radius-2xs); background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-xs, 12px); outline: none; }
.dv-layer-lock { font-size: var(--fs-2xs); cursor: pointer; width: 16px; text-align: center; }
.dv-layer-del { border: none; background: none; cursor: pointer; font-size: var(--fs-2xs); color: var(--color-text-tertiary); padding: 0 2px; opacity: 0; transition: opacity 0.1s; }
.dv-layer-item:hover .dv-layer-del { opacity: 1; }
.dv-layer-del:hover { color: var(--color-danger); }
.dv-layer-del:disabled { opacity: 0.3; cursor: not-allowed; }
.dv-layers-footer { padding: 8px 10px; border-top: 1px solid var(--color-border-subtle); }
.dv-opacity-label { font-size: var(--font-size-xs, 11px); color: var(--color-text-tertiary); display: block; margin-bottom: 4px; }
.dv-opacity-range { width: 100%; }
</style>

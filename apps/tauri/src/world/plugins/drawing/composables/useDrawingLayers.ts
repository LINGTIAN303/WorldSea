import { ref, computed, type Ref } from 'vue'
import type { DrawingLayer } from '../types'
import { DEFAULT_LAYER_NAME, MAX_LAYERS } from '../drawingConfig'

export function useDrawingLayers(canvasRef: Ref<HTMLCanvasElement | undefined>) {
  // 图层列表
  const layers = ref<DrawingLayer[]>([])
  // 当前活跃图层索引
  const activeLayerIndex = ref(0)
  // 离屏 canvas 映射（layerId -> HTMLCanvasElement）
  const offscreenCanvases = new Map<string, HTMLCanvasElement>()

  // 当前活跃图层
  const activeLayer = computed(() => layers.value[activeLayerIndex.value] ?? null)

  // 获取或创建离屏 canvas
  function getOffscreenCanvas(layerId: string, width: number, height: number): HTMLCanvasElement {
    let oc = offscreenCanvases.get(layerId)
    if (!oc || oc.width !== width || oc.height !== height) {
      oc = document.createElement('canvas')
      oc.width = width
      oc.height = height
      offscreenCanvases.set(layerId, oc)
    }
    return oc
  }

  // 添加图层
  function addLayer(name?: string): void {
    if (layers.value.length >= MAX_LAYERS) return
    const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const canvas = canvasRef.value
    const w = canvas?.width ?? 800
    const h = canvas?.height ?? 500
    const layer: DrawingLayer = {
      id,
      name: name || `图层 ${layers.value.length + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      data: '',
    }
    // 初始化离屏 canvas（透明）
    getOffscreenCanvas(id, w, h)
    layers.value.push(layer)
    activeLayerIndex.value = layers.value.length - 1
  }

  // 删除图层
  function removeLayer(index: number): void {
    if (layers.value.length <= 1) return // 至少保留一个图层
    const layer = layers.value[index]
    if (!layer) return
    offscreenCanvases.delete(layer.id)
    layers.value.splice(index, 1)
    if (activeLayerIndex.value >= layers.value.length) {
      activeLayerIndex.value = layers.value.length - 1
    }
  }

  // 移动图层顺序
  function moveLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return
    const [moved] = layers.value.splice(fromIndex, 1)
    layers.value.splice(toIndex, 0, moved)
    // 更新 activeLayerIndex
    if (activeLayerIndex.value === fromIndex) {
      activeLayerIndex.value = toIndex
    } else if (fromIndex < activeLayerIndex.value && toIndex >= activeLayerIndex.value) {
      activeLayerIndex.value--
    } else if (fromIndex > activeLayerIndex.value && toIndex <= activeLayerIndex.value) {
      activeLayerIndex.value++
    }
  }

  // 切换图层可见性
  function toggleLayerVisibility(index: number): void {
    const layer = layers.value[index]
    if (layer) layer.visible = !layer.visible
  }

  // 切换图层锁定
  function toggleLayerLock(index: number): void {
    const layer = layers.value[index]
    if (layer) layer.locked = !layer.locked
  }

  // 设置图层透明度
  function setLayerOpacity(index: number, opacity: number): void {
    const layer = layers.value[index]
    if (layer) layer.opacity = Math.max(0, Math.min(1, opacity))
  }

  // 重命名图层
  function renameLayer(index: number, name: string): void {
    const layer = layers.value[index]
    if (layer) layer.name = name
  }

  // 合成所有可见图层到主 canvas
  function compositeToMain(mainCtx: CanvasRenderingContext2D, width: number, height: number): void {
    mainCtx.clearRect(0, 0, width, height)
    for (const layer of layers.value) {
      if (!layer.visible) continue
      const oc = offscreenCanvases.get(layer.id)
      if (!oc) continue
      mainCtx.globalAlpha = layer.opacity
      mainCtx.drawImage(oc, 0, 0)
    }
    mainCtx.globalAlpha = 1
  }

  // 保存当前活跃图层的离屏 canvas 数据到 layer.data
  function saveActiveLayerData(): void {
    const layer = activeLayer.value
    if (!layer) return
    const oc = offscreenCanvases.get(layer.id)
    if (oc) {
      layer.data = oc.toDataURL()
    }
  }

  // 保存所有图层数据
  function saveAllLayerData(): void {
    for (const layer of layers.value) {
      const oc = offscreenCanvases.get(layer.id)
      if (oc) {
        layer.data = oc.toDataURL()
      }
    }
  }

  // 从保存的数据恢复图层
  function restoreLayers(savedLayers: DrawingLayer[], width: number, height: number): void {
    layers.value = savedLayers
    offscreenCanvases.clear()
    for (const layer of savedLayers) {
      const oc = getOffscreenCanvas(layer.id, width, height)
      if (layer.data) {
        const img = new Image()
        img.onload = () => {
          const octx = oc.getContext('2d')
          if (octx) octx.drawImage(img, 0, 0)
        }
        img.src = layer.data
      }
    }
    if (activeLayerIndex.value >= layers.value.length) {
      activeLayerIndex.value = Math.max(0, layers.value.length - 1)
    }
  }

  // 获取活跃图层的 2d context（用于绘制）
  function getActiveCtx(): CanvasRenderingContext2D | null {
    const layer = activeLayer.value
    if (!layer || layer.locked) return null
    const canvas = canvasRef.value
    const w = canvas?.width ?? 800
    const h = canvas?.height ?? 500
    const oc = getOffscreenCanvas(layer.id, w, h)
    return oc.getContext('2d')
  }

  // 初始化（创建默认图层）
  function initLayers(width: number, height: number): void {
    layers.value = []
    offscreenCanvases.clear()
    addLayer(DEFAULT_LAYER_NAME)
    // 默认图层填充白色
    const firstLayer = layers.value[0]
    if (firstLayer) {
      const oc = getOffscreenCanvas(firstLayer.id, width, height)
      const ctx = oc.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
      }
    }
  }

  return {
    layers,
    activeLayerIndex,
    activeLayer,
    addLayer,
    removeLayer,
    moveLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    setLayerOpacity,
    renameLayer,
    compositeToMain,
    saveActiveLayerData,
    saveAllLayerData,
    restoreLayers,
    getActiveCtx,
    initLayers,
    getOffscreenCanvas,
  }
}

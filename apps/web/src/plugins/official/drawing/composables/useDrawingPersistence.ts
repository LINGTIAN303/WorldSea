import { ref } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import type { DrawingLayer } from '../types'
import { DEFAULT_BG_COLOR, AUTOSAVE_DELAY } from '../drawingConfig'

export interface DrawingEntity extends Entity {
  type: 'drawing'
  properties: {
    canvasData: string
    width: number
    height: number
    backgroundColor: string
    layers: string  // JSON serialized DrawingLayer[]
    activeLayerIndex: number
    zoom: number
    panX: number
    panY: number
    thumbnail: string
  }
}

export function useDrawingPersistence() {
  const entityStore = useEntityStore()
  const selectedDrawingId = ref<string | null>(null)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // 所有画板实体
  const drawingEntities = ref<DrawingEntity[]>([])

  // 当前选中的画板
  const selectedDrawing = ref<DrawingEntity | null>(null)

  // 加载所有画板
  async function loadDrawings(): Promise<void> {
    await entityStore.loadByType('drawing')
    drawingEntities.value = (entityStore.entities ?? [])
      .filter((e): e is DrawingEntity => e.type === 'drawing')
  }

  // 创建新画板
  async function createDrawing(params: {
    name: string
    width?: number
    height?: number
    backgroundColor?: string
  }): Promise<DrawingEntity> {
    const now = new Date().toISOString()
    const id = `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const entity: DrawingEntity = {
      id,
      type: 'drawing',
      name: params.name,
      description: '',
      properties: {
        canvasData: '',
        width: params.width ?? 800,
        height: params.height ?? 500,
        backgroundColor: params.backgroundColor ?? DEFAULT_BG_COLOR,
        layers: '[]',
        activeLayerIndex: 0,
        zoom: 1,
        panX: 0,
        panY: 0,
        thumbnail: '',
      },
      tags: [],
      createdAt: now,
      updatedAt: now,
    }
    await entityStore.add(entity)
    await loadDrawings()
    return entity
  }

  // 选择画板
  function selectDrawing(id: string | null): void {
    selectedDrawingId.value = id
    selectedDrawing.value = id
      ? drawingEntities.value.find(d => d.id === id) ?? null
      : null
  }

  // 保存画板数据（防抖）
  function scheduleSave(
    drawingId: string,
    data: {
      layers: DrawingLayer[]
      activeLayerIndex: number
      zoom: number
      panX: number
      panY: number
      thumbnail: string
      backgroundColor: string
    },
  ): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      await saveDrawing(drawingId, data)
    }, AUTOSAVE_DELAY)
  }

  // 立即保存
  async function saveDrawing(
    drawingId: string,
    data: {
      layers: DrawingLayer[]
      activeLayerIndex: number
      zoom: number
      panX: number
      panY: number
      thumbnail: string
      backgroundColor: string
    },
  ): Promise<void> {
    const entity = drawingEntities.value.find(d => d.id === drawingId)
    if (!entity) return

    await entityStore.update(drawingId, {
      properties: {
        ...entity.properties,
        layers: JSON.stringify(data.layers),
        activeLayerIndex: data.activeLayerIndex,
        zoom: data.zoom,
        panX: data.panX,
        panY: data.panY,
        thumbnail: data.thumbnail,
        backgroundColor: data.backgroundColor,
      },
      updatedAt: new Date().toISOString(),
    })
  }

  // 删除画板
  async function deleteDrawing(id: string): Promise<void> {
    await entityStore.remove(id)
    if (selectedDrawingId.value === id) {
      selectedDrawingId.value = null
      selectedDrawing.value = null
    }
    await loadDrawings()
  }

  // 重命名画板
  async function renameDrawing(id: string, name: string): Promise<void> {
    await entityStore.update(id, { name, updatedAt: new Date().toISOString() })
    await loadDrawings()
  }

  // 刷新选中画板数据
  function refreshSelected(): void {
    if (selectedDrawingId.value) {
      selectedDrawing.value = drawingEntities.value.find(d => d.id === selectedDrawingId.value) ?? null
    }
  }

  return {
    drawingEntities,
    selectedDrawingId,
    selectedDrawing,
    loadDrawings,
    createDrawing,
    selectDrawing,
    scheduleSave,
    saveDrawing,
    deleteDrawing,
    renameDrawing,
    refreshSelected,
  }
}

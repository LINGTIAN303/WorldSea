// 区域地图的鼠标交互：按下 / 移动 / 抬起 / 滚轮 / 双击。
// 拖拽状态（平移、拖点、拖顶点、拖节点）都是模块内闭包变量——不对外暴露，避免外部误改。
// 绘制与擦除各自的分支委托给 useDrawing / useBorderErase 提供的回调。
import type { Ref } from 'vue'
import type { HitTestResult, MapMode, Point, RegionEntity, TooltipState } from './types'

interface InteractionDeps {
  canvasRef: Ref<HTMLCanvasElement | undefined>
  mode: Ref<MapMode>
  scale: Ref<number>
  tooltip: Ref<TooltipState>
  ctxMenu: Ref<{ show: boolean }>
  selectedRegionId: Ref<string | null>
  eraseMode: Ref<string | null>
  eraseDraggingIdx: Ref<number>
  eraseBorderVertices: Ref<Point[]>
  eraseBorderFixedIndices: Ref<number[]>
  eraseRedrawPath: Ref<Point[]>
  isDrawing: Ref<boolean>
  adjoinSelectMode: Ref<boolean>
  adjoinSourceRegion: Ref<RegionEntity | null>
  getPanX: () => number
  getPanY: () => number
  setPan: (x: number, y: number) => void
  hitTest: (mx: number, my: number) => HitTestResult | null
  toWorldCoords: (mx: number, my: number) => Point
  getRegions: () => RegionEntity[]
  getTerritory: (r: RegionEntity) => Point[]
  getEntity: (id: string) => { properties?: Record<string, unknown> } | undefined
  updateEntity: (id: string, patch: { properties: Record<string, unknown> }) => void
  addVertex: (region: RegionEntity, edgeIdx: number, pos: Point) => void
  toggleAdjoinTarget: (region: RegionEntity) => void
  handleDrawMouseDown: (wp: Point) => void
  handleDrawMouseMove: (wp: Point) => void
  handleDrawMouseUp: () => void
  finishRedraw: () => void
  scheduleDraw: () => void
  rectWidth: () => number
  rectHeight: () => number
}

export function useMapInteraction(deps: InteractionDeps) {
  const {
    canvasRef, mode, scale, tooltip, ctxMenu, selectedRegionId,
    eraseMode, eraseDraggingIdx, eraseBorderVertices, eraseBorderFixedIndices, eraseRedrawPath,
    isDrawing, adjoinSelectMode, adjoinSourceRegion,
    getPanX, getPanY, setPan, hitTest, toWorldCoords,
    getRegions, getTerritory, getEntity, updateEntity, addVertex, toggleAdjoinTarget,
    handleDrawMouseDown, handleDrawMouseMove, handleDrawMouseUp, finishRedraw,
    scheduleDraw, rectWidth, rectHeight,
  } = deps

  let dragging = false
  let dragStartX = 0, dragStartY = 0
  let dragNode: string | null = null
  let dragNodeStartX = 0, dragNodeStartY = 0
  let dragRegionId: string | null = null
  let draggingVertex = -1

  function localXY(e: MouseEvent): { mx: number; my: number } | null {
    const canvas = canvasRef.value
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top }
  }

  function onMouseDown(e: MouseEvent) {
    const pos = localXY(e)
    if (!pos) return
    const { mx, my } = pos

    if (mode.value === 'draw') {
      const wp = toWorldCoords(mx, my)

      // 偏移模式：拖拽节点
      if (eraseMode.value === 'offset') {
        for (let i = 0; i < eraseBorderVertices.value.length; i++) {
          const p = eraseBorderVertices.value[i]
          const dx = wp.x - p.x, dy = wp.y - p.y
          if (dx * dx + dy * dy < 64) {
            eraseDraggingIdx.value = i
            dragging = true
            scheduleDraw()
            return
          }
        }
        return
      }

      // 重划模式
      if (eraseMode.value === 'redraw') {
        if (!isDrawing.value) {
          isDrawing.value = true
          eraseRedrawPath.value = [wp]
        } else {
          eraseRedrawPath.value.push(wp)
        }
        dragging = isDrawing.value
        scheduleDraw()
        return
      }

      // 普通绘制模式
      handleDrawMouseDown(wp)
      dragging = isDrawing.value
      return
    }

    const hit = hitTest(mx, my)
    if (mode.value === 'edit' && adjoinSelectMode.value) {
      if (hit && hit.region.id !== adjoinSourceRegion.value?.id) {
        toggleAdjoinTarget(hit.region)
      }
      return
    }
    if (mode.value === 'edit' && hit) {
      dragRegionId = hit.region.id
      if (hit.vertexIdx >= 0) {
        draggingVertex = hit.vertexIdx
        dragStartX = mx
        dragStartY = my
        dragging = true
      } else if (hit.vertexIdx === -2 && hit.edgeIdx !== undefined && hit.edgeIdx >= 0) {
        // 点击边 - 添加顶点
        addVertex(hit.region, hit.edgeIdx, toWorldCoords(mx, my))
      } else {
        dragNode = hit.region.id
        dragNodeStartX = mx
        dragNodeStartY = my
        dragging = true
        selectedRegionId.value = hit.region.id
      }
    } else if (mode.value === 'edit' && !hit) {
      selectedRegionId.value = null
    } else if (mode.value === 'pan') {
      dragNode = null; dragRegionId = null; draggingVertex = -1
      dragging = true
      dragStartX = mx - getPanX()
      dragStartY = my - getPanY()
    }
  }

  function onMouseMove(e: MouseEvent) {
    const pos = localXY(e)
    if (!pos) return
    const { mx, my } = pos

    // 偏移模式：拖拽节点
    if (mode.value === 'draw' && eraseMode.value === 'offset' && eraseDraggingIdx.value >= 0 && dragging) {
      const wp = toWorldCoords(mx, my)
      if (!eraseBorderFixedIndices.value.includes(eraseDraggingIdx.value)) {
        eraseBorderVertices.value[eraseDraggingIdx.value] = { x: Math.round(wp.x), y: Math.round(wp.y) }
      }
      scheduleDraw()
      return
    }

    // 重划模式：拖拽绘制
    if (mode.value === 'draw' && eraseMode.value === 'redraw' && isDrawing.value && dragging) {
      const wp = toWorldCoords(mx, my)
      const last = eraseRedrawPath.value[eraseRedrawPath.value.length - 1]
      if (Math.abs(wp.x - last.x) > 2 || Math.abs(wp.y - last.y) > 2) {
        eraseRedrawPath.value.push(wp)
      }
      scheduleDraw()
      return
    }

    // 普通绘制模式：委托给 composable
    if (mode.value === 'draw' && isDrawing.value && dragging) {
      handleDrawMouseMove(toWorldCoords(mx, my))
      return
    }

    if (!dragging) {
      const hit = mode.value !== 'draw' ? hitTest(mx, my) : null
      if (!hit && e.button === 0) ctxMenu.value.show = false
      const canvas = canvasRef.value
      if (canvas) canvas.style.cursor = hit && mode.value === 'edit' ? 'pointer' : mode.value === 'draw' ? 'crosshair' : 'grab'
      if (hit) {
        const r = hit.region
        tooltip.value = { show: true, x: e.clientX + 12, y: e.clientY + 12, name: r.name, type: r.properties?.regionType }
      } else {
        tooltip.value.show = false
      }
      return
    }

    if (draggingVertex >= 0 && dragRegionId) {
      const ent = getEntity(dragRegionId)
      if (ent) {
        const worldX = (mx - getPanX()) / scale.value
        const worldY = (my - getPanY()) / scale.value
        // 用 getTerritory() 以便自动生成的六边形顶点也可拖动
        const currentPts = getTerritory(ent as RegionEntity)
        const territory = currentPts.map((p: Point, i: number) =>
          i === draggingVertex ? { x: Math.round(worldX), y: Math.round(worldY) } : { x: p.x, y: p.y }
        )
        updateEntity(dragRegionId, { properties: { ...(ent.properties || {}), territory } })
      }
    } else if (dragNode) {
      const dx = mx - dragNodeStartX, dy = my - dragNodeStartY
      const wdx = dx / scale.value, wdy = dy / scale.value
      const ent = getEntity(dragNode)
      if (ent) {
        // 同时平移 territory 点（若存在自定义 territory）
        const props = ent.properties || {}
        const shifted = Array.isArray(props.territory) ? (props.territory as Point[]).map((p) => ({
          x: Math.round(p.x + wdx),
          y: Math.round(p.y + wdy),
        })) : undefined
        updateEntity(dragNode, {
          properties: {
            ...props,
            mapX: Math.round((Number(props.mapX) || 0) + wdx),
            mapY: Math.round((Number(props.mapY) || 0) + wdy),
            ...(shifted ? { territory: shifted } : {}),
          }
        })
      }
      dragNodeStartX = mx
      dragNodeStartY = my
    } else {
      setPan(mx - dragStartX, my - dragStartY)
    }
    scheduleDraw()
  }

  function onMouseUp() {
    // 偏移模式：结束拖拽节点
    if (mode.value === 'draw' && eraseMode.value === 'offset') {
      eraseDraggingIdx.value = -1
      dragging = false
      scheduleDraw()
      return
    }

    // 重划模式：结束一段绘制
    if (mode.value === 'draw' && eraseMode.value === 'redraw' && isDrawing.value) {
      isDrawing.value = false
      dragging = false
      finishRedraw()
      scheduleDraw()
      return
    }

    // 普通绘制模式
    if (mode.value === 'draw' && isDrawing.value) {
      handleDrawMouseUp()
      dragging = false
      return
    }
    dragging = false; dragNode = null; dragRegionId = null; draggingVertex = -1
    scheduleDraw()
  }

  function onWheel(e: WheelEvent) {
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    scale.value = Math.min(5, Math.max(0.1, scale.value * delta))
    scheduleDraw()
  }

  function onDblClick(e: MouseEvent) {
    // 偏移模式：双击边中点插入新节点
    if (mode.value === 'draw' && eraseMode.value === 'offset') {
      const pos = localXY(e)
      if (!pos) return
      const wp = toWorldCoords(pos.mx, pos.my)
      let bestDist = Infinity, bestIdx = -1
      for (let i = 0; i < eraseBorderVertices.value.length - 1; i++) {
        const a = eraseBorderVertices.value[i], b = eraseBorderVertices.value[i + 1]
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2
        const d = Math.sqrt((wp.x - midX) ** 2 + (wp.y - midY) ** 2)
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      if (bestIdx >= 0 && bestDist < 30) {
        eraseBorderVertices.value.splice(bestIdx + 1, 0, { x: Math.round(wp.x), y: Math.round(wp.y) })
        eraseBorderFixedIndices.value = eraseBorderFixedIndices.value.map(idx => idx > bestIdx ? idx + 1 : idx)
        scheduleDraw()
      }
    }
  }

  function zoomIn() { scale.value = Math.min(5, scale.value * 1.3); scheduleDraw() }
  function zoomOut() { scale.value = Math.max(0.1, scale.value * 0.7); scheduleDraw() }

  function fitAll() {
    const regions = getRegions()
    if (!regions.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const r of regions) {
      const x = Number(r.properties?.mapX) || 0
      const y = Number(r.properties?.mapY) || 0
      if (x === 0 && y === 0) continue
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    if (minX === Infinity) return
    const w = maxX - minX + 100, h = maxY - minY + 100
    const sx = rectWidth() / w, sy = rectHeight() / h
    scale.value = Math.min(sx, sy) * 0.85
    setPan(-minX * scale.value + 50, -minY * scale.value + 50)
    scheduleDraw()
  }

  return { onMouseDown, onMouseMove, onMouseUp, onWheel, onDblClick, zoomIn, zoomOut, fitAll }
}

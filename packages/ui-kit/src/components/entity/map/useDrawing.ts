/**
 * 绘制模式 composable
 *
 * 负责：
 * - 普通绘制模式（手绘疆域边界 → 创建新区域）
 * - 边境线模式（按 Alt 触发，分割/增补现有区域）
 *
 * 鼠标坐标相关的命中检测由主文件调用 handleDrawMouseDown/Move/Up 完成。
 * 本 composable 内部管理 drawingPath 与 isDrawing 状态。
 */

import { ref } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { useDialog } from '@worldsmith/ui-kit'
import { useDuplicateNameCheck } from '@worldsmith/plugin-sdk'
import { useUndoRedo } from '@worldsmith/ui-kit'
import { toastWarn } from '../../../composables/useToast'
import {
  bridgeChaikinSmooth,
  bridgeSimplifyPoints,
  bridgePointInPolygon,
  bridgePolygonSplit,
  bridgePolygonAugment,
} from '@worldsmith/canvas-engine/geometry'
import type { Point, RegionEntity, BorderlineMode } from './types'
import { pointInPolygon, lineIntersectsPolygonEdges } from './geometry'

interface UseDrawingOptions {
  /** 获取所有区域列表 */
  getRegions: () => RegionEntity[]
  /** 获取区域的疆域多边形 */
  getTerritory: (r: RegionEntity) => Point[]
  /** 触发重绘 */
  scheduleDraw: () => void
  /** 隐藏 tooltip（开始绘制时调用） */
  hideTooltip: () => void
}

export function useDrawing(options: UseDrawingOptions) {
  const { getRegions, getTerritory, scheduleDraw, hideTooltip } = options

  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const dialog = useDialog()
  const { checkAndConfirmName } = useDuplicateNameCheck()
  const { beginTransaction, commitTransaction } = useUndoRedo()

  // 当前正在绘制的折线
  const drawingPath = ref<Point[]>([])
  // 是否正在绘制（鼠标按下期间）
  const isDrawing = ref(false)
  // 是否处于边境线模式（按住 Alt）
  const borderlineActive = ref(false)
  // 边境线模式子类型：split=分割 / augment=增补
  const borderlineMode = ref<BorderlineMode>(null)

  /** 进入绘制模式 */
  function startDrawMode(): void {
    drawingPath.value = []
    isDrawing.value = false
    hideTooltip()
  }

  /**
   * 绘制模式下的鼠标按下处理
   * @returns true 表示已处理该事件
   */
  function handleDrawMouseDown(wp: Point): boolean {
    if (!isDrawing.value) {
      isDrawing.value = true
      drawingPath.value = [wp]
      // 进入边境线模式时判定 split / augment
      if (borderlineActive.value) {
        const regions = getRegions()
        for (const r of regions) {
          const pts = getTerritory(r)
          if (pointInPolygon(wp, pts)) {
            borderlineMode.value = 'split'
            break
          }
        }
        if (!borderlineMode.value) {
          for (const r of regions) {
            const pts = getTerritory(r)
            if (lineIntersectsPolygonEdges([wp, wp], pts)) {
              borderlineMode.value = 'augment'
              break
            }
          }
        }
        if (!borderlineMode.value) {
          borderlineMode.value = 'augment'
        }
      }
    } else {
      drawingPath.value.push(wp)
    }
    scheduleDraw()
    return true
  }

  /**
   * 绘制模式下的鼠标移动处理
   * @returns true 表示已处理该事件
   */
  function handleDrawMouseMove(wp: Point): boolean {
    if (!isDrawing.value) return false
    // 距离上一个点足够远才追加（避免点过密）
    const last = drawingPath.value[drawingPath.value.length - 1]
    if (Math.abs(wp.x - last.x) > 2 || Math.abs(wp.y - last.y) > 2) {
      drawingPath.value.push(wp)
    }
    scheduleDraw()
    return true
  }

  /**
   * 绘制模式下的鼠标抬起处理
   * @returns true 表示已处理该事件
   */
  function handleDrawMouseUp(): boolean {
    if (!isDrawing.value) return false
    isDrawing.value = false
    if (borderlineActive.value || borderlineMode.value) {
      finishBorderline()
    } else {
      finishDrawing()
    }
    scheduleDraw()
    return true
  }

  /** 完成普通绘制：平滑、简化、创建新区域 */
  async function finishDrawing(): Promise<void> {
    if (drawingPath.value.length < 5) {
      drawingPath.value = []
      return
    }

    const smooth = await bridgeChaikinSmooth(drawingPath.value, 2)
    const simplified = await bridgeSimplifyPoints(smooth, 3)

    if (simplified.length < 3) {
      drawingPath.value = []
      return
    }

    const name = await dialog.prompt('输入区域名称:', '新建区域', '')
    if (!name) { drawingPath.value = []; scheduleDraw(); return }

    const checkedName = await checkAndConfirmName(name, undefined, 'region')
    if (!checkedName) { drawingPath.value = []; scheduleDraw(); return }

    let cx = 0, cy = 0
    for (const p of simplified) { cx += p.x; cy += p.y }
    cx = Math.round(cx / simplified.length)
    cy = Math.round(cy / simplified.length)

    const now = new Date().toISOString()
    entityStore.add({
      id: 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: 'region',
      name: checkedName,
      description: '',
      tags: [],
      properties: {
        regionType: '区域',
        mapX: cx,
        mapY: cy,
        territory: simplified,
      },
      createdAt: now,
      updatedAt: now,
    })

    drawingPath.value = []
    scheduleDraw()
  }

  /** 完成边境线绘制：判定分割或增补并执行 */
  async function finishBorderline(): Promise<void> {
    if (drawingPath.value.length < 2) {
      drawingPath.value = []
      borderlineMode.value = null
      return
    }

    const smooth = await bridgeChaikinSmooth(drawingPath.value, 1)
    const simplified = await bridgeSimplifyPoints(smooth, 3)
    if (simplified.length < 2) {
      drawingPath.value = []
      borderlineMode.value = null
      return
    }

    const regions = getRegions()
    let targetRegion: RegionEntity | null = null
    let isSplit = false

    const startPoint = simplified[0]
    for (const r of regions) {
      const pts = getTerritory(r)
      if (await bridgePointInPolygon(startPoint, pts)) {
        targetRegion = r
        isSplit = true
        break
      }
    }

    if (!targetRegion) {
      for (const r of regions) {
        const pts = getTerritory(r)
        if (lineIntersectsPolygonEdges(simplified, pts)) {
          targetRegion = r
          isSplit = false
          break
        }
      }
    }

    if (!targetRegion) {
      drawingPath.value = []
      borderlineMode.value = null
      scheduleDraw()
      return
    }

    if (isSplit) {
      await performSplit(targetRegion, simplified)
    } else {
      await performAugment(targetRegion, simplified)
    }

    drawingPath.value = []
    borderlineMode.value = null
    scheduleDraw()
  }

  /** 分割区域：用一条贯穿的线把多边形切成两块 */
  async function performSplit(
    originalRegion: RegionEntity,
    cuttingLine: Point[]
  ): Promise<void> {
    const polygon = getTerritory(originalRegion)

    const subPolygons = await bridgePolygonSplit(polygon, cuttingLine)
    if (subPolygons.length < 2) {
      toastWarn('分割失败，请确保边境线贯穿整个区域')
      return
    }

    const now = new Date().toISOString()
    const originalProps = originalRegion.properties || {}

    beginTransaction()

    for (let i = 0; i < subPolygons.length; i++) {
      const subPts = subPolygons[i]
      let cx = 0, cy = 0
      for (const p of subPts) { cx += p.x; cy += p.y }
      cx = Math.round(cx / subPts.length)
      cy = Math.round(cy / subPts.length)

      const baseName = i === 0 ? `${originalRegion.name}（东）` : `${originalRegion.name}（西）`
      const checkedName = await checkAndConfirmName(baseName, originalRegion.id, 'region')
      if (!checkedName) continue

      entityStore.add({
        id: 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'region',
        name: checkedName,
        description: originalRegion.description || '',
        tags: [...(originalRegion.tags || []), '待更改范围'],
        properties: {
          ...originalProps,
          mapX: cx,
          mapY: cy,
          territory: subPts,
        },
        createdAt: now,
        updatedAt: now,
      })
    }

    await entityStore.remove(originalRegion.id)

    commitTransaction()
  }

  /** 增补区域：用一条线扩展原区域，新建一个增补区域并建立 borders 关系 */
  async function performAugment(
    originalRegion: RegionEntity,
    addingLine: Point[]
  ): Promise<void> {
    const polygon = getTerritory(originalRegion)

    const augmentedPolygon = await bridgePolygonAugment(polygon, addingLine)
    if (augmentedPolygon.length < 3) {
      toastWarn('增补区域无效')
      return
    }

    let cx = 0, cy = 0
    for (const p of augmentedPolygon) { cx += p.x; cy += p.y }
    cx = Math.round(cx / augmentedPolygon.length)
    cy = Math.round(cy / augmentedPolygon.length)

    const name = await dialog.prompt('输入增补区域名称:', '新建增补区域', '')
    if (!name) return
    const checkedName = await checkAndConfirmName(name, undefined, 'region')
    if (!checkedName) return

    const now = new Date().toISOString()
    const originalProps = originalRegion.properties || {}

    beginTransaction()

    const newId = 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    entityStore.add({
      id: newId,
      type: 'region',
      name: checkedName,
      description: '',
      tags: ['待更改范围'],
      properties: {
        ...originalProps,
        regionType: '区域',
        mapX: cx,
        mapY: cy,
        territory: augmentedPolygon,
      },
      createdAt: now,
      updatedAt: now,
    })

    relationStore.add({
      id: 'rel-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: 'borders',
      sourceId: originalRegion.id,
      targetId: newId,
      label: '',
      properties: {},
      createdAt: now,
      updatedAt: now,
    })

    commitTransaction()
  }

  return {
    drawingPath,
    isDrawing,
    borderlineActive,
    borderlineMode,
    startDrawMode,
    handleDrawMouseDown,
    handleDrawMouseMove,
    handleDrawMouseUp,
    finishDrawing,
    finishBorderline,
  }
}

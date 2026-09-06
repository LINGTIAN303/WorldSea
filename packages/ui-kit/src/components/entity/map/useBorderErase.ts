/** 抹除/移动边境线 composable（融合/移线 + 偏移/重划模式），详细见 docs/details/注释/packages/ui-kit/components/entity/map/useBorderErase.md */

import { ref, onBeforeUnmount } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { useDialog, useConfirm, useUndoRedo, useShortcuts } from '@worldsmith/ui-kit'
import { toastWarn } from '../../../composables/useToast'
import {
  bridgeChaikinSmooth,
  bridgeSimplifyPoints,
  bridgeMergePolygons,
} from '@worldsmith/canvas-engine/geometry'
import type { Point, RegionEntity, EraseCtxMenuState, SharedEdge } from './types'
import { findSharedEdgeBetween, replaceEdgeWithLine } from './geometry'

interface UseBorderEraseOptions {
  /** 获取所有区域列表 */
  getRegions: () => RegionEntity[]
  /** 获取区域的疆域多边形 */
  getTerritory: (r: RegionEntity) => Point[]
  /** 触发重绘 */
  scheduleDraw: () => void
}

export function useBorderErase(options: UseBorderEraseOptions) {
  const { getTerritory, scheduleDraw } = options

  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const dialog = useDialog()
  const { confirm } = useConfirm()
  const { beginTransaction, commitTransaction } = useUndoRedo()

  // 抹除模式：null / 'offset' / 'redraw'
  const eraseMode = ref<'offset' | 'redraw' | null>(null)
  // 偏移模式下的边境线节点
  const eraseBorderVertices = ref<Point[]>([])
  // 偏移模式下固定的节点索引（端点不可拖动）
  const eraseBorderFixedIndices = ref<number[]>([])
  // 偏移模式下当前拖动的节点索引（-1 表示未拖动）
  const eraseDraggingIdx = ref<number>(-1)
  // 重划模式下的折线
  const eraseRedrawPath = ref<Point[]>([])
  // 重划模式关联的两个区域
  const eraseRedrawRegion1 = ref<RegionEntity | null>(null)
  const eraseRedrawRegion2 = ref<RegionEntity | null>(null)
  // 重划模式下的共享边缓存
  const eraseRedrawSharedEdge = ref<{ startIdx1: number; startIdx2: number } | null>(null)

  // 抹除上下文菜单
  const eraseCtxMenu = ref<EraseCtxMenuState>({
    show: false, x: 0, y: 0, region1: null, region2: null, sharedEdge: null,
  })

  /** 通过鼠标坐标打开抹除菜单 */
  function openEraseCtxMenu(shared: SharedEdge, clientX: number, clientY: number): void {
    eraseCtxMenu.value = {
      show: true,
      x: clientX,
      y: clientY,
      region1: shared.region1,
      region2: shared.region2,
      sharedEdge: { startIdx1: shared.startIdx1, startIdx2: shared.startIdx2 },
    }
    setTimeout(() => {
      document.addEventListener('click', closeEraseCtx, { once: true })
    }, 0)
  }

  function closeEraseCtx(): void {
    eraseCtxMenu.value.show = false
  }

  /** 融合两个共享边的区域 */
  async function eraseMerge(): Promise<void> {
    const r1 = eraseCtxMenu.value.region1
    const r2 = eraseCtxMenu.value.region2
    if (!r1 || !r2) return
    closeEraseCtx()

    const choice = await dialog.prompt(
      `选择继承哪个实体的信息：\n1 - ${r1.name}\n2 - ${r2.name}`,
      '融合实体', '1'
    )
    if (!choice) return

    const keeper = choice === '2' ? r2 : r1
    const removed = choice === '2' ? r1 : r2

    const ok = await confirm({ type: 'danger', title: '合并区域', description: `该操作将会删除「${removed.name}」，确定继续？` })
    if (!ok) return

    beginTransaction()

    const pts1 = getTerritory(keeper)
    const pts2 = getTerritory(removed)
    const mergedPolygon = await bridgeMergePolygons(pts1, pts2)

    if (mergedPolygon.length >= 3) {
      let cx = 0, cy = 0
      for (const p of mergedPolygon) { cx += p.x; cy += p.y }
      cx = Math.round(cx / mergedPolygon.length)
      cy = Math.round(cy / mergedPolygon.length)
      const ent = entityStore.entityMap.get(keeper.id)
      if (ent) {
        entityStore.update(keeper.id, {
          properties: { ...(ent.properties || {}), mapX: cx, mapY: cy, territory: mergedPolygon }
        })
      }
    }

    await entityStore.remove(removed.id)

    const bordersRels = relationStore.relations.filter(r =>
      r.type === 'borders' &&
      ((r.sourceId === keeper.id && r.targetId === removed.id) ||
       (r.sourceId === removed.id && r.targetId === keeper.id))
    )
    for (const rel of bordersRels) {
      await relationStore.remove(rel.id)
    }

    commitTransaction()

    scheduleDraw()
  }

  /** 移线：选择偏移或重划 */
  async function eraseMoveLine(): Promise<void> {
    const r1 = eraseCtxMenu.value.region1
    const r2 = eraseCtxMenu.value.region2
    if (!r1 || !r2) return
    closeEraseCtx()

    const choice = await dialog.prompt(
      '选择移线方式：\n1 - 偏移（拖拽节点移动边境线）\n2 - 重划（重新绘制边境线）',
      '移线方式', '1'
    )
    if (!choice) return

    if (choice === '1') {
      startOffsetMode(r1, r2)
    } else {
      startRedrawMode(r1, r2)
    }
  }

  /** 进入偏移模式 */
  function startOffsetMode(r1: RegionEntity, r2: RegionEntity): void {
    eraseMode.value = 'offset'
    eraseRedrawRegion1.value = r1
    eraseRedrawRegion2.value = r2
    const shared = findSharedEdgeBetween(r1, r2, getTerritory)
    if (!shared) {
      toastWarn('未找到共享边境线')
      eraseMode.value = null
      return
    }
    const pts1 = getTerritory(r1)
    const edgePts = [pts1[shared.startIdx1], pts1[(shared.startIdx1 + 1) % pts1.length]]
    eraseBorderVertices.value = [...edgePts]
    eraseBorderFixedIndices.value = [0, edgePts.length - 1]
    eraseDraggingIdx.value = -1
    scheduleDraw()
  }

  /** 进入重划模式 */
  function startRedrawMode(r1: RegionEntity, r2: RegionEntity): void {
    eraseMode.value = 'redraw'
    eraseRedrawRegion1.value = r1
    eraseRedrawRegion2.value = r2
    eraseRedrawSharedEdge.value = findSharedEdgeBetween(r1, r2, getTerritory)
    eraseRedrawPath.value = []
    scheduleDraw()
  }

  /** 确认偏移：将新边境线写回两个区域 */
  async function confirmOffset(): Promise<void> {
    const r1 = eraseRedrawRegion1.value
    const r2 = eraseRedrawRegion2.value
    if (!r1 || !r2) { eraseMode.value = null; return }

    const shared = findSharedEdgeBetween(r1, r2, getTerritory)
    if (!shared) {
      eraseMode.value = null
      eraseBorderVertices.value = []
      scheduleDraw()
      return
    }

    const pts1 = getTerritory(r1)
    const newPts1 = [...pts1]
    const idx1Start = shared.startIdx1
    const idx1End = (shared.startIdx1 + 1) % pts1.length
    if (eraseBorderVertices.value.length >= 2) {
      newPts1[idx1Start] = { ...eraseBorderVertices.value[0] }
      newPts1[idx1End] = { ...eraseBorderVertices.value[eraseBorderVertices.value.length - 1] }
      if (eraseBorderVertices.value.length > 2) {
        const midPts = eraseBorderVertices.value.slice(1, -1)
        newPts1.splice(idx1End, 0, ...midPts)
      }
    }
    const ent1 = entityStore.entityMap.get(r1.id)
    if (ent1) {
      let cx = 0, cy = 0
      for (const p of newPts1) { cx += p.x; cy += p.y }
      entityStore.update(r1.id, {
        properties: { ...(ent1.properties || {}), mapX: Math.round(cx / newPts1.length), mapY: Math.round(cy / newPts1.length), territory: newPts1 }
      })
    }

    const pts2 = getTerritory(r2)
    const newPts2 = [...pts2]
    const idx2Start = shared.startIdx2
    const idx2End = (shared.startIdx2 + 1) % pts2.length
    if (eraseBorderVertices.value.length >= 2) {
      newPts2[idx2Start] = { ...eraseBorderVertices.value[eraseBorderVertices.value.length - 1] }
      newPts2[idx2End] = { ...eraseBorderVertices.value[0] }
      if (eraseBorderVertices.value.length > 2) {
        const midPts = [...eraseBorderVertices.value].slice(1, -1).reverse()
        newPts2.splice(idx2End, 0, ...midPts)
      }
    }
    const ent2 = entityStore.entityMap.get(r2.id)
    if (ent2) {
      let cx = 0, cy = 0
      for (const p of newPts2) { cx += p.x; cy += p.y }
      entityStore.update(r2.id, {
        properties: { ...(ent2.properties || {}), mapX: Math.round(cx / newPts2.length), mapY: Math.round(cy / newPts2.length), territory: newPts2 }
      })
    }

    eraseMode.value = null
    eraseBorderVertices.value = []
    scheduleDraw()
  }

  /** 完成重划：将新折线写回两个区域 */
  async function finishRedraw(): Promise<void> {
    if (eraseRedrawPath.value.length < 2) {
      eraseMode.value = null
      eraseRedrawPath.value = []
      return
    }

    const r1 = eraseRedrawRegion1.value
    const r2 = eraseRedrawRegion2.value
    if (!r1 || !r2) { eraseMode.value = null; return }

    const smooth = await bridgeChaikinSmooth(eraseRedrawPath.value, 1)
    const simplified = await bridgeSimplifyPoints(smooth, 3)

    const choice = await dialog.prompt(
      `新线与旧线之间的范围划入：\n1 - ${r1.name}\n2 - ${r2.name}`,
      '重划边境线', '1'
    )
    if (!choice) {
      eraseMode.value = null
      eraseRedrawPath.value = []
      scheduleDraw()
      return
    }

    const targetRegion = choice === '2' ? r2 : r1
    const otherRegion = choice === '2' ? r1 : r2
    const shared = eraseRedrawSharedEdge.value || findSharedEdgeBetween(r1, r2, getTerritory)
    if (!shared) {
      toastWarn('未找到共享边境线')
      eraseMode.value = null
      eraseRedrawPath.value = []
      scheduleDraw()
      return
    }

    const targetPts = getTerritory(targetRegion)
    const otherPts = getTerritory(otherRegion)
    const isTargetR1 = targetRegion.id === r1.id
    const isOtherR1 = otherRegion.id === r1.id

    const newTargetPts = replaceEdgeWithLine(targetPts, isTargetR1 ? shared.startIdx1 : shared.startIdx2, simplified)
    const reversedLine = [...simplified].reverse()
    const newOtherPts = replaceEdgeWithLine(otherPts, isOtherR1 ? shared.startIdx1 : shared.startIdx2, reversedLine)

    if (newTargetPts.length >= 3) {
      const ent = entityStore.entityMap.get(targetRegion.id)
      if (ent) {
        let cx = 0, cy = 0
        for (const p of newTargetPts) { cx += p.x; cy += p.y }
        entityStore.update(targetRegion.id, {
          properties: { ...(ent.properties || {}), mapX: Math.round(cx / newTargetPts.length), mapY: Math.round(cy / newTargetPts.length), territory: newTargetPts }
        })
      }
    }

    if (newOtherPts.length >= 3) {
      const ent = entityStore.entityMap.get(otherRegion.id)
      if (ent) {
        let cx = 0, cy = 0
        for (const p of newOtherPts) { cx += p.x; cy += p.y }
        entityStore.update(otherRegion.id, {
          properties: { ...(ent.properties || {}), mapX: Math.round(cx / newOtherPts.length), mapY: Math.round(cy / newOtherPts.length), territory: newOtherPts }
        })
      }
    }

    eraseMode.value = null
    eraseRedrawPath.value = []
    scheduleDraw()
  }

  /** 处理抹除模式下的键盘事件（Enter/Esc）：收编进 useShortcuts 注册表（view 层），模式条件在 handler 内判断 */
  const { register: registerShortcut, unregister: unregisterShortcut } = useShortcuts()
  registerShortcut({
    id: 'region.erase-confirm',
    keys: ['enter'],
    scope: 'view',
    description: '区域图谱：确认偏移边境线',
    preventDefault: true,
    handler: () => { if (eraseMode.value === 'offset') confirmOffset() },
  })
  registerShortcut({
    id: 'region.erase-cancel',
    keys: ['escape'],
    scope: 'view',
    description: '区域图谱：取消边境线编辑',
    preventDefault: true,
    handler: () => {
      if (eraseMode.value === 'offset' || eraseMode.value === 'redraw') {
        eraseMode.value = null
        eraseBorderVertices.value = []
        eraseRedrawPath.value = []
        scheduleDraw()
      }
    },
  })
  onBeforeUnmount(() => {
    unregisterShortcut('region.erase-confirm')
    unregisterShortcut('region.erase-cancel')
  })

  /** 重置所有抹除状态 */
  function resetEraseState(): void {
    eraseMode.value = null
    eraseBorderVertices.value = []
    eraseBorderFixedIndices.value = []
    eraseDraggingIdx.value = -1
    eraseRedrawPath.value = []
    eraseRedrawRegion1.value = null
    eraseRedrawRegion2.value = null
    eraseRedrawSharedEdge.value = null
  }

  return {
    // 状态
    eraseMode,
    eraseBorderVertices,
    eraseBorderFixedIndices,
    eraseDraggingIdx,
    eraseRedrawPath,
    eraseRedrawRegion1,
    eraseRedrawRegion2,
    eraseRedrawSharedEdge,
    eraseCtxMenu,
    // 方法
    openEraseCtxMenu,
    closeEraseCtx,
    eraseMerge,
    eraseMoveLine,
    startOffsetMode,
    startRedrawMode,
    confirmOffset,
    finishRedraw,

    resetEraseState,
  }
}

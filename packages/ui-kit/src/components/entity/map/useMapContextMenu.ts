// 区域地图的右键菜单：开合、菜单动作（编辑 / 删除 / 改色 / 建立邻接）。
// 从 RegionMap.vue 抽出的菜单层；命中测试与绘制细节由宿主注入。
import type { Ref } from 'vue'
import { findSharedEdgeAtPoint } from './geometry'
import type { CtxMenuState, HitTestResult, MapMode, Point, RegionEntity, SharedEdge } from './types'

interface ContextMenuDeps {
  mode: Ref<MapMode>
  ctxMenu: Ref<CtxMenuState>
  adjoinSelectMode: Ref<boolean>
  adjoinSourceRegion: Ref<RegionEntity | null>
  getRegions: () => RegionEntity[]
  getTerritory: (r: RegionEntity) => Point[]
  getPanX: () => number
  getPanY: () => number
  getScale: () => number
  hitTest: (mx: number, my: number) => HitTestResult | null
  openEraseCtxMenu: (shared: SharedEdge, clientX: number, clientY: number) => void
  toggleAdjoinTarget: (region: RegionEntity) => void
  startAdjoin: (region: RegionEntity) => void
  scheduleDraw: () => void
  onSelect: (region: RegionEntity) => void
  onDeleteRegion: (region: RegionEntity) => Promise<void>
  onSetColor: (region: RegionEntity, color: string) => void
}

export function useMapContextMenu(deps: ContextMenuDeps) {
  const {
    mode, ctxMenu, adjoinSelectMode, adjoinSourceRegion,
    getRegions, getTerritory, getPanX, getPanY, getScale,
    hitTest, openEraseCtxMenu, toggleAdjoinTarget, startAdjoin,
    scheduleDraw, onSelect, onDeleteRegion, onSetColor,
  } = deps

  function closeCtx() { ctxMenu.value.show = false }

  function onContextMenu(e: MouseEvent, rect: DOMRect) {
    const mx = e.clientX - rect.left, my = e.clientY - rect.top

    if (mode.value === 'draw') {
      const shared = findSharedEdgeAtPoint(mx, my, getPanX(), getPanY(), getScale(), getRegions(), getTerritory)
      if (shared) {
        openEraseCtxMenu(shared, e.clientX, e.clientY)
      }
      return
    }

    if (mode.value !== 'edit') return
    const hit = hitTest(mx, my)
    if (adjoinSelectMode.value) {
      if (hit && hit.region.id !== adjoinSourceRegion.value?.id) {
        toggleAdjoinTarget(hit.region)
        return
      }
      ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, region: null }
      setTimeout(() => { document.addEventListener('click', closeCtx, { once: true }) }, 0)
      return
    }
    if (hit && hit.vertexIdx === -1) {
      ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, region: hit.region }
      setTimeout(() => { document.addEventListener('click', closeCtx, { once: true }) }, 0)
    }
  }

  function ctxEdit() {
    if (!ctxMenu.value.region) return
    const r = ctxMenu.value.region
    onSelect(r)
    closeCtx()
  }

  async function ctxDelete() {
    if (!ctxMenu.value.region) return
    await onDeleteRegion(ctxMenu.value.region)
    closeCtx()
    scheduleDraw()
  }

  function ctxSetColor(color: string) {
    if (!ctxMenu.value.region) return
    onSetColor(ctxMenu.value.region, color)
    closeCtx()
    scheduleDraw()
  }

  function ctxAdjoin() {
    if (!ctxMenu.value.region) return
    startAdjoin(ctxMenu.value.region)
  }

  return { closeCtx, onContextMenu, ctxEdit, ctxDelete, ctxSetColor, ctxAdjoin }
}

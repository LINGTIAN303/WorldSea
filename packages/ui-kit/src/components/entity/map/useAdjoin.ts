/**
 * 接壤模式 composable
 *
 * 负责：
 * - 接壤选择模式的状态（多选目标区域）
 * - 接壤关系建立（relation type='borders'）
 * - 接壤方式的合并逻辑（extend / be-extended）
 *
 * 注意：与主上下文菜单的关闭逻辑（closeCtx）存在协作，
 * 通过 onAdjoinDone 回调通知主文件清理菜单状态。
 */

import { ref } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { useDialog } from '@worldsmith/ui-kit'
import { useUndoRedo } from '@worldsmith/ui-kit'
import { toastWarn } from '../../../composables/useToast'
import { bridgeComputeMergedPolygon } from '@worldsmith/canvas-engine/geometry'
import type { Point, RegionEntity } from './types'

interface UseAdjoinOptions {
  /** 获取所有区域列表 */
  getRegions: () => RegionEntity[]
  /** 获取区域的疆域多边形 */
  getTerritory: (r: RegionEntity) => Point[]
  /** 触发重绘 */
  scheduleDraw: () => void
  /** 接壤流程结束时回调（用于关闭主上下文菜单） */
  onAdjoinDone: () => void
}

export function useAdjoin(options: UseAdjoinOptions) {
  const { getRegions, getTerritory, scheduleDraw, onAdjoinDone } = options

  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const dialog = useDialog()
  const { beginTransaction, commitTransaction } = useUndoRedo()

  // 是否处于接壤多选模式
  const adjoinSelectMode = ref(false)
  // 接壤的源区域
  const adjoinSourceRegion = ref<RegionEntity | null>(null)
  // 已选中的目标区域 id 集合
  const adjoinSelectedIds = ref<Set<string>>(new Set())

  /** 进入接壤选择模式（来自右键菜单"接壤"） */
  function startAdjoin(sourceRegion: RegionEntity): void {
    adjoinSourceRegion.value = sourceRegion
    adjoinSelectMode.value = true
    adjoinSelectedIds.value = new Set()
    onAdjoinDone()
    toastWarn('请点击要接壤的区域（可多选），完成后右键确认')
    scheduleDraw()
  }

  /** 取消接壤选择 */
  function cancelAdjoin(): void {
    adjoinSelectMode.value = false
    adjoinSourceRegion.value = null
    adjoinSelectedIds.value = new Set()
    onAdjoinDone()
    scheduleDraw()
  }

  /** 切换某个目标区域的选中状态 */
  function toggleAdjoinTarget(region: RegionEntity): void {
    if (region.id === adjoinSourceRegion.value?.id) return
    const newSet = new Set(adjoinSelectedIds.value)
    if (newSet.has(region.id)) newSet.delete(region.id)
    else newSet.add(region.id)
    adjoinSelectedIds.value = newSet
    scheduleDraw()
  }

  /** 确认接壤：建立关系并合并疆域 */
  async function executeAdjoin(): Promise<void> {
    const source = adjoinSourceRegion.value
    const targetIds = [...adjoinSelectedIds.value]

    if (targetIds.length === 0) {
      toastWarn('请至少选择一个区域进行接壤')
      return
    }

    let method: 'extend' | 'be-extended' = 'extend'
    if (targetIds.length > 1) {
      method = 'be-extended'
    } else {
      const choice = await dialog.prompt(
        '选择接壤方式：\n1 - 选中区域延伸去接壤\n2 - 选中区域被延伸补齐',
        '接壤方式', '2'
      )
      method = choice === '1' ? 'extend' : 'be-extended'
    }

    const now = new Date().toISOString()

    beginTransaction()

    for (const targetId of targetIds) {
      const targetRegion = getRegions().find(r => r.id === targetId)
      if (!targetRegion) continue
      if (!source) continue

      relationStore.add({
        id: 'rel-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'borders',
        sourceId: source.id,
        targetId: targetId,
        label: '',
        properties: {},
        createdAt: now,
        updatedAt: now,
      })

      if (method === 'extend') {
        await mergeTerritories(targetRegion, source)
      } else {
        await mergeTerritories(source, targetRegion)
      }
    }

    commitTransaction()

    adjoinSelectMode.value = false
    adjoinSourceRegion.value = null
    adjoinSelectedIds.value = new Set()
    onAdjoinDone()
    scheduleDraw()
  }

  /** 将 extended 的疆域合并到 extender */
  async function mergeTerritories(extender: RegionEntity, extended: RegionEntity): Promise<void> {
    const extPts = getTerritory(extender)
    const extdPts = getTerritory(extended)

    let cx1 = 0, cy1 = 0
    for (const p of extPts) { cx1 += p.x; cy1 += p.y }
    cx1 /= extPts.length; cy1 /= extPts.length

    let cx2 = 0, cy2 = 0
    for (const p of extdPts) { cx2 += p.x; cy2 += p.y }
    cx2 /= extdPts.length; cy2 /= extdPts.length

    const dx = cx2 - cx1, dy = cy2 - cy1
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) return

    const mergedPolygon = await bridgeComputeMergedPolygon(extPts, extdPts)

    if (mergedPolygon.length >= 3) {
      let mcx = 0, mcy = 0
      for (const p of mergedPolygon) { mcx += p.x; mcy += p.y }
      mcx = Math.round(mcx / mergedPolygon.length)
      mcy = Math.round(mcy / mergedPolygon.length)

      const ent = entityStore.entityMap.get(extender.id)
      if (ent) {
        await entityStore.update(extender.id, {
          properties: {
            ...(ent.properties || {}),
            mapX: mcx,
            mapY: mcy,
            territory: mergedPolygon,
          }
        })
      }
    }
  }

  return {
    adjoinSelectMode,
    adjoinSourceRegion,
    adjoinSelectedIds,
    startAdjoin,
    cancelAdjoin,
    toggleAdjoinTarget,
    executeAdjoin,
  }
}

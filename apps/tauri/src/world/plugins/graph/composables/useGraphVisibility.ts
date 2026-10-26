/**
 * 可见性合成：类型开关、关系语义族开关、时间轴、视图模式与星座折叠共同决定
 * 哪些元素隐藏。G6 的状态映射只需要覆盖可见元素，避免对折叠星座里的子节点做无用下发。
 */
import { ref, type Ref } from 'vue'
import type { EdgeFamily, Overview, OverviewNode } from '../model/types'

interface CanvasVisibilityApi {
  isCollapsed(id: string): boolean
  collapseElement(id: string): Promise<void>
  setVisibility(map: Record<string, 'visible' | 'hidden'>): Promise<void>
}

export function useGraphVisibility(options: {
  overview: Ref<Overview>
  mode: Ref<'overview' | 'relations'>
  hiddenTypes: Ref<Set<string>>
  canvasRef: Ref<CanvasVisibilityApi | null>
  selectedNodeId: Ref<string | null>
  activeGroupId: Ref<string | null>
  exitFocus: () => void
  isTimelineHidden: (id: string) => boolean
}) {
  const { overview, mode, hiddenTypes, canvasRef, selectedNodeId, activeGroupId } = options
  const hiddenFamilies = ref<Set<EdgeFamily>>(new Set())

  function isNodeVisible(node: OverviewNode): boolean {
    return node.groupId === 'core' || !canvasRef.value?.isCollapsed(node.groupId)
  }

  function emptyStates(): Record<string, string[]> {
    const map: Record<string, string[]> = {}
    for (const node of overview.value.nodes.filter(isNodeVisible)) map[node.id] = []
    for (const edge of overview.value.edges) map[edge.id] = []
    for (const group of overview.value.groups) map[group.id] = []
    return map
  }

  async function toggleFamily(family: EdgeFamily): Promise<void> {
    const next = new Set(hiddenFamilies.value)
    if (next.has(family)) next.delete(family)
    else next.add(family)
    hiddenFamilies.value = next
    await applyVisibility()
  }

  async function applyVisibility(): Promise<void> {
    const nodeById = new Map(overview.value.nodes.map(node => [node.id, node]))
    const map: Record<string, 'visible' | 'hidden'> = {}
    const nodeHidden = (id: string): boolean => {
      const type = nodeById.get(id)?.type
      return Boolean(type && hiddenTypes.value.has(type)) || options.isTimelineHidden(id)
    }

    for (const group of overview.value.groups) {
      const typeHidden = Boolean(group.type && hiddenTypes.value.has(group.type))
      const groupHidden = group.kind === 'island' && (mode.value === 'relations' || typeHidden)
      map[group.id] = groupHidden ? 'hidden' : 'visible'
      if (groupHidden) {
        if (!canvasRef.value?.isCollapsed(group.id)) await canvasRef.value?.collapseElement(group.id)
      } else if (!canvasRef.value?.isCollapsed(group.id)) {
        for (const nodeId of group.nodeIds) map[nodeId] = nodeHidden(nodeId) ? 'hidden' : 'visible'
      }
    }

    for (const node of overview.value.nodes) {
      if (node.groupId === 'core') map[node.id] = nodeHidden(node.id) ? 'hidden' : 'visible'
    }
    for (const edge of overview.value.edges) {
      map[edge.id] = map[edge.source] === 'hidden' || map[edge.target] === 'hidden'
        || hiddenFamilies.value.has(edge.family)
        ? 'hidden'
        : 'visible'
    }

    await canvasRef.value?.setVisibility(map)
    if (selectedNodeId.value && map[selectedNodeId.value] === 'hidden') options.exitFocus()
    if (activeGroupId.value && map[activeGroupId.value] === 'hidden') activeGroupId.value = null
  }

  /** 供路径结果判断：节点是否被类型或时间轴过滤掉 */
  function isNodeFiltered(id: string): boolean {
    const type = overview.value.nodes.find(node => node.id === id)?.type
    return Boolean(type && hiddenTypes.value.has(type)) || options.isTimelineHidden(id)
  }

  return {
    hiddenFamilies,
    isNodeVisible,
    emptyStates,
    applyVisibility,
    toggleFamily,
    isNodeFiltered,
  }
}

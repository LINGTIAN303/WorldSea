/**
 * 搜索与状态高亮。
 *
 * 搜索命中、选中邻居、路径关闭后的状态恢复都产出同一套元素状态；
 * 面板开合与聚焦等导航编排留在视图壳，避免搜索与路径面板互相依赖。
 */
import { ref, type Ref } from 'vue'
import type { Overview } from '../model/types'
import type { GraphPath } from '../model/path'
import { matchNodeIds } from '../policy/labelPolicy'

interface CanvasSearchApi {
  isCollapsed(id: string): boolean
  setStates(map: Record<string, string[]>): Promise<void>
  resetStates(): Promise<void>
}

interface PathBridge {
  pathOpen: Ref<boolean>
  pathResult: Ref<GraphPath | null>
  closePath(): Promise<void>
  refreshPath(): Promise<void>
}

export function useGraphSearch(options: {
  overview: Ref<Overview>
  canvasRef: Ref<CanvasSearchApi | null>
  emptyStates: () => Record<string, string[]>
  selectedNodeId: Ref<string | null>
  focus: Ref<{ id: string; name: string; count: number } | null>
  activeGroupId: Ref<string | null>
  path: () => PathBridge
  selectNode: (id: string, center: boolean) => Promise<void>
}) {
  const searchQuery = ref('')
  const searchCount = ref(0)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  function neighborSet(id: string): Set<string> {
    const set = new Set<string>()
    for (const edge of options.overview.value.edges) {
      if (edge.source === id) set.add(edge.target)
      else if (edge.target === id) set.add(edge.source)
    }
    return set
  }

  async function applySelection(id: string): Promise<void> {
    const neighbors = neighborSet(id)
    const relatedEdges = new Set(options.overview.value.edges
      .filter(edge => edge.source === id || edge.target === id)
      .map(edge => edge.id))
    const map = options.emptyStates()
    for (const node of options.overview.value.nodes) {
      if (node.groupId === 'core' || !options.canvasRef.value?.isCollapsed(node.groupId)) {
        map[node.id] = node.id === id ? ['selected'] : neighbors.has(node.id) ? ['active'] : ['inactive']
      }
    }
    for (const edge of options.overview.value.edges) {
      map[edge.id] = relatedEdges.has(edge.id) ? ['active'] : ['inactive']
    }
    for (const group of options.overview.value.groups) {
      map[group.id] = group.nodeIds.includes(id) ? [] : ['inactive']
    }
    await options.canvasRef.value?.setStates(map)
  }

  async function applySearchHighlight(): Promise<void> {
    const ids = matchNodeIds(options.overview.value.nodes, searchQuery.value)
    searchCount.value = ids.length
    const map = options.emptyStates()
    for (const id of ids) map[id] = ['highlight']
    await options.canvasRef.value?.setStates(map)
  }

  async function restoreInteractionStates(): Promise<void> {
    if (searchQuery.value) await applySearchHighlight()
    else if (options.selectedNodeId.value) await applySelection(options.selectedNodeId.value)
    else await options.canvasRef.value?.resetStates()
  }

  function stopTimer(): void {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
  }

  function onSearch(value: string): void {
    searchQuery.value = value
    options.selectedNodeId.value = null
    options.focus.value = null
    options.activeGroupId.value = null
    if (options.path().pathOpen.value) void options.path().closePath()
    stopTimer()
    searchTimer = setTimeout(() => { void applySearchHighlight() }, 120)
  }

  async function onSearchEnter(): Promise<void> {
    stopTimer()
    const first = matchNodeIds(options.overview.value.nodes, searchQuery.value)[0]
    if (first) await options.selectNode(first, true)
  }

  function clearSearch(): void {
    stopTimer()
    searchQuery.value = ''
    searchCount.value = 0
    options.selectedNodeId.value = null
    options.focus.value = null
    const path = options.path()
    if (path.pathResult.value) void path.refreshPath()
    else void options.canvasRef.value?.setStates(options.emptyStates())
  }

  function dispose(): void {
    stopTimer()
  }

  return {
    searchQuery,
    searchCount,
    neighborSet,
    applySelection,
    applySearchHighlight,
    restoreInteractionStates,
    onSearch,
    onSearchEnter,
    clearSearch,
    dispose,
  }
}

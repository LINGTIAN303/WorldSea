/**
 * 关系路径搜索：面板开合、BFS 计算与高亮下发。
 * 高亮会覆盖选中/搜索状态，关闭或清空时交回 `restoreStates` 由视图壳恢复原状态。
 */
import { ref, type Ref } from 'vue'
import type { Overview } from '../model/types'
import { findShortestPath, type GraphPath } from '../model/path'

interface CanvasPathApi {
  setStates(map: Record<string, string[]>): Promise<void>
  resetStates(): Promise<void>
  focusElement(id: string, minZoom?: number): Promise<void>
}

export function usePathSearch(options: {
  overview: Ref<Overview>
  canvasRef: Ref<CanvasPathApi | null>
  restoreStates: () => Promise<void>
}) {
  const pathOpen = ref(false)
  const pathResult = ref<GraphPath | null>(null)
  const pathMessage = ref('')

  async function applyPathHighlight(): Promise<void> {
    const result = pathResult.value
    if (!result) return
    const map: Record<string, string[]> = {}
    for (const id of result.nodeIds) map[id] = ['highlight']
    for (const id of result.edgeIds) map[id] = ['highlight']
    await options.canvasRef.value?.setStates(map)
  }

  async function clearPath(): Promise<void> {
    pathResult.value = null
    pathMessage.value = ''
    await options.canvasRef.value?.resetStates()
    await options.restoreStates()
  }

  async function closePath(): Promise<void> {
    pathOpen.value = false
    await clearPath()
  }

  function togglePath(): void {
    if (pathOpen.value) void closePath()
    else pathOpen.value = true
  }

  async function runPath(fromId: string, toId: string): Promise<void> {
    const result = findShortestPath(options.overview.value.edges, fromId, toId)
    if (!result) {
      pathResult.value = null
      pathMessage.value = '两个实体之间没有可达路径'
      await options.canvasRef.value?.resetStates()
      await options.restoreStates()
      return
    }
    pathResult.value = result
    pathMessage.value = ''
    await options.canvasRef.value?.resetStates()
    await applyPathHighlight()
    void options.canvasRef.value?.focusElement(fromId, 0.8)
  }

  /** 数据刷新后重新校验并重画路径 */
  async function refreshPath(): Promise<void> {
    const result = pathResult.value
    if (!result) return
    const ids = new Set(options.overview.value.nodes.map(node => node.id))
    if (!result.nodeIds.every(id => ids.has(id))) {
      await clearPath()
      return
    }
    await applyPathHighlight()
  }

  return {
    pathOpen,
    pathResult,
    pathMessage,
    togglePath,
    closePath,
    clearPath,
    runPath,
    refreshPath,
  }
}

/**
 * 节点拖拽（2026-10-09 图谱改进批 B）：sigma 无内置拖拽，按官方手法接线——
 * `downNode` 捕获 → captor `mousemovebody` 改节点坐标（`viewportToGraph` 换算）→ 松手保留。
 * 拖拽期间禁相机平移；「切换布局 / 重开视图」可复位（布局重算即覆盖拖拽位）。
 */
import type { Sigma } from 'sigma'
import type Graph from 'graphology'

export function useNodeDrag() {
  /** 在渲染器就绪后接线（与视图 bindEvents 同点调用） */
  function attach(sigma: Sigma, graph: Graph): void {
    let dragged: string | null = null

    sigma.on('downNode', ({ node }) => {
      dragged = node
      sigma.getCamera().disable()
    })

    const captor = sigma.getMouseCaptor()
    captor.on('mousemovebody', (e) => {
      if (!dragged) return
      const pos = sigma.viewportToGraph(e)
      graph.mergeNodeAttributes(dragged, { x: pos.x, y: pos.y })
      e.preventSigmaDefault()
      e.original.preventDefault()
      e.original.stopPropagation()
    })

    captor.on('mouseup', () => {
      if (!dragged) return
      dragged = null
      sigma.getCamera().enable()
    })
  }

  return { attach }
}

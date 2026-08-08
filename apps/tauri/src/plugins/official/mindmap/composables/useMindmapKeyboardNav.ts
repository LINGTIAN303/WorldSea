import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { CanvasNode } from './canvasTypes'

/**
 * 键盘节点导航
 *  - Tab / Shift+Tab: 下一个/上一个节点
 *  - 方向键: 按距离+方向找最近节点
 *  - Enter: 进入子图（如果选中是实体节点）
 *  - Esc: 取消选择 / 返回上层
 */
export function useMindmapKeyboardNav(opts: {
  selectedNodeId: Ref<string>
  canvasNodes: Ref<CanvasNode[]>
  camera: Ref<{ x: number; y: number; k: number }>
  onEnter: (id: string) => void
  onFocus: (id: string) => void
  onExit: () => void
  onClear: () => void
}): void {
  function isInputFocused(): boolean {
    const t = document.activeElement
    if (!t) return false
    const tag = t.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as HTMLElement).isContentEditable
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (isInputFocused()) return
    if (e.ctrlKey || e.altKey || e.metaKey) return

    const nodes = opts.canvasNodes.value.filter(n => !n.hidden)
    if (nodes.length === 0) return

    if (e.key === 'Tab') {
      e.preventDefault()
      const curIdx = nodes.findIndex(n => n.id === opts.selectedNodeId.value)
      const next = e.shiftKey
        ? nodes[(curIdx - 1 + nodes.length) % nodes.length]
        : nodes[(curIdx + 1) % nodes.length]
      opts.selectedNodeId.value = next.id
      opts.onFocus(next.id)
      return
    }

    if (e.key === 'Enter') {
      if (opts.selectedNodeId.value) {
        e.preventDefault()
        opts.onEnter(opts.selectedNodeId.value)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      if (opts.selectedNodeId.value) {
        opts.selectedNodeId.value = ''
        opts.onClear()
      } else {
        opts.onExit()
      }
      return
    }

    // 方向键：找当前节点最近的对应方向节点
    if (e.key.startsWith('Arrow')) {
      const cur = nodes.find(n => n.id === opts.selectedNodeId.value)
      if (!cur) {
        // 没选中就选画面中心最近节点
        const cam = opts.camera.value
        const cx = cam.x, cy = cam.y
        let best: { n: CanvasNode; d: number } | null = null
        for (const n of nodes) {
          const d = (n.x - cx) ** 2 + (n.y - cy) ** 2
          if (!best || d < best.d) best = { n, d }
        }
        if (best) {
          opts.selectedNodeId.value = best.n.id
          opts.onFocus(best.n.id)
        }
        return
      }
      e.preventDefault()
      const dirX = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      const dirY = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      let best: { n: CanvasNode; score: number } | null = null
      for (const n of nodes) {
        if (n.id === cur.id) continue
        const dx = n.x - cur.x
        const dy = n.y - cur.y
        // 同向得分高
        const score = dx * dirX + dy * dirY
        if (score <= 0) continue
        // 距离惩罚
        const dist = Math.hypot(dx, dy)
        const adjusted = score / dist
        if (!best || adjusted > best.score) best = { n, score: adjusted }
      }
      if (best) {
        opts.selectedNodeId.value = best.n.id
        opts.onFocus(best.n.id)
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
}

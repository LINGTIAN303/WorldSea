import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { CanvasNode } from './canvasTypes'

/**
 * 键盘节点导航（方向键）
 *  - 方向键: 按距离+方向找最近节点；无选中时选画面中心最近节点
 *
 * Tab / Enter / Escape 已归 useShortcuts 注册表统一分发（XMind 惯例：Tab=加子主题、
 * Enter=加同级、Esc=取消选中/返回上层），此处不再监听，避免与注册表双触发。
 */
export function useMindmapKeyboardNav(opts: {
  selectedNodeId: Ref<string>
  canvasNodes: Ref<CanvasNode[]>
  camera: Ref<{ x: number; y: number; k: number }>
  onFocus: (id: string) => void
}): void {
  function isInputFocused(): boolean {
    const t = document.activeElement
    if (!t) return false
    const tag = t.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as HTMLElement).isContentEditable
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (isInputFocused()) return
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    if (!e.key.startsWith('Arrow')) return

    const nodes = opts.canvasNodes.value.filter(n => !n.hidden)
    if (nodes.length === 0) return

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

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
}

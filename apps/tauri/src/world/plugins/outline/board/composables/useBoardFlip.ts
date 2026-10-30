import { type Ref } from 'vue'
import { DURATION_VALUES, EASING_VALUES } from '@worldsea/motion-kit'

export interface BoardPoint { x: number; y: number }
export interface FlipDelta { id: string; dx: number; dy: number }

/** 只依赖位置的最小结构，避免把完整布局类型带进动效层 */
export interface BoardLayoutPositions {
  containers: Array<{ id: string; pos: BoardPoint }>
}

export function flipDeltas(
  before: Map<string, BoardPoint>,
  after: Map<string, BoardPoint>,
): FlipDelta[] {
  const out: FlipDelta[] = []
  for (const [id, prev] of before) {
    const next = after.get(id)
    if (!next) continue
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    if (dx !== 0 || dy !== 0) out.push({ id, dx, dy })
  }
  return out
}

function motionDisabled(): boolean {
  const ds = document.documentElement.dataset
  return ds.reduceMotion === 'on' || ds.animContent === 'off'
}

export function useBoardFlip(root: Ref<HTMLElement | null>) {
  const animations = new Map<Element, Animation>()

  function capture(layout: BoardLayoutPositions): Map<string, BoardPoint> {
    return new Map(layout.containers.map(c => [c.id, { x: c.pos.x, y: c.pos.y }]))
  }

  function play(before: Map<string, BoardPoint>, layout: BoardLayoutPositions): void {
    if (motionDisabled()) return
    const deltas = flipDeltas(before, capture(layout))
    if (!deltas.length) return
    for (const d of deltas) {
      const el = root.value?.querySelector<HTMLElement>(
        `[data-board-container-id="${d.id}"]`,
      )
      if (!el || typeof el.animate !== 'function') continue
      animations.get(el)?.cancel()
      const anim = el.animate(
        [{ transform: `translate(${d.dx}px, ${d.dy}px)` }, { transform: 'none' }],
        {
          duration: DURATION_VALUES.normal,
          easing: EASING_VALUES.out,
          fill: 'none',
        },
      )
      animations.set(el, anim)
      const clear = () => {
        if (animations.get(el) === anim) animations.delete(el)
      }
      anim.addEventListener('finish', clear)
      anim.addEventListener('cancel', clear)
    }
  }

  function cancel(): void {
    for (const anim of animations.values()) anim.cancel()
    animations.clear()
  }

  return { capture, play, cancel }
}

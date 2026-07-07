/**
 * 布局过渡动画
 *
 * 在 old/new 位置间做 cubic-bezier 插值，
 * 每帧更新 canvasNodes 的 x/y 并触发重绘。
 */
import type { CanvasNode } from './canvasTypes'

interface TweenTarget {
  node: CanvasNode
  fromX: number
  fromY: number
  toX: number
  toY: number
}

const DEFAULT_DURATION = 450 // ms
const DEFAULT_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)' // ease-in-out cubic

export function useLayoutAnimation() {
  let rafId = 0
  let isRunning = false

  /**
   * 在 canvasNodes 的当前坐标与目标坐标间执行插值过渡
   */
  function animateToTargets(
    targets: TweenTarget[],
    onTick: () => void,
    duration = DEFAULT_DURATION,
    _easing = DEFAULT_EASING,
  ): void {
    if (targets.length === 0) return

    // 取消旧动画
    cancelAnimation()

    const start = performance.now()
    isRunning = true

    function frame(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)

      // CSS cubic-bezier 求值（简化：用 ease 函数）
      const t = cubicEaseInOut(progress)

      for (const tgt of targets) {
        tgt.node.x = tgt.fromX + (tgt.toX - tgt.fromX) * t
        tgt.node.y = tgt.fromY + (tgt.toY - tgt.fromY) * t
      }

      onTick()

      if (progress < 1) {
        rafId = requestAnimationFrame(frame)
      } else {
        // 最终对齐
        for (const tgt of targets) {
          tgt.node.x = tgt.toX
          tgt.node.y = tgt.toY
        }
        isRunning = false
        onTick()
      }
    }

    rafId = requestAnimationFrame(frame)
  }

  function cancelAnimation(): void {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    isRunning = false
  }

  return { animateToTargets, cancelAnimation, isRunning: () => isRunning }
}

/** ease-in-out cubic: t²(3-2t) → 开头慢中间快结尾慢 */
function cubicEaseInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - (-2 * t + 2) ** 3 / 2
}

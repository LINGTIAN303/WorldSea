/**
 * # useManuscriptAnimation — 手稿块打字机动画（端无关）
 *
 * ## 职责
 * - 根据 ManuscriptBlock 内容驱动逐字显示动画
 * - 自适应延迟：内容越长，单字延迟越短（避免长文动画过长）
 * - 支持 prefersReducedMotion：无动画直接显示全部
 *
 * ## 端无关说明
 * 仅依赖 Vue + motion-kit（useReducedMotion）+ Agent 类型。
 *
 * 端分离批次3：从 src/agent/composables/useManuscriptAnimation.ts 迁移至 shared-composables。
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ManuscriptBlock } from '@agent/index'
import { useReducedMotion } from '@worldsmith/motion-kit'

export function useManuscriptAnimation(block: ManuscriptBlock) {
  const { prefersReducedMotion } = useReducedMotion()

  const allChars = computed(() => [...block.content])

  const visibleCount = ref(0)
  const isStreaming = ref(true)

  const charDelay = computed(() => {
    if (prefersReducedMotion.value) return 0
    const total = allChars.value.length
    if (total > 300) return 10
    if (total > 200) return 15
    if (total > 100) return 25
    if (total > 50) return 40
    return 60
  })

  let rafId = 0
  let lastTick = 0

  onMounted(() => {
    const total = allChars.value.length
    if (total === 0) {
      isStreaming.value = false
      return
    }
    if (prefersReducedMotion.value) {
      visibleCount.value = total
      isStreaming.value = false
      return
    }
    const batchSize = total > 200 ? 3 : 1
    const delay = charDelay.value
    let current = 0

    function tick(now: number) {
      if (now - lastTick >= delay) {
        lastTick = now
        current = Math.min(current + batchSize, total)
        visibleCount.value = current
        if (current >= total) {
          isStreaming.value = false
          return
        }
      }
      rafId = requestAnimationFrame(tick)
    }

    lastTick = performance.now()
    rafId = requestAnimationFrame(tick)
  })

  onUnmounted(() => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  })

  return { allChars, visibleCount, isStreaming, charDelay }
}

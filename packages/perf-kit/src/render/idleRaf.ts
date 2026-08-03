/**
 * 空闲 RAF 管理器（idleRaf）。有交互时运行动画循环，空闲超时后自动暂停，
 * 避免后台任务持续占用 CPU。
 *
 * 解决 PERF-22：长任务/动画无空闲暂停机制，常驻占用 CPU。
 *
 * 用法：
 *   const raf = createIdleRaf({ idleTimeout: 3000 })
 *   raf.start((dt) => { dt 为距上次 tick 的毫秒数 })
 *
 *   // 用户交互时调用，重置空闲计时（若已暂停则自动恢复）
 *   window.addEventListener('pointermove', () => raf.notifyActive())
 *
 *   // 组件卸载时调用
 *   onBeforeUnmount(() => raf.stop())
 */
export function createIdleRaf(options?: {
  /** 空闲判定阈值（ms），默认 3000 */
  idleTimeout?: number
}): {
  start: (tick: (dt: number) => void) => void
  stop: () => void
  notifyActive: () => void
  readonly running: boolean
} {
  const { idleTimeout = 3000 } = options ?? {}

  let running = false
  let rafId: number | null = null
  let lastActiveAt = 0
  let lastTickAt = 0
  let tick: ((dt: number) => void) | null = null

  function loop(now: number): void {
    if (!running) return
    // 距上次交互超过阈值 → 空闲，暂停循环
    if (now - lastActiveAt >= idleTimeout) {
      running = false
      rafId = null
      return
    }
    const dt = now - lastTickAt
    lastTickAt = now
    if (tick) tick(dt)
    rafId = requestAnimationFrame(loop)
  }

  function start(cb: (dt: number) => void): void {
    tick = cb
    if (running) return
    running = true
    lastActiveAt = performance.now()
    lastTickAt = lastActiveAt
    rafId = requestAnimationFrame(loop)
  }

  function stop(): void {
    running = false
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  }

  function notifyActive(): void {
    lastActiveAt = performance.now()
    // 空闲暂停后恢复运行
    if (!running && tick) start(tick)
  }

  return {
    start,
    stop,
    notifyActive,
    get running() { return running },
  }
}
/** 空闲 RAF 管理器（有交互运行动画、空闲超时自动暂停，解决 PERF-22），详细见 docs/details/注释/packages/perf-kit/render/idleRaf.md */
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
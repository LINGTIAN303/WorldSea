import { onUnmounted } from 'vue'

/** 图片/文件持久化事件载荷——订阅方在事件回调内读 IDB/store 一定可见新数据 */
export interface ImagePersistedEvent {
  id: string
  path: string
}

export interface UseImageResolverOptions {
  /**
   * 订阅"持久化已完成"事件；返回取消订阅的函数。
   * 命中事件时，resolver 会立即用当前 attempt 重新解析（绕过剩余退避）。
   * 由 consumer 注入事件源（onImagePersisted / onFilePersisted），避免 entity-core 反向依赖 worldsea-agent。
   */
  subscribe: (listener: (event: ImagePersistedEvent) => void) => () => void
  /**
   * 退避重试时间表（毫秒）。首元素必须为 0 表示立即尝试一次。
   * 默认 [0, 200, 400, 800, 1500, 3000]，总耗时约 5.9s，覆盖常见 IDB 事务提交 + Dexie 唤醒。
   */
  delays?: number[]
}

export interface UseImageResolverReturn {
  /**
   * 启动一次解析循环。`attempt` 接收当前版本号，resolve 成功返回 true，失败返回 false 进入下一轮退避。
   * 自动取消上一次未完成的循环（版本号自增 + 计时器清理）。
   */
  run: (attempt: (v: number) => Promise<boolean>) => Promise<void>
  /** 取消当前解析循环（通常在 onUnmounted 或 src 变 falsy 时调用）。 */
  cancel: () => void
  /** 当前版本号，供 attempt 内部做 stale 检查（`v !== resolver.getVersion()`）。 */
  getVersion: () => number
}

const DEFAULT_DELAYS = [0, 200, 400, 800, 1500, 3000]

/** 图片/文件解析重试管理（事件优先 + 退避兜底两段式循环），详细见 docs/details/注释/packages/entity-core/composables/useImageResolver.md */
export function useImageResolver(opts: UseImageResolverOptions): UseImageResolverReturn {
  const delays = opts.delays ?? DEFAULT_DELAYS
  let version = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let sleepDone: (() => void) | null = null
  let currentAttempt: ((v: number) => Promise<boolean>) | null = null

  function clearTimer() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (sleepDone) {
      sleepDone()
      sleepDone = null
    }
  }

  function cancel() {
    clearTimer()
    currentAttempt = null
    version++
  }

  async function run(attempt: (v: number) => Promise<boolean>): Promise<void> {
    currentAttempt = attempt
    const v = ++version
    clearTimer()
    for (let i = 0; i < delays.length; i++) {
      if (v !== version) return
      const delay = delays[i]
      if (delay > 0) {
        await new Promise<void>((done) => {
          sleepDone = done
          retryTimer = setTimeout(() => {
            retryTimer = null
            sleepDone = null
            done()
          }, delay)
        })
        if (v !== version) return
      }
      try {
        const ok = await attempt(v)
        if (v !== version) return
        if (ok) {
          clearTimer()
          return
        }
      } catch {
        if (v !== version) return
        // 继续下一轮退避
      }
    }
  }

  // 事件命中：绕过剩余退避，直接用当前 attempt 再试一次
  const unsubscribe = opts.subscribe((_event) => {
    const attempt = currentAttempt
    if (!attempt) return
    const v = version
    Promise.resolve(attempt(v)).then((ok) => {
      if (v === version && ok) {
        clearTimer()
      }
    }).catch(() => {
      // ignore；循环会继续按退避表重试
    })
  })

  onUnmounted(() => {
    cancel()
    unsubscribe()
  })

  return { run, cancel, getVersion: () => version }
}

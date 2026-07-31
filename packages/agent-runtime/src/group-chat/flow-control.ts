/**
 * 群聊控流系统
 *
 * 实现三级限流：全局 → ProviderSlot → Agent。
 * 使用 Token Bucket（请求频率）+ Concurrency Limiter（并发数）组合控制。
 * 请求排队等待而非直接拒绝，保证群聊不会因并发过高导致 API 超载。
 *
 * 附加通用退避重试层（retryWithBackoff），任何供应商返回 429/503/529
 * 时自动指数退避重试，无需逐个适配。
 */

import type { RateLimitConfig } from './types'

// ─── 通用退避重试 ──────────────────────────────────────────────

/** 可重试的 HTTP 状态码（任何供应商通用） */
const RETRYABLE_STATUS_CODES = new Set([429, 503, 529])

/** 退避重试配置 */
export interface RetryConfig {
  /** 最大重试次数（默认 3） */
  maxRetries: number
  /** 初始退避延迟 ms（默认 1000） */
  baseDelay: number
  /** 最大单次退避延迟 ms（默认 30000） */
  maxDelay: number
  /** 退避乘数（默认 2，即指数退避） */
  backoffMultiplier: number
  /** 抖动因子 0-1（默认 0.2，防止惊群） */
  jitterFactor: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
}

/** 从错误对象中提取 HTTP 状态码 */
function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as Record<string, unknown>

  // pi-ai / fetch 风格：err.status
  if (typeof e.status === 'number') return e.status
  // 嵌套：err.error.status
  if (e.error && typeof (e.error as any).status === 'number') {
    return (e.error as any).status
  }
  // 某些 SDK：err.statusCode
  if (typeof e.statusCode === 'number') return e.statusCode
  // 从 message 中提取
  if (typeof e.message === 'string') {
    const match = (e.message as string).match(/\b(429|503|529)\b/)
    if (match) return parseInt(match[1], 10)
  }
  return undefined
}

/** 判断错误是否可重试 */
export function isRetryableError(err: unknown): boolean {
  const status = extractStatusCode(err)
  if (status !== undefined) return RETRYABLE_STATUS_CODES.has(status)
  // 网络层错误（如连接被重置）也值得重试
  if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('network'))) {
    return true
  }
  return false
}

/**
 * 通用退避重试执行器
 *
 * 包装任意异步操作，遇到 429/503/529 时自动指数退避重试。
 * 适用于所有供应商，无需逐个适配。
 *
 * @param fn 要执行的异步操作
 * @param config 重试配置
 * @returns fn 的返回值
 * @throws 超过最大重试次数后抛出最后一次错误
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: unknown

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      // 最后一次尝试不再重试
      if (attempt >= cfg.maxRetries) break

      // 非可重试错误直接抛出
      if (!isRetryableError(err)) throw err

      // 计算退避延迟：base * multiplier^attempt + jitter
      const delay = Math.min(
        cfg.baseDelay * Math.pow(cfg.backoffMultiplier, attempt),
        cfg.maxDelay,
      )
      const jitter = delay * cfg.jitterFactor * Math.random()
      const totalDelay = delay + jitter

      const status = extractStatusCode(err)
      console.warn(
        `[Retry] 请求失败 (status=${status || 'unknown'})，` +
        `${Math.round(totalDelay)}ms 后第 ${attempt + 1}/${cfg.maxRetries} 次重试...`,
      )

      await sleep(totalDelay)
    }
  }

  throw lastError
}

// ─── 控流核心 ──────────────────────────────────────────────────

const DEFAULT_GLOBAL_LIMIT: RateLimitConfig = {
  maxConcurrent: 5,
  requestsPerMinute: 60,
}

const DEFAULT_SLOT_LIMIT: RateLimitConfig = {
  maxConcurrent: 2,
  requestsPerMinute: 20,
}

class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly refillRate: number

  constructor(capacity: number, refillPerMinute: number) {
    this.capacity = capacity
    this.tokens = capacity
    this.refillRate = refillPerMinute / 60_000
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }

  tryConsume(count = 1): boolean {
    this.refill()
    if (this.tokens >= count) {
      this.tokens -= count
      return true
    }
    return false
  }

  async waitAndConsume(count = 1): Promise<void> {
    const maxWait = 30_000
    const start = Date.now()
    while (!this.tryConsume(count)) {
      if (Date.now() - start > maxWait) {
        throw new Error('Flow control: request timed out waiting for token')
      }
      await sleep(100)
    }
  }
}

class ConcurrencyLimiter {
  private active = 0
  private queue: Array<() => void> = []

  private readonly maxConcurrent: number
  constructor(maxConcurrent: number) { this.maxConcurrent = maxConcurrent }

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => {
        this.active++
        resolve()
      })
    })
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) next()
  }

  get pending(): number {
    return this.queue.length
  }
}

interface SlotLimiter {
  rpm: TokenBucket
  concurrency: ConcurrencyLimiter
}

export class FlowController {
  private globalRpm: TokenBucket
  private globalConcurrency: ConcurrencyLimiter
  private slotLimiters: Map<string, SlotLimiter> = new Map()
  private slotLimitConfig: RateLimitConfig

  constructor(
    globalConfig: RateLimitConfig = DEFAULT_GLOBAL_LIMIT,
    slotConfig: RateLimitConfig = DEFAULT_SLOT_LIMIT,
  ) {
    this.globalRpm = new TokenBucket(globalConfig.requestsPerMinute, globalConfig.requestsPerMinute)
    this.globalConcurrency = new ConcurrencyLimiter(globalConfig.maxConcurrent)
    this.slotLimitConfig = slotConfig
  }

  registerSlot(slotId: string, config?: RateLimitConfig): void {
    const cfg = config ?? this.slotLimitConfig
    this.slotLimiters.set(slotId, {
      rpm: new TokenBucket(cfg.requestsPerMinute, cfg.requestsPerMinute),
      concurrency: new ConcurrencyLimiter(cfg.maxConcurrent),
    })
  }

  unregisterSlot(slotId: string): void {
    this.slotLimiters.delete(slotId)
  }

  async acquire(slotId: string): Promise<() => void> {
    await this.globalRpm.waitAndConsume()
    await this.globalConcurrency.acquire()

    const slot = this.slotLimiters.get(slotId)
    if (slot) {
      await slot.rpm.waitAndConsume()
      await slot.concurrency.acquire()
    }

    return () => {
      this.globalConcurrency.release()
      slot?.concurrency.release()
    }
  }

  getStats(): { globalPending: number; slots: Record<string, number> } {
    const slots: Record<string, number> = {}
    for (const [id, limiter] of this.slotLimiters) {
      slots[id] = limiter.concurrency.pending
    }
    return {
      globalPending: this.globalConcurrency.pending,
      slots,
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

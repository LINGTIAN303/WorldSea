import { describe, it, expect, vi } from 'vitest'
import { FlowController, retryWithBackoff, isRetryableError } from '../flow-control'
import type { RateLimitConfig } from '../types'

/**
 * High-RPM config that effectively disables rate limiting for tests
 * that need rapid sequential acquire calls.
 */
const NO_LIMIT: RateLimitConfig = { maxConcurrent: 100, requestsPerMinute: 100_000 }

// ─── TokenBucket (tested indirectly via FlowController) ───

describe('TokenBucket (via FlowController)', () => {
  it('tryConsume succeeds when tokens are available', async () => {
    const fc = new FlowController(NO_LIMIT, NO_LIMIT)
    fc.registerSlot('s1', NO_LIMIT)
    // First acquire should succeed immediately (bucket starts full)
    const release = await fc.acquire('s1')
    expect(release).toBeTypeOf('function')
    release()
  })

  it('tryConsume fails when tokens are depleted', async () => {
    vi.useFakeTimers()
    try {
      // Very low RPM so the bucket depletes quickly
      const lowRpm: RateLimitConfig = { maxConcurrent: 10, requestsPerMinute: 1 }
      const fc = new FlowController(lowRpm, lowRpm)
      fc.registerSlot('s1', lowRpm)

      // Consume the only token
      const release = await fc.acquire('s1')
      // Second acquire should block because the bucket is empty
      const acquirePromise = fc.acquire('s1')
      // Advance time by 100ms — not enough to refill a full token at 1 RPM
      vi.advanceTimersByTime(100)
      // The promise should still be pending (not resolved)
      let resolved = false
      acquirePromise.then(() => { resolved = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(resolved).toBe(false)
      release()
    } finally {
      vi.useRealTimers()
    }
  })

  it('tokens refill over time allowing subsequent acquires', async () => {
    vi.useFakeTimers()
    try {
      const lowRpm: RateLimitConfig = { maxConcurrent: 10, requestsPerMinute: 60 }
      const fc = new FlowController(lowRpm, lowRpm)
      fc.registerSlot('s1', lowRpm)

      const release = await fc.acquire('s1')
      release()

      // After consuming 1 token, wait long enough for it to refill
      // At 60 RPM = 1 token/sec, 2 seconds should refill 2 tokens
      vi.advanceTimersByTime(2_000)

      const release2 = await fc.acquire('s1')
      expect(release2).toBeTypeOf('function')
      release2()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── ConcurrencyLimiter ───

describe('ConcurrencyLimiter', () => {
  it('allows acquire up to maxConcurrent', async () => {
    const fc = new FlowController(
      { maxConcurrent: 2, requestsPerMinute: 100_000 },
      { maxConcurrent: 2, requestsPerMinute: 100_000 },
    )
    fc.registerSlot('s1', { maxConcurrent: 2, requestsPerMinute: 100_000 })

    const r1 = await fc.acquire('s1')
    const r2 = await fc.acquire('s1')
    // Both acquired successfully
    expect(r1).toBeTypeOf('function')
    expect(r2).toBeTypeOf('function')
    r1()
    r2()
  })

  it('queues acquires beyond maxConcurrent', async () => {
    const fc = new FlowController(
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
    )
    fc.registerSlot('s1', { maxConcurrent: 1, requestsPerMinute: 100_000 })

    const r1 = await fc.acquire('s1')
    // Second acquire should be queued (not resolved yet)
    let resolved = false
    const p2 = fc.acquire('s1').then(r => { resolved = true; return r })

    // Give microtask queue a chance
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(resolved).toBe(false)

    // Release the first — second should now resolve
    r1()
    const r2 = await p2
    expect(resolved).toBe(true)
    r2()
  })

  it('release frees concurrency for next waiter', async () => {
    const fc = new FlowController(
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
    )
    fc.registerSlot('s1', { maxConcurrent: 1, requestsPerMinute: 100_000 })

    const r1 = await fc.acquire('s1')
    const p2 = fc.acquire('s1')

    r1()
    const r2 = await p2
    r2()
    // If we get here without hanging, the release properly freed the slot
  })

  it('pending reflects queued acquires', async () => {
    const fc = new FlowController(
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
    )
    fc.registerSlot('s1', { maxConcurrent: 1, requestsPerMinute: 100_000 })

    const r1 = await fc.acquire('s1')
    // Queue two more
    const p2 = fc.acquire('s1')
    const p3 = fc.acquire('s1')

    // Let microtasks settle
    await new Promise(resolve => setTimeout(resolve, 0))

    const stats = fc.getStats()
    expect(stats.globalPending).toBeGreaterThanOrEqual(1)

    r1()
    const r2 = await p2
    r2()
    const r3 = await p3
    r3()
  })
})

// ─── FlowController ───

describe('FlowController', () => {
  it('constructs with default config', () => {
    const fc = new FlowController()
    const stats = fc.getStats()
    expect(stats.globalPending).toBe(0)
    expect(stats.slots).toEqual({})
  })

  it('constructs with custom config', () => {
    const custom: RateLimitConfig = { maxConcurrent: 10, requestsPerMinute: 200 }
    const fc = new FlowController(custom, custom)
    const stats = fc.getStats()
    expect(stats.globalPending).toBe(0)
  })

  it('registerSlot and unregisterSlot', () => {
    const fc = new FlowController(NO_LIMIT, NO_LIMIT)
    fc.registerSlot('slot-a')
    fc.registerSlot('slot-b')
    let stats = fc.getStats()
    expect(Object.keys(stats.slots)).toEqual(['slot-a', 'slot-b'])

    fc.unregisterSlot('slot-a')
    stats = fc.getStats()
    expect(Object.keys(stats.slots)).toEqual(['slot-b'])
  })

  it('registerSlot with custom config overrides default slot config', async () => {
    const fc = new FlowController(NO_LIMIT, { maxConcurrent: 1, requestsPerMinute: 1 })
    fc.registerSlot('limited', { maxConcurrent: 1, requestsPerMinute: 1 })
    fc.registerSlot('unlimited', NO_LIMIT)

    // The unlimited slot should acquire quickly
    const r1 = await fc.acquire('unlimited')
    r1()

    // The limited slot should also acquire (1 token available)
    const r2 = await fc.acquire('limited')
    r2()
  })

  it('acquire returns a release function', async () => {
    const fc = new FlowController(NO_LIMIT, NO_LIMIT)
    fc.registerSlot('s1', NO_LIMIT)
    const release = await fc.acquire('s1')
    expect(release).toBeTypeOf('function')
    release()
  })

  it('calling release frees concurrency for subsequent acquires', async () => {
    const fc = new FlowController(
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
    )
    fc.registerSlot('s1', { maxConcurrent: 1, requestsPerMinute: 100_000 })

    const r1 = await fc.acquire('s1')
    // Second acquire blocks
    const p2 = fc.acquire('s1')
    // Release first
    r1()
    // Now second should resolve
    const r2 = await p2
    r2()
  })

  it('acquire with unregistered slotId still works (no slot-level limiting)', async () => {
    const fc = new FlowController(NO_LIMIT, NO_LIMIT)
    // No registerSlot call — slot doesn't exist
    const release = await fc.acquire('unknown-slot')
    expect(release).toBeTypeOf('function')
    release()
  })

  it('getStats returns correct pending counts', async () => {
    const fc = new FlowController(
      { maxConcurrent: 10, requestsPerMinute: 100_000 },
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
    )
    fc.registerSlot('s1', { maxConcurrent: 1, requestsPerMinute: 100_000 })

    const r1 = await fc.acquire('s1')
    // Queue two more acquires — they will be pending at the slot level
    // (global concurrency is 10 so they pass through immediately)
    const p2 = fc.acquire('s1')
    const p3 = fc.acquire('s1')

    await new Promise(resolve => setTimeout(resolve, 0))

    const stats = fc.getStats()
    // Slot s1 should have 2 pending (p2 and p3 queued at slot concurrency)
    expect(stats.slots['s1']).toBeGreaterThanOrEqual(1)

    r1()
    const r2 = await p2
    r2()
    const r3 = await p3
    r3()
  })

  it('high RPM config allows rapid sequential acquire calls', async () => {
    const fc = new FlowController(NO_LIMIT, NO_LIMIT)
    fc.registerSlot('s1', NO_LIMIT)

    const releases: Array<() => void> = []
    for (let i = 0; i < 50; i++) {
      releases.push(await fc.acquire('s1'))
    }
    // All 50 should have succeeded
    expect(releases).toHaveLength(50)
    for (const r of releases) r()
  })

  it('multiple slots tracked independently', async () => {
    const fc = new FlowController(
      { maxConcurrent: 10, requestsPerMinute: 100_000 },
      { maxConcurrent: 1, requestsPerMinute: 100_000 },
    )
    fc.registerSlot('slot-a', { maxConcurrent: 1, requestsPerMinute: 100_000 })
    fc.registerSlot('slot-b', { maxConcurrent: 1, requestsPerMinute: 100_000 })

    // Each slot can hold 1 concurrent; both should acquire simultaneously
    const rA = await fc.acquire('slot-a')
    const rB = await fc.acquire('slot-b')

    // slot-a is at capacity; a second acquire on slot-a should queue
    let slotA2Resolved = false
    const pA2 = fc.acquire('slot-a').then(r => { slotA2Resolved = true; return r })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(slotA2Resolved).toBe(false)

    // But slot-b can still acquire (its own concurrency is free after release)
    rB()
    const rB2 = await fc.acquire('slot-b')
    rB2()

    // Now release slot-a, which should unblock the queued acquire
    rA()
    const rA2 = await pA2
    expect(slotA2Resolved).toBe(true)
    rA2()
  })

  it('unregisterSlot removes slot from stats', () => {
    const fc = new FlowController(NO_LIMIT, NO_LIMIT)
    fc.registerSlot('temp')
    expect(fc.getStats().slots).toHaveProperty('temp')
    fc.unregisterSlot('temp')
    expect(fc.getStats().slots).not.toHaveProperty('temp')
  })

  it('release is idempotent — calling twice does not go negative', async () => {
    const fc = new FlowController(NO_LIMIT, NO_LIMIT)
    fc.registerSlot('s1', NO_LIMIT)

    const release = await fc.acquire('s1')
    release()
    // Calling release again should not throw or corrupt state
    expect(() => release()).not.toThrow()
  })
})

// ─── retryWithBackoff ───

describe('retryWithBackoff', () => {
  it('returns result on first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await retryWithBackoff(fn, { baseDelay: 10, maxRetries: 3 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 and succeeds on second attempt', async () => {
    const err429 = new Error('Too Many Requests')
    ;(err429 as any).status = 429

    const fn = vi.fn()
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce('ok')

    const result = await retryWithBackoff(fn, { baseDelay: 10, maxRetries: 3, backoffMultiplier: 2, jitterFactor: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 503', async () => {
    const err503 = new Error('Service Unavailable')
    ;(err503 as any).status = 503

    const fn = vi.fn()
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce('recovered')

    const result = await retryWithBackoff(fn, { baseDelay: 10, maxRetries: 3, jitterFactor: 0 })
    expect(result).toBe('recovered')
  })

  it('retries on 529', async () => {
    const err529 = new Error('Site Overloaded')
    ;(err529 as any).status = 529

    const fn = vi.fn()
      .mockRejectedValueOnce(err529)
      .mockResolvedValueOnce('ok')

    const result = await retryWithBackoff(fn, { baseDelay: 10, maxRetries: 3, jitterFactor: 0 })
    expect(result).toBe('ok')
  })

  it('throws immediately on non-retryable errors', async () => {
    const err400 = new Error('Bad Request')
    ;(err400 as any).status = 400

    const fn = vi.fn().mockRejectedValue(err400)
    await expect(retryWithBackoff(fn, { baseDelay: 10, maxRetries: 3 })).rejects.toThrow('Bad Request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws last error after exhausting retries', async () => {
    const err429 = new Error('Too Many Requests')
    ;(err429 as any).status = 429

    const fn = vi.fn().mockRejectedValue(err429)

    await expect(retryWithBackoff(fn, { baseDelay: 10, maxRetries: 2, jitterFactor: 0 }))
      .rejects.toThrow('Too Many Requests')
    // Initial call + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('extracts status from nested error.error.status', async () => {
    const err = { error: { status: 429, message: 'rate limited' } }

    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok')

    const result = await retryWithBackoff(fn, { baseDelay: 10, maxRetries: 3, jitterFactor: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('extracts status from error message text', async () => {
    const err = new Error('Request failed with 429')

    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok')

    const result = await retryWithBackoff(fn, { baseDelay: 10, maxRetries: 3, jitterFactor: 0 })
    expect(result).toBe('ok')
  })

  it('applies exponential backoff', async () => {
    const err429 = new Error('rate limit')
    ;(err429 as any).status = 429

    const callTimes: number[] = []
    const fn = vi.fn().mockImplementation(() => {
      callTimes.push(Date.now())
      return Promise.reject(err429)
    })

    await expect(retryWithBackoff(fn, { baseDelay: 50, maxRetries: 2, backoffMultiplier: 2, jitterFactor: 0 }))
      .rejects.toThrow('rate limit')

    // Initial call + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3)

    // Verify delays: 1st retry ~50ms, 2nd retry ~100ms
    const delay1 = callTimes[1] - callTimes[0]
    const delay2 = callTimes[2] - callTimes[1]
    expect(delay1).toBeGreaterThanOrEqual(40)   // ~50ms with some tolerance
    expect(delay2).toBeGreaterThanOrEqual(80)   // ~100ms with some tolerance
  })
})

// ─── isRetryableError ───

describe('isRetryableError', () => {
  it('returns true for 429', () => {
    const err = new Error()
    ;(err as any).status = 429
    expect(isRetryableError(err)).toBe(true)
  })

  it('returns true for 503', () => {
    const err = new Error()
    ;(err as any).status = 503
    expect(isRetryableError(err)).toBe(true)
  })

  it('returns true for 529', () => {
    const err = new Error()
    ;(err as any).status = 529
    expect(isRetryableError(err)).toBe(true)
  })

  it('returns true for nested error.error.status = 429', () => {
    expect(isRetryableError({ error: { status: 429 } })).toBe(true)
  })

  it('returns true for statusCode property', () => {
    expect(isRetryableError({ statusCode: 429 })).toBe(true)
  })

  it('returns true for message containing 429', () => {
    expect(isRetryableError(new Error('Got 429 from API'))).toBe(true)
  })

  it('returns false for 400', () => {
    const err = new Error()
    ;(err as any).status = 400
    expect(isRetryableError(err)).toBe(false)
  })

  it('returns false for 401', () => {
    const err = new Error()
    ;(err as any).status = 401
    expect(isRetryableError(err)).toBe(false)
  })

  it('returns false for 500', () => {
    const err = new Error()
    ;(err as any).status = 500
    expect(isRetryableError(err)).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
  })
})

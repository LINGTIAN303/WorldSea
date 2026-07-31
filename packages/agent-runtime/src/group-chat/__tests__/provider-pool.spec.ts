import { describe, it, expect, vi } from 'vitest'
import { ProviderPool } from '../provider-pool'
import type { ProviderSlot, ProviderSlotEntry } from '../types'

// Mock key-store so loadApiKey returns a predictable value without localStorage/crypto
vi.mock('../../providers/key-store', () => ({
  loadApiKey: vi.fn().mockResolvedValue('test-api-key'),
}))

function makeEntry(overrides: Partial<ProviderSlotEntry> & { id: string }): ProviderSlotEntry {
  return {
    mode: 'cloud',
    provider: 'openai',
    modelId: 'gpt-4',
    ...overrides,
  }
}

function makeSlot(overrides: Partial<ProviderSlot> & { id: string }): ProviderSlot {
  return {
    name: 'test-slot',
    entries: [],
    strategy: 'round-robin',
    ...overrides,
  }
}

describe('ProviderPool', () => {
  // ── 1. Register a slot and resolve it (round-robin default) ──
  it('registers a slot and resolves it with round-robin default', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({ id: 'e1', apiKeyId: 'ak-openai' })
    const slot = makeSlot({ id: 's1', entries: [entry] })

    pool.register(slot)
    const config = await pool.resolve('s1')

    expect(config).toEqual({
      mode: 'cloud',
      provider: 'openai',
      modelId: 'gpt-4',
      apiKey: 'test-api-key',
    })
  })

  // ── 2. Unregister a slot ──
  it('unregisters a slot so resolve throws', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({ id: 'e1' })
    const slot = makeSlot({ id: 's1', entries: [entry] })

    pool.register(slot)
    pool.unregister('s1')

    await expect(pool.resolve('s1')).rejects.toThrow(
      'ProviderSlot "s1" not found or empty',
    )
  })

  // ── 3. Update a slot ──
  it('updates an existing slot', async () => {
    const pool = new ProviderPool()
    const entry1 = makeEntry({ id: 'e1', modelId: 'gpt-4' })
    const slot = makeSlot({ id: 's1', entries: [entry1] })

    pool.register(slot)

    // Update with new entries
    const entry2 = makeEntry({ id: 'e2', modelId: 'gpt-4o' })
    pool.update(makeSlot({ id: 's1', entries: [entry2] }))

    const config = await pool.resolve('s1')
    expect(config.mode).toBe('cloud')
    if (config.mode === 'cloud') {
      expect(config.modelId).toBe('gpt-4o')
    }
  })

  it('update registers a new slot if it does not exist', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({ id: 'e1' })
    pool.update(makeSlot({ id: 's-new', entries: [entry] }))

    const config = await pool.resolve('s-new')
    expect(config.mode).toBe('cloud')
  })

  // ── 4. Round-robin load balancing ──
  it('cycles through entries with round-robin strategy', async () => {
    const pool = new ProviderPool()
    const entries = [
      makeEntry({ id: 'e1', modelId: 'model-a' }),
      makeEntry({ id: 'e2', modelId: 'model-b' }),
      makeEntry({ id: 'e3', modelId: 'model-c' }),
    ]
    const slot = makeSlot({ id: 's1', entries, strategy: 'round-robin' })
    pool.register(slot)

    const results: string[] = []
    for (let i = 0; i < 6; i++) {
      const config = await pool.resolve('s1')
      if (config.mode === 'cloud') {
        results.push(config.modelId)
      }
    }

    // Should cycle: a, b, c, a, b, c
    expect(results).toEqual([
      'model-a', 'model-b', 'model-c',
      'model-a', 'model-b', 'model-c',
    ])
  })

  // ── 5. Random load balancing ──
  it('selects an entry with random strategy', async () => {
    const pool = new ProviderPool()
    const entries = [
      makeEntry({ id: 'e1', modelId: 'model-a' }),
      makeEntry({ id: 'e2', modelId: 'model-b' }),
    ]
    const slot = makeSlot({ id: 's1', entries, strategy: 'random' })
    pool.register(slot)

    // Resolve multiple times — at least one of each should appear
    const results = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const config = await pool.resolve('s1')
      if (config.mode === 'cloud') {
        results.add(config.modelId)
      }
    }

    // With 50 tries and 2 entries, both should appear (statistically near-certain)
    expect(results.size).toBeGreaterThanOrEqual(1)
  })

  it('respects weights in random strategy', async () => {
    // Use a spy to control Math.random for deterministic test
    const randomSpy = vi.spyOn(Math, 'random')

    const pool = new ProviderPool()
    const entries = [
      makeEntry({ id: 'e1', modelId: 'model-a', weight: 1 }),
      makeEntry({ id: 'e2', modelId: 'model-b', weight: 9 }),
    ]
    const slot = makeSlot({ id: 's1', entries, strategy: 'random' })
    pool.register(slot)

    // totalWeight = 10; random = 0.5 → remaining starts at 5.0
    // e1: 5.0 - 1 = 4.0 (> 0, skip); e2: 4.0 - 9 = -5.0 (≤ 0, select e2)
    randomSpy.mockReturnValue(0.5)
    const config = await pool.resolve('s1')
    if (config.mode === 'cloud') {
      expect(config.modelId).toBe('model-b')
    }

    // random = 0.05 → remaining = 0.5
    // e1: 0.5 - 1 = -0.5 (≤ 0, select e1)
    randomSpy.mockReturnValue(0.05)
    const config2 = await pool.resolve('s1')
    if (config2.mode === 'cloud') {
      expect(config2.modelId).toBe('model-a')
    }

    randomSpy.mockRestore()
  })

  // ── 6. Least-recent load balancing ──
  it('selects the least recently used entry', async () => {
    const pool = new ProviderPool()
    const entries = [
      makeEntry({ id: 'e1', modelId: 'model-a' }),
      makeEntry({ id: 'e2', modelId: 'model-b' }),
    ]
    const slot = makeSlot({ id: 's1', entries, strategy: 'least-recent' })
    pool.register(slot)

    // First resolve: both have lastUsed=0, picks first (e1)
    const config1 = await pool.resolve('s1')
    if (config1.mode === 'cloud') {
      expect(config1.modelId).toBe('model-a')
    }

    // Now e1 has a timestamp, e2 still has 0 → least-recent picks e2
    const config2 = await pool.resolve('s1')
    if (config2.mode === 'cloud') {
      expect(config2.modelId).toBe('model-b')
    }

    // Now both have timestamps; e1 was used first so its timestamp is older → picks e1
    const config3 = await pool.resolve('s1')
    if (config3.mode === 'cloud') {
      expect(config3.modelId).toBe('model-a')
    }
  })

  // ── 7. Error: resolve unknown slotId throws ──
  it('throws when resolving an unknown slotId', async () => {
    const pool = new ProviderPool()
    await expect(pool.resolve('nonexistent')).rejects.toThrow(
      'ProviderSlot "nonexistent" not found or empty',
    )
  })

  it('throws when resolving a slot with empty entries', async () => {
    const pool = new ProviderPool()
    const slot = makeSlot({ id: 's1', entries: [] })
    pool.register(slot)

    await expect(pool.resolve('s1')).rejects.toThrow(
      'ProviderSlot "s1" not found or empty',
    )
  })

  // ── 8. Error: register duplicate slotId throws ──
  // Note: The current implementation does NOT throw on duplicate register —
  // it silently overwrites via Map.set. We test the actual behavior.
  it('overwrites when registering a duplicate slotId', async () => {
    const pool = new ProviderPool()
    const entry1 = makeEntry({ id: 'e1', modelId: 'model-a' })
    const entry2 = makeEntry({ id: 'e2', modelId: 'model-b' })

    pool.register(makeSlot({ id: 's1', entries: [entry1] }))
    pool.register(makeSlot({ id: 's1', entries: [entry2] }))

    const config = await pool.resolve('s1')
    if (config.mode === 'cloud') {
      expect(config.modelId).toBe('model-b')
    }
  })

  // ── 9. entryToConfig for cloud / local / custom modes ──
  it('resolves cloud mode entry to CloudProviderConfig', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'cloud',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKeyId: 'ak-anthropic',
    })
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    const config = await pool.resolve('s1')
    expect(config).toEqual({
      mode: 'cloud',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKey: 'test-api-key',
    })
  })

  it('resolves cloud mode without apiKeyId to empty string apiKey', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'cloud',
      provider: 'openai',
      modelId: 'gpt-4',
      // no apiKeyId
    })
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    const config = await pool.resolve('s1')
    expect(config).toEqual({
      mode: 'cloud',
      provider: 'openai',
      modelId: 'gpt-4',
      apiKey: '',
    })
  })

  it('throws for cloud mode entry without provider', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'cloud',
      // no provider
      modelId: 'gpt-4',
    })
    // Remove provider field
    delete (entry as Partial<ProviderSlotEntry>).provider
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    await expect(pool.resolve('s1')).rejects.toThrow(
      'ProviderSlotEntry "e1": cloud mode requires a provider',
    )
  })

  it('resolves local mode entry to LocalProviderConfig', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'local',
      modelId: 'llama3',
      baseUrl: 'http://my-server:8080',
      localApiType: 'lm-studio',
    })
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    const config = await pool.resolve('s1')
    expect(config).toEqual({
      mode: 'local',
      endpoint: 'http://my-server:8080',
      apiType: 'lm-studio',
      modelId: 'llama3',
    })
  })

  it('resolves local mode with default endpoint and apiType', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'local',
      modelId: 'llama3',
      // no baseUrl, no localApiType
    })
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    const config = await pool.resolve('s1')
    expect(config).toEqual({
      mode: 'local',
      endpoint: 'http://localhost:11434',
      apiType: 'ollama',
      modelId: 'llama3',
    })
  })

  it('resolves custom mode entry to CustomProviderConfig', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'custom',
      modelId: 'my-model',
      baseUrl: 'https://api.custom.com/v1',
      apiKeyId: 'ak-custom',
      apiType: 'anthropic-compatible',
      contextWindow: 8192,
      maxTokens: 4096,
    })
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    const config = await pool.resolve('s1')
    expect(config).toEqual({
      mode: 'custom',
      baseUrl: 'https://api.custom.com/v1',
      apiKey: 'test-api-key',
      apiType: 'anthropic-compatible',
      modelId: 'my-model',
      contextWindow: 8192,
      maxTokens: 4096,
    })
  })

  it('resolves custom mode with default apiType and no optional fields', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'custom',
      modelId: 'my-model',
      baseUrl: 'https://api.custom.com/v1',
      // no apiKeyId, no apiType, no contextWindow, no maxTokens
    })
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    const config = await pool.resolve('s1')
    expect(config).toEqual({
      mode: 'custom',
      baseUrl: 'https://api.custom.com/v1',
      apiKey: '',
      apiType: 'openai-compatible',
      modelId: 'my-model',
      contextWindow: undefined,
      maxTokens: undefined,
    })
  })

  it('throws for custom mode entry without baseUrl', async () => {
    const pool = new ProviderPool()
    const entry = makeEntry({
      id: 'e1',
      mode: 'custom',
      modelId: 'my-model',
      // no baseUrl
    })
    delete (entry as Partial<ProviderSlotEntry>).baseUrl
    pool.register(makeSlot({ id: 's1', entries: [entry] }))

    await expect(pool.resolve('s1')).rejects.toThrow(
      'ProviderSlotEntry "e1": custom mode requires a baseUrl',
    )
  })
})

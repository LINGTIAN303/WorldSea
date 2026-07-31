import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TurnEngine } from '../turn-engine'
import type { AgentProfile } from '../types'
import type { LuckState } from '../speaking-desire'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../speaking-desire', () => ({
  evaluateSpeakingDesire: vi.fn(),
  computeTopicRelevance: vi.fn().mockReturnValue(0.5),
  createLuckState: vi.fn(),
  updateLuck: vi.fn(),
}))

vi.mock('../moderator', () => ({
  runModerator: vi.fn(),
}))

import { evaluateSpeakingDesire, computeTopicRelevance } from '../speaking-desire'
import { runModerator } from '../moderator'

// ── Helpers ────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentProfile> & { id: string }): AgentProfile {
  return {
    name: `Agent-${overrides.id}`,
    avatar: '🤖',
    color: '#000',
    systemPrompt: '',
    providerSlotId: 'slot-1',
    enabled: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeLuck(coefficient = 1.0): LuckState {
  return { coefficient, lastResetAt: Date.now(), operationCount: 0 }
}

const mockModeratorBackend = {
  prompt: vi.fn().mockResolvedValue(undefined),
  steer: vi.fn(),
  followUp: vi.fn(),
  abort: vi.fn(),
  updateModel: vi.fn(),
  updateThinkingLevel: vi.fn(),
  clearHistory: vi.fn(),
  subscribe: vi.fn().mockReturnValue(() => {}),
  dispose: vi.fn(),
  state: { messages: [] },
  isStreaming: false,
} as any

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(evaluateSpeakingDesire).mockReset()
  vi.mocked(computeTopicRelevance).mockReset().mockReturnValue(0.5)
  vi.mocked(runModerator).mockReset()
})

describe('TurnEngine', () => {
  // ── 1. Random strategy: returns 1-3 agent IDs ──
  it('random strategy: returns 1-3 agent IDs from participants', async () => {
    const engine = new TurnEngine('random', makeLuck())
    const agents = [
      makeAgent({ id: 'a1' }),
      makeAgent({ id: 'a2' }),
      makeAgent({ id: 'a3' }),
      makeAgent({ id: 'a4' }),
    ]

    const result = await engine.resolveTurn('hello', [], agents, '')

    expect(result.agentIds.length).toBeGreaterThanOrEqual(1)
    expect(result.agentIds.length).toBeLessThanOrEqual(3)
    for (const id of result.agentIds) {
      expect(agents.some(a => a.id === id)).toBe(true)
    }
  })

  // ── 2. Random strategy: agents with fewer recent speaks get higher weight ──
  it('random strategy: agents with fewer recent speaks get higher weight', async () => {
    // Fix Math.random to always pick the highest-weighted agent first
    const engine = new TurnEngine('random', makeLuck(), 1)
    const agents = [makeAgent({ id: 'quiet' }), makeAgent({ id: 'chatty' })]

    // Make "chatty" have a high recentCount → lower weight
    engine.recordSpeaking('chatty')
    engine.recordSpeaking('chatty')
    engine.recordSpeaking('chatty')

    // Run many times and count; "quiet" should be selected more often
    const counts: Record<string, number> = { quiet: 0, chatty: 0 }
    for (let i = 0; i < 200; i++) {
      const result = await engine.resolveTurn('hello', [], agents, '')
      for (const id of result.agentIds) {
        counts[id]++
      }
    }

    expect(counts.quiet).toBeGreaterThan(counts.chatty)
  })

  // ── 3. Random strategy: mention priority overrides main strategy ──
  it('random strategy: mention priority overrides main strategy', async () => {
    const engine = new TurnEngine('random', makeLuck())
    const agents = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' }), makeAgent({ id: 'a3' })]

    const result = await engine.resolveTurn('hello @a2', ['a2'], agents, '')

    expect(result.agentIds).toEqual(['a2'])
    expect(result.strategy).toBe('mention')
  })

  // ── 4. Speaking-desire strategy: evaluates speaking probability ──
  it('speaking-desire strategy: evaluates speaking probability', async () => {
    const engine = new TurnEngine('speaking-desire', makeLuck())
    const agents = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })]

    vi.mocked(evaluateSpeakingDesire).mockImplementation((ctx: any) => ({
      shouldTrigger: ctx.agentProfile.id === 'a1',
      finalProbability: ctx.agentProfile.id === 'a1' ? 0.9 : 0.1,
      agentId: ctx.agentProfile.id,
      agentName: ctx.agentProfile.name,
      factors: { base: 0.3, scene: 0.5, intimacy: 0.5, decay: 0.5, luck: 0.5 },
    }))

    const result = await engine.resolveTurn('hello', [], agents, '')

    expect(evaluateSpeakingDesire).toHaveBeenCalledTimes(2)
    expect(result.agentIds).toContain('a1')
    expect(result.strategy).toBe('speaking-desire')
  })

  // ── 5. Moderator strategy: delegates to moderator agent ──
  it('moderator strategy: delegates to moderator agent', async () => {
    const engine = new TurnEngine('moderator', makeLuck())
    const agents = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })]

    vi.mocked(runModerator).mockResolvedValue({
      nextSpeakers: ['a1'],
      reason: 'a1 is most relevant',
    })

    const result = await engine.resolveTurn('hello', [], agents, 'ctx', mockModeratorBackend)

    expect(runModerator).toHaveBeenCalledWith(mockModeratorBackend, agents, 'ctx', 'hello')
    expect(result.agentIds).toEqual(['a1'])
    expect(result.strategy).toBe('moderator')
    expect(result.reason).toBe('a1 is most relevant')
  })

  // ── 6. TurnResult has correct mode (parallel/sequential/staggered) ──
  it('TurnResult has correct mode (parallel/sequential/staggered)', async () => {
    const engine = new TurnEngine('moderator', makeLuck())
    const agents = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' }), makeAgent({ id: 'a3' })]

    // Sequential: single mention
    const seq = await engine.resolveTurn('hi', ['a1'], agents, '')
    expect(seq.mode).toBe('sequential')

    // Parallel: multiple mentions
    const par = await engine.resolveTurn('hi', ['a1', 'a2'], agents, '')
    expect(par.mode).toBe('parallel')

    // Staggered: moderator returns multiple speakers
    engine.setStrategy('moderator')
    vi.mocked(runModerator).mockResolvedValue({
      nextSpeakers: ['a1', 'a2'],
      reason: 'both relevant',
    })
    const stag = await engine.resolveTurn('hi', [], agents, 'ctx', mockModeratorBackend)
    expect(stag.mode).toBe('staggered')
  })

  // ── 7. TurnResult has correct strategy field ──
  it('TurnResult has correct strategy field', async () => {
    const agents = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })]

    // random
    const randomEngine = new TurnEngine('random', makeLuck())
    const randomResult = await randomEngine.resolveTurn('hi', [], agents, '')
    expect(randomResult.strategy).toBe('random')

    // speaking-desire
    vi.mocked(evaluateSpeakingDesire).mockImplementation((ctx: any) => ({
      shouldTrigger: true,
      finalProbability: 0.8,
      agentId: ctx.agentProfile.id,
      agentName: ctx.agentProfile.name,
      factors: { base: 0.3, scene: 0.5, intimacy: 0.5, decay: 0.5, luck: 0.5 },
    }))
    const sdEngine = new TurnEngine('speaking-desire', makeLuck())
    const sdResult = await sdEngine.resolveTurn('hi', [], agents, '')
    expect(sdResult.strategy).toBe('speaking-desire')

    // moderator
    vi.mocked(runModerator).mockResolvedValue({
      nextSpeakers: ['a1'],
      reason: 'test',
    })
    const modEngine = new TurnEngine('moderator', makeLuck())
    const modResult = await modEngine.resolveTurn('hi', [], agents, 'ctx', mockModeratorBackend)
    expect(modResult.strategy).toBe('moderator')

    // mention
    const mentionResult = await randomEngine.resolveTurn('hi', ['a2'], agents, '')
    expect(mentionResult.strategy).toBe('mention')
  })

  // ── 8. Empty participants returns empty result ──
  it('empty participants returns empty result', async () => {
    const engine = new TurnEngine('random', makeLuck())
    const result = await engine.resolveTurn('hello', [], [], '')

    expect(result.agentIds).toEqual([])
    expect(result.strategy).toBe('random')
  })

  it('empty participants: all disabled agents returns empty result', async () => {
    const engine = new TurnEngine('random', makeLuck())
    const agents = [makeAgent({ id: 'a1', enabled: false })]
    const result = await engine.resolveTurn('hello', [], agents, '')

    expect(result.agentIds).toEqual([])
  })
})

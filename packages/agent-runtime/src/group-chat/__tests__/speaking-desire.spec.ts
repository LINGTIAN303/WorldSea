import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  evaluateSpeakingDesire,
  computeTopicRelevance,
  createLuckState,
  updateLuck,
} from '../speaking-desire'
import type { AgentProfile } from '../types'
import type { SpeakingDesireContext } from '../speaking-desire'

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

function makeCtx(overrides: Partial<SpeakingDesireContext> & { agentProfile: AgentProfile }): SpeakingDesireContext {
  return {
    recentMessageCount: 0,
    secondsSinceLastSpoke: 30,
    topicRelevance: 0.5,
    luckState: createLuckState(),
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('evaluateSpeakingDesire', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // 1. Default config: baseProbability 0.3, talkativeness 1.0
  it('uses default baseProbability 0.3 and talkativeness 1.0 when no speakingDesire config', () => {
    const agent = makeAgent({ id: 'a1' })
    // No speakingDesire on agent → defaults
    const ctx = makeCtx({ agentProfile: agent, luckState: { coefficient: 1.0, lastResetAt: Date.now(), operationCount: 0 } })

    const result = evaluateSpeakingDesire(ctx)

    // effectiveBase = 0.3 * 1.0 = 0.3
    expect(result.factors.base).toBe(0.3)
    expect(result.finalProbability).toBeGreaterThan(0)
  })

  // 2. Custom speakingDesire config
  it('uses custom baseProbability and talkativeness from speakingDesire config', () => {
    const agent = makeAgent({
      id: 'a2',
      speakingDesire: { baseProbability: 0.6, talkativeness: 1.5 },
    })
    const ctx = makeCtx({ agentProfile: agent, luckState: { coefficient: 1.0, lastResetAt: Date.now(), operationCount: 0 } })

    const result = evaluateSpeakingDesire(ctx)

    // effectiveBase = 0.6 * 1.5 = 0.9
    expect(result.factors.base).toBeCloseTo(0.9)
  })

  // 3. Muted agent (talkativeness 0)
  it('muted agent with talkativeness 0 has zero probability', () => {
    const agent = makeAgent({
      id: 'a3',
      speakingDesire: { baseProbability: 0.5, talkativeness: 0 },
    })
    const ctx = makeCtx({ agentProfile: agent, luckState: { coefficient: 1.0, lastResetAt: Date.now(), operationCount: 0 } })

    const result = evaluateSpeakingDesire(ctx)

    // effectiveBase = 0.5 * 0 = 0
    expect(result.factors.base).toBe(0)
    expect(result.finalProbability).toBe(0)
    expect(result.shouldTrigger).toBe(false)
  })

  // 4. Result includes agentId and agentName
  it('result includes agentId and agentName from the profile', () => {
    const agent = makeAgent({ id: 'agent-x', name: 'Rex' })
    const ctx = makeCtx({ agentProfile: agent })

    const result = evaluateSpeakingDesire(ctx)

    expect(result.agentId).toBe('agent-x')
    expect(result.agentName).toBe('Rex')
  })

  // 5. High topicRelevance (>0.7) triggers isImmediate scene factor
  it('high topicRelevance (>0.7) sets scene factor to 1.0 (isImmediate)', () => {
    const agent = makeAgent({
      id: 'a5',
      speakingDesire: { baseProbability: 0.5 },
    })
    const ctx = makeCtx({
      agentProfile: agent,
      topicRelevance: 0.8,
      luckState: { coefficient: 1.0, lastResetAt: Date.now(), operationCount: 0 },
    })

    const result = evaluateSpeakingDesire(ctx)

    // isImmediate = true → sceneFactor = 1.0
    expect(result.factors.scene).toBe(1.0)
  })

  it('low topicRelevance (≤0.7) does not set isImmediate scene factor', () => {
    const agent = makeAgent({
      id: 'a5b',
      speakingDesire: { baseProbability: 0.5 },
    })
    const ctx = makeCtx({
      agentProfile: agent,
      topicRelevance: 0.5,
      luckState: { coefficient: 1.0, lastResetAt: Date.now(), operationCount: 0 },
    })

    const result = evaluateSpeakingDesire(ctx)

    // isImmediate = false → sceneFactor = min(1.0, (0.5 * 60) / 60) = 0.5
    expect(result.factors.scene).toBe(0.5)
  })

  // Deterministic shouldTrigger test with mocked Math.random
  it('shouldTrigger is true when Math.random returns value below finalProbability', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0) // always below probability
    const agent = makeAgent({
      id: 'a6',
      speakingDesire: { baseProbability: 0.5 },
    })
    const ctx = makeCtx({ agentProfile: agent, luckState: { coefficient: 1.0, lastResetAt: Date.now(), operationCount: 0 } })

    const result = evaluateSpeakingDesire(ctx)

    expect(result.shouldTrigger).toBe(true)
    spy.mockRestore()
  })

  it('shouldTrigger is false when Math.random returns value above finalProbability', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999) // above any reasonable probability
    const agent = makeAgent({
      id: 'a7',
      speakingDesire: { baseProbability: 0.5 },
    })
    const ctx = makeCtx({ agentProfile: agent, luckState: { coefficient: 1.0, lastResetAt: Date.now(), operationCount: 0 } })

    const result = evaluateSpeakingDesire(ctx)

    expect(result.shouldTrigger).toBe(false)
    spy.mockRestore()
  })
})

describe('computeTopicRelevance', () => {
  // 6. No expertise returns 0.5
  it('returns 0.5 when agent has no expertise', () => {
    const agent = makeAgent({ id: 'b1' })
    expect(computeTopicRelevance('hello world', agent)).toBe(0.5)
  })

  it('returns 0.5 when agent has empty expertise array', () => {
    const agent = makeAgent({ id: 'b1b', personality: { expertise: [] } })
    expect(computeTopicRelevance('hello world', agent)).toBe(0.5)
  })

  // 7. Matching keywords increase score
  it('matching expertise keywords increase score above base 0.3', () => {
    const agent = makeAgent({
      id: 'b2',
      personality: { expertise: ['python', 'rust'] },
    })

    const score = computeTopicRelevance('I love python programming', agent)

    // base 0.3 + 0.2 * 1.0 (python matched, default affinity) = 0.5
    expect(score).toBe(0.5)
  })

  it('multiple matching keywords stack the score', () => {
    const agent = makeAgent({
      id: 'b3',
      personality: { expertise: ['python', 'rust'] },
    })

    const score = computeTopicRelevance('python and rust are great', agent)

    // base 0.3 + 0.2 * 1.0 (python) + 0.2 * 1.0 (rust) = 0.7
    expect(score).toBe(0.7)
  })

  // 8. topicAffinities uses custom affinity values
  it('topicAffinities override default affinity of 1.0', () => {
    const agent = makeAgent({
      id: 'b4',
      personality: { expertise: ['python'] },
      speakingDesire: { baseProbability: 0.3, topicAffinities: { python: 2.0 } },
    })

    const score = computeTopicRelevance('python is awesome', agent)

    // base 0.3 + 0.2 * 2.0 (python with affinity 2.0) = 0.7
    expect(score).toBe(0.7)
  })

  it('topicAffinities with low affinity reduces score boost', () => {
    const agent = makeAgent({
      id: 'b5',
      personality: { expertise: ['python'] },
      speakingDesire: { baseProbability: 0.3, topicAffinities: { python: 0.5 } },
    })

    const score = computeTopicRelevance('python is awesome', agent)

    // base 0.3 + 0.2 * 0.5 = 0.4
    expect(score).toBe(0.4)
  })

  // 9. Score caps at 1.0
  it('caps score at 1.0 even with many matching keywords and high affinities', () => {
    const agent = makeAgent({
      id: 'b6',
      personality: { expertise: ['python', 'rust', 'java', 'go'] },
      speakingDesire: { baseProbability: 0.3, topicAffinities: { python: 3.0, rust: 3.0 } },
    })

    const score = computeTopicRelevance('python rust java go', agent)

    // Would be 0.3 + 0.2*3 + 0.2*3 + 0.2*1 + 0.2*1 = 2.0, but capped at 1.0
    expect(score).toBe(1.0)
  })

  it('keyword matching is case-insensitive', () => {
    const agent = makeAgent({
      id: 'b7',
      personality: { expertise: ['Python'] },
    })

    const score = computeTopicRelevance('I love PYTHON', agent)

    // Case-insensitive match
    expect(score).toBe(0.5) // 0.3 + 0.2 * 1.0
  })
})

describe('createLuckState', () => {
  // 10. Returns coefficient 1.0
  it('returns initial state with coefficient 1.0', () => {
    const state = createLuckState()

    expect(state.coefficient).toBe(1.0)
    expect(state.operationCount).toBe(0)
    expect(state.lastResetAt).toBeGreaterThan(0)
  })
})

describe('updateLuck', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // 11. Increments operationCount without reset
  it('increments operationCount without resetting when thresholds not exceeded', () => {
    const state = createLuckState()

    const updated = updateLuck(state, 60, 100)

    expect(updated.operationCount).toBe(1)
    expect(updated.coefficient).toBe(1.0) // unchanged
    expect(updated.lastResetAt).toBe(state.lastResetAt) // unchanged
  })

  it('increments operationCount across multiple calls', () => {
    let state = createLuckState()

    state = updateLuck(state, 60, 100)
    expect(state.operationCount).toBe(1)

    state = updateLuck(state, 60, 100)
    expect(state.operationCount).toBe(2)
  })

  // 12. Resets when operationCount exceeds threshold
  it('resets coefficient and operationCount when operationCount reaches threshold', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const state: import('../speaking-desire').LuckState = {
      coefficient: 1.0,
      lastResetAt: Date.now(),
      operationCount: 99,
    }

    const updated = updateLuck(state, 60, 100)

    // operationCount (99) >= resetOps (100) is false, so it increments to 100
    // Actually: 99 < 100, so it increments. Let's check: state.operationCount >= resetOps → 99 >= 100 → false
    // So it just increments to 100
    expect(updated.operationCount).toBe(100)
    expect(updated.coefficient).toBe(1.0)

    // Now call again with operationCount at 100
    const updated2 = updateLuck(updated, 60, 100)

    // 100 >= 100 → reset
    expect(updated2.operationCount).toBe(0)
    // coefficient = min(1.5, max(0.5, 0.5 + 0.5)) = 1.0
    expect(updated2.coefficient).toBe(1.0)
    expect(updated2.lastResetAt).toBeGreaterThanOrEqual(state.lastResetAt)

    vi.restoreAllMocks()
  })

  it('resets coefficient and operationCount when time threshold exceeded', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3)
    const state: import('../speaking-desire').LuckState = {
      coefficient: 1.0,
      lastResetAt: Date.now() - 61 * 60 * 1000, // 61 minutes ago
      operationCount: 0,
    }

    const updated = updateLuck(state, 60, 100)

    // Time exceeded → reset
    expect(updated.operationCount).toBe(0)
    // coefficient = min(1.5, max(0.5, 0.5 + 0.3)) = 0.8
    expect(updated.coefficient).toBe(0.8)

    vi.restoreAllMocks()
  })

  it('new coefficient is clamped between 0.5 and 1.5', () => {
    // Test lower bound: random returns 0 → 0.5 + 0 = 0.5
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state1: import('../speaking-desire').LuckState = {
      coefficient: 1.0,
      lastResetAt: Date.now() - 61 * 60 * 1000,
      operationCount: 0,
    }
    const result1 = updateLuck(state1, 60, 100)
    expect(result1.coefficient).toBe(0.5)

    // Test upper bound: random returns ~1 → 0.5 + 1 = 1.5
    vi.spyOn(Math, 'random').mockReturnValue(1.0)
    const state2: import('../speaking-desire').LuckState = {
      coefficient: 1.0,
      lastResetAt: Date.now() - 61 * 60 * 1000,
      operationCount: 0,
    }
    const result2 = updateLuck(state2, 60, 100)
    expect(result2.coefficient).toBe(1.5)

    vi.restoreAllMocks()
  })
})

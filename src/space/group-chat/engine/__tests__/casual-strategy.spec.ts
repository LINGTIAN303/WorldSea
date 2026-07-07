import { describe, it, expect, beforeEach } from 'vitest'
import { CasualStrategy } from '../CasualStrategy'
import type { GroupMember, GroupChatMessage } from '../../types'
import type { StrategyContext, EngineState, ThoughtItem } from '../IChatStrategy'

// ─── Helpers ──────────────────────────────────────────────────────────

function createMember(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    id: 'agent-1',
    name: 'Alice',
    avatar: '',
    color: '#fff',
    role: '作家',
    systemPrompt: '',
    speakCount: 0,
    lastSpokeAt: 0,
    groupRole: 'member',
    joinedAt: Date.now(),
    muted: false,
    lastActiveAt: Date.now(),
    enabledTools: [],
    enabledSkills: [],
    baseLayerMode: 'empty',
    ...overrides,
  }
}

function createMessage(overrides: Partial<GroupChatMessage> = {}): GroupChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: '大家好',
    timestamp: Date.now(),
    speakerId: 'user-1',
    speakerName: 'User',
    type: 'text',
    ...overrides,
  }
}

function createContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    topic: '自由聊天',
    currentRound: 1,
    mentionedAgentIds: [],
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('CasualStrategy', () => {
  let strategy: CasualStrategy

  beforeEach(() => {
    strategy = new CasualStrategy()
  })

  // 1. Constructor with default config
  it('constructor uses default config when no arguments provided', () => {
    const config = strategy.getConfig()
    expect(config.maxResponders).toBe(5)
    expect(config.maxResponseTokens).toBe(256)
    expect(config.desireConfig.threshold).toBe(0.4)
    expect(config.desireConfig.mentionBoost).toBe(0.5)
    expect(config.desireConfig.roleRelevanceWeight).toBe(0.3)
    expect(config.desireConfig.recentActivityDecay).toBe(0.1)
  })

  // 2. Constructor with custom DesireConfig
  it('constructor merges custom DesireConfig with defaults', () => {
    const custom = new CasualStrategy({ threshold: 0.7, mentionBoost: 0.8 }, 3, 128)
    const config = custom.getConfig()
    expect(config.desireConfig.threshold).toBe(0.7)
    expect(config.desireConfig.mentionBoost).toBe(0.8)
    // Unchanged defaults preserved
    expect(config.desireConfig.roleRelevanceWeight).toBe(0.3)
    expect(config.desireConfig.recentActivityDecay).toBe(0.1)
    expect(config.maxResponders).toBe(3)
    expect(config.maxResponseTokens).toBe(128)
  })

  // 3. selectSpeakers returns empty when no userMessage
  it('selectSpeakers returns empty array when context has no userMessage', () => {
    const members = [createMember()]
    const context = createContext({ userMessage: undefined })
    const result = strategy.selectSpeakers([], members, context)
    expect(result).toEqual([])
  })

  // 4. selectSpeakers returns empty when all members muted
  it('selectSpeakers returns empty array when all members are muted', () => {
    const members = [createMember({ id: 'a', muted: true }), createMember({ id: 'b', muted: true })]
    const context = createContext({ userMessage: createMessage() })
    const result = strategy.selectSpeakers([], members, context)
    expect(result).toEqual([])
  })

  // 5. selectSpeakers returns qualified members sorted by desireScore
  it('selectSpeakers returns qualified members sorted by desireScore descending', () => {
    const memberA = createMember({ id: 'agent-a', name: 'A', role: '作家' })
    const memberB = createMember({ id: 'agent-b', name: 'B', role: '科学家' })

    strategy.registerRoleKeywords('agent-a', ['文学', '小说'])
    strategy.registerRoleKeywords('agent-b', ['数据', '实验'])

    const userMsg = createMessage({ content: '最近看了本好小说，想聊聊文学' })
    const context = createContext({ userMessage: userMsg })
    const result = strategy.selectSpeakers([], [memberA, memberB], context)

    // agent-a should have higher score due to keyword match on "文学" and "小说"
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe('agent-a')
  })

  // 6. selectSpeakers falls back to top 2 when none pass threshold
  it('selectSpeakers falls back to top 2 members with score > 0 when none pass threshold', () => {
    // Use a very high threshold so nobody qualifies
    const highThreshold = new CasualStrategy({ threshold: 0.99 })
    const memberA = createMember({ id: 'agent-a', name: 'A' })
    const memberB = createMember({ id: 'agent-b', name: 'B' })
    const memberC = createMember({ id: 'agent-c', name: 'C' })

    const userMsg = createMessage({ content: '随便聊聊' })
    const context = createContext({ userMessage: userMsg })
    const result = highThreshold.selectSpeakers([], [memberA, memberB, memberC], context)

    // Fallback: up to 2 members with score > 0
    expect(result.length).toBeLessThanOrEqual(2)
  })

  // 7. selectSpeakers respects maxResponders limit
  it('selectSpeakers respects maxResponders limit', () => {
    const limited = new CasualStrategy(undefined, 2)
    const members = Array.from({ length: 6 }, (_, i) =>
      createMember({ id: `agent-${i}`, name: `Member${i}` }),
    )

    const userMsg = createMessage({ content: '大家好' })
    const context = createContext({ userMessage: userMsg })
    const result = limited.selectSpeakers([], members, context)

    expect(result.length).toBeLessThanOrEqual(2)
  })

  // 8. selectSpeakers with @mention boosts mentioned agent
  it('selectSpeakers boosts mentioned agent via mentionBoost', () => {
    const mentioned = createMember({ id: 'agent-mentioned', name: 'Mentioned' })
    const notMentioned = createMember({ id: 'agent-other', name: 'Other' })

    const userMsg = createMessage({ content: '你好', mentions: ['agent-mentioned'] })
    const context = createContext({
      userMessage: userMsg,
      mentionedAgentIds: ['agent-mentioned'],
    })

    const result = strategy.selectSpeakers([], [mentioned, notMentioned], context)

    // The mentioned agent should appear first (higher desireScore from mentionBoost)
    if (result.length >= 2) {
      expect(result[0].id).toBe('agent-mentioned')
    } else if (result.length === 1) {
      expect(result[0].id).toBe('agent-mentioned')
    }
  })

  // 9. shouldTerminate always returns { shouldTerminate: false, confidence: 0 }
  it('shouldTerminate always returns { shouldTerminate: false, confidence: 0 }', () => {
    const state: EngineState = {
      round: 10,
      startTime: Date.now(),
      messageCount: 50,
      costUsd: 0.5,
      maxCostUsd: 1.0,
    }
    const result = strategy.shouldTerminate([], state)
    expect(result).toEqual({ shouldTerminate: false, confidence: 0 })
  })

  // 10. buildSystemPrompt with custom systemPrompt uses it
  it('buildSystemPrompt uses member.systemPrompt when provided', () => {
    const member = createMember({ systemPrompt: '你是自定义的系统提示词' })
    const context = createContext()
    const prompt = strategy.buildSystemPrompt(member, context)

    expect(prompt).toContain('你是自定义的系统提示词')
    // Should NOT contain the default identity line
    expect(prompt).not.toContain('你是群聊成员')
  })

  // 11. buildSystemPrompt without systemPrompt generates default identity
  it('buildSystemPrompt generates default identity when systemPrompt is empty', () => {
    const member = createMember({ systemPrompt: '', name: 'Alice', role: '作家' })
    const context = createContext()
    const prompt = strategy.buildSystemPrompt(member, context)

    expect(prompt).toContain('你是群聊成员「Alice」')
    expect(prompt).toContain('角色是「作家」')
  })

  // 12. buildSystemPrompt includes style hint for known roles
  it('buildSystemPrompt includes style hint for known roles', () => {
    const member = createMember({ role: '科学家' })
    const context = createContext()
    const prompt = strategy.buildSystemPrompt(member, context)

    expect(prompt).toContain('严谨精确')
  })

  it('buildSystemPrompt omits style hint for unknown roles', () => {
    const member = createMember({ role: '未知角色' })
    const context = createContext()
    const prompt = strategy.buildSystemPrompt(member, context)

    // Should not contain any of the known style hints
    expect(prompt).not.toContain('严谨精确')
    expect(prompt).not.toContain('富有文学性')
  })

  // 13. buildSystemPrompt includes enabledSkills and enabledTools
  it('buildSystemPrompt includes enabledSkills and enabledTools', () => {
    const member = createMember({
      enabledSkills: ['写作', '翻译'],
      enabledTools: ['搜索', '代码执行'],
    })
    const context = createContext()
    const prompt = strategy.buildSystemPrompt(member, context)

    expect(prompt).toContain('你擅长：写作、翻译')
    expect(prompt).toContain('你可以使用工具：搜索、代码执行')
  })

  it('buildSystemPrompt omits skills/tools when empty', () => {
    const member = createMember({ enabledSkills: [], enabledTools: [] })
    const context = createContext()
    const prompt = strategy.buildSystemPrompt(member, context)

    expect(prompt).not.toContain('你擅长')
    expect(prompt).not.toContain('你可以使用工具')
  })

  // 14. buildSystemPrompt includes @mention prompt when mentioned
  it('buildSystemPrompt includes @mention prompt when member is mentioned', () => {
    const member = createMember({ id: 'agent-1' })
    const context = createContext({ mentionedAgentIds: ['agent-1'] })
    const prompt = strategy.buildSystemPrompt(member, context)

    expect(prompt).toContain('你被 @提及了，请务必回应')
  })

  it('buildSystemPrompt omits @mention prompt when member is not mentioned', () => {
    const member = createMember({ id: 'agent-1' })
    const context = createContext({ mentionedAgentIds: ['agent-other'] })
    const prompt = strategy.buildSystemPrompt(member, context)

    expect(prompt).not.toContain('你被 @提及了')
  })

  // 15. buildDynamicContext includes topic and @mention
  it('buildDynamicContext includes topic and @mention info', () => {
    const member = createMember({ id: 'agent-1' })
    const context = createContext({
      topic: 'AI技术讨论',
      mentionedAgentIds: ['agent-1'],
    })
    const ctx = strategy.buildDynamicContext(member, context)

    expect(ctx).toContain('群聊话题：AI技术讨论')
    expect(ctx).toContain('你被 @提及了，请务必回应')
    expect(ctx).toContain('简短自然')
  })

  it('buildDynamicContext uses default topic when undefined', () => {
    const member = createMember()
    const context = createContext({ topic: undefined })
    const ctx = strategy.buildDynamicContext(member, context)

    expect(ctx).toContain('群聊话题：自由聊天')
  })

  // 16. getConfig returns correct config
  it('getConfig returns the merged config object', () => {
    const s = new CasualStrategy({ threshold: 0.6 }, 3, 512)
    const config = s.getConfig()

    expect(config.desireConfig.threshold).toBe(0.6)
    expect(config.desireConfig.mentionBoost).toBe(0.5)
    expect(config.desireConfig.roleRelevanceWeight).toBe(0.3)
    expect(config.desireConfig.recentActivityDecay).toBe(0.1)
    expect(config.maxResponders).toBe(3)
    expect(config.maxResponseTokens).toBe(512)
  })

  // ─── Additional coverage: generateThoughts & shouldInitiate ────────

  describe('generateThoughts', () => {
    it('returns empty when no messages', () => {
      const result = strategy.generateThoughts([], [createMember()])
      expect(result).toEqual([])
    })

    it('returns empty when last message is too recent (< 15s)', () => {
      const messages = [createMessage({ timestamp: Date.now() - 5_000 })]
      const result = strategy.generateThoughts(messages, [createMember()])
      expect(result).toEqual([])
    })

    it('returns thoughts for members who have not spoken recently and have high desire', () => {
      const member = createMember({ id: 'agent-1', role: '作家', muted: false })
      strategy.registerRoleKeywords('agent-1', ['文学', '小说'])

      // Message from 20s ago about literature
      const messages = [
        createMessage({
          speakerId: 'user-1',
          content: '最近看了本好小说',
          timestamp: Date.now() - 20_000,
        }),
      ]

      const result = strategy.generateThoughts(messages, [member])

      // Should produce a thought since the member hasn't spoken and topic is relevant
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].agentId).toBe('agent-1')
      expect(result[0].priority).toBeGreaterThan(0.5)
    })

    it('skips muted members', () => {
      const member = createMember({ id: 'agent-1', muted: true })
      strategy.registerRoleKeywords('agent-1', ['文学'])

      const messages = [
        createMessage({
          content: '聊聊文学',
          timestamp: Date.now() - 20_000,
        }),
      ]

      const result = strategy.generateThoughts(messages, [member])
      expect(result).toEqual([])
    })

    it('skips members who spoke recently', () => {
      const member = createMember({ id: 'agent-1', muted: false })
      strategy.registerRoleKeywords('agent-1', ['文学'])

      const messages = [
        createMessage({
          speakerId: 'agent-1',
          content: '我来说说',
          timestamp: Date.now() - 20_000,
        }),
      ]

      const result = strategy.generateThoughts(messages, [member])
      expect(result).toEqual([])
    })
  })

  describe('shouldInitiate', () => {
    it('returns false when priority < 0.6', () => {
      const thought: ThoughtItem = {
        agentId: 'agent-1',
        content: 'test',
        priority: 0.5,
        triggeredAt: Date.now(),
      }
      expect(strategy.shouldInitiate(thought, [createMessage()])).toBe(false)
    })

    it('returns true when priority >= 0.6 and silence >= 10s', () => {
      const thought: ThoughtItem = {
        agentId: 'agent-1',
        content: 'test',
        priority: 0.7,
        triggeredAt: Date.now(),
      }
      const messages = [createMessage({ timestamp: Date.now() - 12_000 })]
      expect(strategy.shouldInitiate(thought, messages)).toBe(true)
    })

    it('returns false when silence < 10s even with high priority', () => {
      const thought: ThoughtItem = {
        agentId: 'agent-1',
        content: 'test',
        priority: 0.8,
        triggeredAt: Date.now(),
      }
      const messages = [createMessage({ timestamp: Date.now() - 5_000 })]
      expect(strategy.shouldInitiate(thought, messages)).toBe(false)
    })

    it('returns true when no messages exist', () => {
      const thought: ThoughtItem = {
        agentId: 'agent-1',
        content: 'test',
        priority: 0.7,
        triggeredAt: Date.now(),
      }
      expect(strategy.shouldInitiate(thought, [])).toBe(true)
    })
  })

  describe('registerRoleKeywords', () => {
    it('registers keywords that affect desire calculation', () => {
      const member = createMember({ id: 'agent-1', role: '科学家' })
      strategy.registerRoleKeywords('agent-1', ['量子', '物理'])

      const userMsg = createMessage({ content: '量子物理有什么新进展？' })
      const context = createContext({ userMessage: userMsg })
      const result = strategy.selectSpeakers([], [member], context)

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].id).toBe('agent-1')
    })
  })

  describe('getDesireCalculator', () => {
    it('returns the internal DesireCalculator instance', () => {
      const calc = strategy.getDesireCalculator()
      expect(calc).toBeDefined()
      expect(typeof calc.calculateAll).toBe('function')
    })
  })
})

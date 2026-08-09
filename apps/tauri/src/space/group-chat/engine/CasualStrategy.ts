import type { GroupMember, GroupChatMessage, DesireConfig, TerminationCheckResult } from '../types'
import { DEFAULT_DESIRE_CONFIG } from '../types'
import type { IChatStrategy, StrategyContext, EngineState, CasualConfig, ThoughtItem } from './IChatStrategy'
import { DesireCalculator } from './DesireCalculator'

export class CasualStrategy implements IChatStrategy {
  private desireCalculator: DesireCalculator
  private config: CasualConfig

  constructor(config?: Partial<DesireConfig>, maxResponders: number = 5, maxResponseTokens: number = 256) {
    this.desireCalculator = new DesireCalculator(config)
    this.config = {
      desireConfig: { ...DEFAULT_DESIRE_CONFIG, ...config },
      maxResponders,
      maxResponseTokens,
    }
  }

  registerRoleKeywords(agentId: string, keywords: string[]): void {
    this.desireCalculator.registerRoleKeywords(agentId, keywords)
  }

  selectSpeakers(messages: GroupChatMessage[], members: GroupMember[], context: StrategyContext): GroupMember[] {
    if (!context.userMessage) return []

    const activeMembers = members.filter(m => !m.muted)
    if (activeMembers.length === 0) return []

    const desires = this.desireCalculator.calculateAll(activeMembers, context.userMessage, messages)
    const qualified = this.desireCalculator.filterByThreshold(desires)

    qualified.sort((a, b) => b.desireScore - a.desireScore)

    let selected = qualified.slice(0, this.config.maxResponders)

    if (selected.length === 0) {
      desires.sort((a, b) => b.desireScore - a.desireScore)
      const fallbackCount = Math.min(2, desires.filter(d => d.desireScore > 0).length)
      selected = desires.slice(0, fallbackCount)
    }

    return selected.map(d => activeMembers.find(m => m.id === d.agentId)!).filter(Boolean)
  }

  shouldTerminate(_messages: GroupChatMessage[], _state: EngineState): TerminationCheckResult {
    return { shouldTerminate: false, confidence: 0 }
  }

  getConfig(): CasualConfig {
    return this.config
  }

  buildSystemPrompt(member: GroupMember, context: StrategyContext): string {
    const parts: string[] = []

    if (member.systemPrompt) {
      parts.push(member.systemPrompt)
    } else {
      parts.push(`你是群聊成员「${member.name}」，角色是「${member.role}」。`)
    }

    const styleHint = this.inferStyleHint(member.role)
    if (styleHint) parts.push(styleHint)

    if (member.enabledSkills && member.enabledSkills.length > 0) {
      parts.push(`你擅长：${member.enabledSkills.join('、')}。相关话题时主动展示专业见解。`)
    }
    if (member.enabledTools && member.enabledTools.length > 0) {
      parts.push(`你可以使用工具：${member.enabledTools.join('、')}。需要时主动调用。`)
    }

    parts.push(`群聊话题：${context.topic || '自由聊天'}。`)
    parts.push('请用简短自然的语言回复，像日常群聊一样。1-3句话即可。')
    parts.push('如果觉得没什么好说的，可以回复"收到"、"👍"等简短回应。')
    parts.push('不要重复别人说过的话，要有自己的观点和风格。')

    if (context.mentionedAgentIds.includes(member.id)) {
      parts.push('你被 @提及了，请务必回应。')
    }

    return parts.join('\n\n')
  }

  /**
   * 构建对话级动态上下文
   *
   * 系统提示词已在 Agent 创建时通过 systemPromptOverride 隔离设置，
   * 此方法仅返回对话级的动态信息（话题、@mention 等）。
   */
  buildDynamicContext(member: GroupMember, context: StrategyContext): string {
    const parts: string[] = []

    parts.push(`群聊话题：${context.topic || '自由聊天'}。`)
    parts.push('请用简短自然的语言回复，像日常群聊一样。1-3句话即可。')
    parts.push('如果觉得没什么好说的，可以回复"收到"、"👍"等简短回应。')
    parts.push('不要重复别人说过的话，要有自己的观点和风格。')

    if (context.mentionedAgentIds.includes(member.id)) {
      parts.push('你被 @提及了，请务必回应。')
    }

    return parts.join('\n\n')
  }

  generateThoughts(messages: GroupChatMessage[], members: GroupMember[]): ThoughtItem[] {
    const recent = messages.slice(-10)
    if (recent.length === 0) return []

    const lastMsg = recent[recent.length - 1]
    const silenceDuration = Date.now() - lastMsg.timestamp
    if (silenceDuration < 15_000) return []

    const thoughts: ThoughtItem[] = []

    for (const member of members) {
      if (member.muted) continue

      const myRecentCount = recent.filter(m => m.speakerId === member.id).length
      if (myRecentCount > 0) continue

      const roleRelevance = this.desireCalculator.calculate(member, lastMsg, recent)

      if (roleRelevance.desireScore > 0.5) {
        thoughts.push({
          agentId: member.id,
          content: `话题与${member.role}角色相关，且该角色近期未发言`,
          priority: roleRelevance.desireScore,
          triggeredAt: Date.now(),
        })
      }
    }

    return thoughts.sort((a, b) => b.priority - a.priority)
  }

  shouldInitiate(thought: ThoughtItem, messages: GroupChatMessage[]): boolean {
    if (thought.priority < 0.6) return false

    const lastMsg = messages[messages.length - 1]
    if (!lastMsg) return true

    const silenceDuration = Date.now() - lastMsg.timestamp
    return silenceDuration >= 10_000
  }

  getDesireCalculator(): DesireCalculator {
    return this.desireCalculator
  }

  private inferStyleHint(role: string): string {
    const hints: Record<string, string> = {
      '作家': '你的说话风格富有文学性，喜欢用比喻和诗意的表达。',
      '科学家': '你的说话风格严谨精确，喜欢引用数据和逻辑推理。',
      '艺术家': '你的说话风格感性浪漫，关注美感和创意。',
      '历史学家': '你的说话风格沉稳厚重，喜欢引经据典。',
      '哲学家': '你的说话风格思辨深邃，喜欢追问本质。',
      '工程师': '你的说话风格务实简洁，关注可行性和效率。',
      '商人': '你的说话风格精明干练，关注价值和收益。',
    }
    return hints[role] || ''
  }
}
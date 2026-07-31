/**
 * 群聊主持 Agent
 *
 * Moderator 是一个真正的 Agent，拥有完整的工具和对话能力。
 * 它不仅决定谁应该发言，自己也可以作为群聊参与者发言。
 *
 * 职责：
 * 1. 调度：根据用户消息和对话上下文，决定哪些参与者应该发言
 * 2. 参与：在需要时主动发言，引导话题、总结讨论、调解分歧
 *
 * 调度输出 JSON 格式的决策结果：{ nextSpeakers: string[], reason: string }
 * 每次调度后清理调度历史，避免上下文膨胀。
 */

import type { IAgentBackend } from '../bridge'
import type { AgentProfile } from './types'

const MODERATOR_SYSTEM_PROMPT = `你是一个群聊主持人。你有两个职责：

1. **调度**：根据用户的消息和当前对话话题，决定哪些参与者应该发言。
2. **参与**：在需要时你可以主动发言，引导话题、总结讨论、调解分歧。

参与者列表：
{agentList}

调度规则：
1. 每次选择 1-3 个最相关的参与者
2. 如果消息明确 @某人，只选择被 @的人
3. 如果话题涉及多个领域，选择多个相关的人
4. 避免让同一个人在每轮都发言，注意均衡
5. 只返回 JSON，不要其他文字

返回格式：
{"nextSpeakers": ["agent-id-1", "agent-id-2"], "reason": "简要说明"}`

interface ModeratorDecision {
  nextSpeakers: string[]
  reason: string
}

/** 默认回退决策：选择第一个启用的 Agent */
function fallbackDecision(agents: AgentProfile[]): ModeratorDecision {
  const first = agents[0]
  return {
    nextSpeakers: first ? [first.id] : [],
    reason: 'fallback: no valid JSON decision from moderator',
  }
}

/**
 * 运行 Moderator 调度决策
 *
 * @param backend Moderator Agent 后端（真正的 Agent，有完整工具能力）
 * @param agents 群聊中的 Agent 列表
 * @param conversationContext 对话上下文
 * @param userMessage 用户消息
 */
export async function runModerator(
  backend: IAgentBackend,
  agents: AgentProfile[],
  conversationContext: string,
  userMessage: string,
): Promise<ModeratorDecision> {
  const enabledAgents = agents.filter(a => a.enabled)
  const agentList = enabledAgents
    .map(a => {
      const expertise = a.personality?.expertise?.join(', ') ?? '通用'
      const style = a.personality?.speakingStyle ?? '默认'
      return `- ${a.id}: ${a.name}（专长: ${expertise}，风格: ${style}）`
    })
    .join('\n')

  const systemPrompt = MODERATOR_SYSTEM_PROMPT.replace('{agentList}', agentList)

  const prompt = conversationContext
    ? `${conversationContext}\n\n用户最新消息: ${userMessage}`
    : userMessage

  try {
    // 清理调度历史，确保每次决策独立
    backend.clearHistory()

    await backend.prompt(prompt, { contextOverride: systemPrompt, chatMode: 'normal' })

    const state = backend.state
    const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant?.content) {
      return fallbackDecision(enabledAgents)
    }

    const jsonMatch = lastAssistant.content.match(/\{[\s\S]*"nextSpeakers"[\s\S]*\}/)
    if (!jsonMatch) {
      return fallbackDecision(enabledAgents)
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed.nextSpeakers)) {
      return fallbackDecision(enabledAgents)
    }
    const validIds = new Set(enabledAgents.map(a => a.id))
    const filtered = (parsed.nextSpeakers as unknown[])
      .filter((id: unknown): id is string => typeof id === 'string')
      .filter((id: string) => validIds.has(id))

    if (filtered.length === 0) return fallbackDecision(enabledAgents)

    return { nextSpeakers: filtered, reason: parsed.reason ?? '' }
  } catch {
    return fallbackDecision(enabledAgents)
  } finally {
    // 调用后清理调度历史，防止上下文膨胀
    // Moderator 的调度对话和群聊对话是分离的
    backend.clearHistory()
  }
}

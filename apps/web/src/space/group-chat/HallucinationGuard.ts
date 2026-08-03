import type { IAgentBackend, AgentEvent } from '@agent/index'
import type { GroupParticipant } from './types'

export const GROUP_CHAT_RULES_PROMPT = `
## 群聊讨论规则
1. 你正在参与一个多人圆桌讨论，请始终保持你的角色身份
2. 引用世界观设定时，只能引用【实体库】中已存在的实体和关系
3. 如果你的观点基于尚未确认的设定，请标注"【待确认】"
4. 不要将其他参与者的推测当作已确认的事实引用
5. 如果发现与其他参与者的观点矛盾，请明确指出矛盾点
6. 当你认为讨论已经充分，请在回复末尾添加 [DISCUSSION_END]
7. 不要代替其他角色发言，不要改变你的核心立场
`

export function buildParticipantSystemPrompt(participant: GroupParticipant, topic: string): string {
  return `你是「${participant.name}」，${participant.role}

${GROUP_CHAT_RULES_PROMPT}

当前讨论话题：${topic}

请始终保持「${participant.name}」的身份参与讨论。表达你的观点，回应其他参与者的发言。`
}

export function detectUncertaintyMarkers(content: string): string[] {
  const markers: string[] = []
  const patterns = [
    /【待确认】/g,
    /我推测/g,
    /我猜测/g,
    /据我推测/g,
  ]
  for (const pattern of patterns) {
    const matches = content.match(pattern)
    if (matches) markers.push(...matches)
  }
  return markers
}

export function hasUncertaintyMarkers(content: string): boolean {
  return detectUncertaintyMarkers(content).length > 0
}

export async function crossValidateClaim(
  claim: string,
  agents: IAgentBackend[],
  claimantIndex: number,
): Promise<{ confirmed: boolean; confirmations: number; total: number }> {
  const otherAgents = agents.filter((_, idx) => idx !== claimantIndex)
  const agentsToCheck = otherAgents.slice(0, 2)

  if (agentsToCheck.length === 0) return { confirmed: false, confirmations: 0, total: 0 }

  const validationPrompt = `请独立判断以下声明是否合理且与已知信息一致。只需回答"一致"或"不一致"，并简述理由：\n\n${claim}`

  let confirmations = 0
  for (const agent of agentsToCheck) {
    try {
      let responseText = ''
      const unsub = agent.subscribe((event: AgentEvent) => {
        if (event.type === 'message_update' && event.content) {
          responseText += event.content
        }
      })
      await agent.prompt(validationPrompt, { chatMode: 'group-chat' })
      unsub()
      if (responseText.includes('一致')) {
        confirmations++
      }
    } catch (err) {
      console.warn('[HallucinationGuard] 交叉验证 Agent 调用失败', err)
    }
  }

  return {
    confirmed: confirmations >= Math.ceil(agentsToCheck.length / 2),
    confirmations,
    total: agentsToCheck.length,
  }
}

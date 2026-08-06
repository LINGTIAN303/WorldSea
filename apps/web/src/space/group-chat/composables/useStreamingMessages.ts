import { computed } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'
import type { ToolCallInfo } from '../types'

/** 流式消息显示 composable（流式 Agent 列表/发言人/HTML 转义等），详细见 docs/details/注释/web/space/group-chat/composables/useStreamingMessages.md */
export function useStreamingMessages() {
  const store = useGroupChatStore()

  /** 当前正在流式输出的 Agent ID 列表 */
  const activeStreamingIds = computed(() => Object.keys(store.streamingAgents))

  /** 正在输入的 Agent 名称列表（用于显示 "X、Y 正在输入..."） */
  const typingAgentNames = computed(() => {
    return Object.keys(store.typingAgents)
      .map(id => store.groupMembers.find(m => m.id === id)?.name)
      .filter(Boolean) as string[]
  })

  /** 根据 Agent ID 获取发言人名称 */
  function getSpeakerName(agentId: string): string {
    return store.groupMembers.find(m => m.id === agentId)?.name ?? ''
  }

  /** 根据 Agent ID 获取发言人颜色 */
  function getSpeakerColor(agentId: string): string {
    return store.groupMembers.find(m => m.id === agentId)?.color ?? '#888'
  }

  /** 渲染流式内容为 HTML（转义特殊字符 + 换行处理） */
  function renderStreamingContent(agentId: string): string {
    const state = store.streamingAgents[agentId]
    if (!state) return ''
    return state.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
  }

  /** 获取指定 Agent 的流式工具调用列表 */
  function getStreamingToolCalls(agentId: string): ToolCallInfo[] {
    return store.streamingAgents[agentId]?.toolCalls ?? []
  }

  return {
    activeStreamingIds,
    typingAgentNames,
    getSpeakerName,
    getSpeakerColor,
    renderStreamingContent,
    getStreamingToolCalls,
  }
}

/**
 * AgentMessageList 拆分后的共用类型与纯函数。
 *
 * 这里集中放置无状态、无副作用的工具，供主文件、子组件与 composable 复用，
 * 避免逻辑重复并保持各模块职责单一。
 */
import type { AgentMessage } from '@worldsea/agent-runtime'
import type { DeepSegment } from '@worldsea/shared-composables/agent/useAgent'

/**
 * 渲染窗口化中的单个展示项。
 * - message: 普通消息气泡
 * - segment: 深度模式链段卡片（推理 Think 条 / 阶段工具卡），由 AgentMessageList 展开平铺
 * - divider: 时间分隔线（dividerText === 'turn-separator' 时为深度模式回合分隔）
 * - toolcall: 选择型工具卡（独立于阶段卡，始终可交互）
 * _windowIndex 仅用于窗口化切片时给 divider 提供稳定的 key。
 */
export interface DisplayItem {
  type: 'message' | 'segment' | 'toolcall' | 'divider'
  msg?: AgentMessage
  segment?: DeepSegment
  toolCall?: import('@worldsea/shared-composables/agent/useAgent').ToolCallView
  dividerText?: string
  _windowIndex?: number
}

/** 将时间戳格式化为时间分隔线文本（今天/昨天/月日 + 时分） */
export function formatDividerTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  if (isToday) return `今天 ${time}`
  if (isYesterday) return `昨天 ${time}`
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}

/**
 * 获取展示项的稳定 id（供窗口化高度测量 / 滚动定位 / key 使用）。
 * - message → msg.id
 * - segment → segment.id
 * - toolcall → toolCall.id
 * - divider → 'divider'
 */
export function getItemId(item: DisplayItem): string {
  switch (item.type) {
    case 'message': return item.msg?.id ?? ''
    case 'segment': return item.segment?.id ?? ''
    case 'toolcall': return item.toolCall?.id ?? ''
    default: return 'divider'
  }
}

/** 截断文本，超过 maxLen 加省略号 */
export function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

/** 渲染最终结论区文本（简易 markdown：段落/换行/加粗/行内代码） */
export function renderFinalOutput(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
}

/** 渲染归档摘要文本（简易 markdown：段落/换行/加粗/小标题/行内代码） */
export function renderArchiveSummary(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/### (.*?)(<br>|$)/g, '<h4>$1</h4>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
}

/**
 * 深度模式：根据用户消息 ID 找到紧随其后的助手回复消息 ID。
 * 用于深度模式下用户消息条的高亮判断与跳转目标定位。
 */
export function findAssistantAfterUserMsg(
  messages: AgentMessage[],
  userMsgId: string
): string | null {
  const idx = messages.findIndex(m => m.id === userMsgId)
  if (idx === -1) return null
  for (let i = idx + 1; i < messages.length; i++) {
    if (messages[i].role === 'assistant') return messages[i].id
  }
  return null
}

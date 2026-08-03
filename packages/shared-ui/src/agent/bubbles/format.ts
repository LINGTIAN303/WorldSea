/**
 * 时间格式化工具（从原 AgentMessageBubble.vue 提取）
 */

/** 格式化为 HH:MM（消息时间戳） */
export function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/** 格式化为 HH:MM:SS（活动日志时间戳，精确到秒） */
export function formatActivityTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

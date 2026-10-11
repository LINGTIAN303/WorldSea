/**
 * format.ts — 时间格式化共享工具（批次103 全端统一；批次109 跨年补年份 + 边界兜底）
 *
 * 全端时间语言收敛到一处，克制呈现（弱信息、中文表达）：
 * - formatClock          HH:mm（日志行首用）
 * - formatMsgTime        消息气泡时间（今天 HH:mm，今年 M月D日 HH:mm，跨年 YYYY年M月D日 HH:mm）
 * - formatDateTime       绝对时间 YYYY-MM-DD HH:mm（记忆面板用）
 * - formatRelativeTime   相对时间（会话列表：刚刚 / N 分钟前 / N 小时前 / 昨天 / M月D日 / 跨年 YYYY年M月D日）
 * - isSameDay            两个时间戳是否同一天（日期分隔线判断）
 * - formatDateLabel      日期分隔线标签（今天 / 昨天 / M月D日 / YYYY年M月D日）
 */

const MS_MIN = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** HH:mm（24 小时制） */
export function formatClock(ts: number | string | Date): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 消息气泡时间：今天仅 HH:mm；今年 M月D日 HH:mm；跨年补年份。无时间戳（含空串）返回空串 */
export function formatMsgTime(ts?: number | string | null): string {
  if (ts === undefined || ts === null || ts === '') return ''
  const d = new Date(ts)
  const now = new Date()
  const clock = formatClock(d)
  if (isSameDay(d, now)) return clock
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clock}`
}

/** 绝对时间：YYYY-MM-DD HH:mm；无时间戳返回 '-'（记忆面板空态） */
export function formatDateTime(ts?: number | null): string {
  if (ts === undefined || ts === null) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${formatClock(d)}`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / M月D日；跨年补年份（与 formatDateLabel 对齐） */
export function formatRelativeTime(ts: number): string {
  const now = new Date()
  const diff = now.getTime() - ts
  if (diff < MS_MIN) return '刚刚'
  if (diff < MS_HOUR) return `${Math.floor(diff / MS_MIN)} 分钟前`
  if (diff < MS_DAY) return `${Math.floor(diff / MS_HOUR)} 小时前`
  const d = new Date(ts)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/** 两个时间戳是否同一天 */
export function isSameDay(a: number | string | Date, b: number | string | Date): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/** 日期分隔线标签：今天 / 昨天 / 同年 M月D日 / 跨年加年份 */
export function formatDateLabel(ts: number | string): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfDay) / MS_DAY)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * ArchivePanel 共用格式化工具函数
 *
 * 从原 ArchivePanel.vue 抽取，供各子视图共用。
 */

/** 格式化时间戳（未运行时显示"未运行"） */
export function formatTime(ts: number): string {
  if (!ts) return '未运行'
  return new Date(ts).toLocaleString('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 格式化字节数 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let unitIdx = 0
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024
    unitIdx++
  }
  return `${val.toFixed(val >= 100 ? 0 : 1)} ${units[unitIdx]}`
}

/** 格式化日期（仅年月日） */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  })
}

/** 格式化日期时间 */
export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 钩子状态中文标签 */
export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: '活跃',
    deprecated: '淘汰',
    pending_delete: '待删除',
    orphan: '孤儿',
    trashed: '已回收',
    pending_merge: '待合并',
  }
  return map[status] || status
}

/** 钩子来源中文标签 */
export function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    threshold: '阈值触发',
    session_end: '会话结束',
    manual: '手动',
  }
  return map[source] || source
}

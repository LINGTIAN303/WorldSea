export function useMessageTime() {
  function formatTime(ts: number): string {
    if (!ts) return ''
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  function formatDividerTime(ts: number): string {
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

  function shouldShowDivider(currentTs: number, prevTs: number | null, thresholdMs: number = 30 * 60 * 1000): boolean {
    if (prevTs === null) return true
    return currentTs - prevTs > thresholdMs
  }

  return {
    formatTime,
    formatDividerTime,
    shouldShowDivider,
  }
}

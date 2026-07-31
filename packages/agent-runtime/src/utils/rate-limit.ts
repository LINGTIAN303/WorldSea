interface UsageRecord {
  timestamp: number
  inputTokens: number
  outputTokens: number
  model: string
}

const usageHistory: UsageRecord[] = []
const MAX_HISTORY = 1000

const RATE_LIMITS = {
  requestsPerMinute: 30,
  requestsPerHour: 500,
}

const requestTimestamps: number[] = []

export function checkRateLimit(): { allowed: boolean; reason?: string } {
  const now = Date.now()
  const oneMinuteAgo = now - 60_000
  const oneHourAgo = now - 3_600_000

  const recentMinute = requestTimestamps.filter(t => t > oneMinuteAgo).length
  if (recentMinute >= RATE_LIMITS.requestsPerMinute) {
    return { allowed: false, reason: `超过每分钟 ${RATE_LIMITS.requestsPerMinute} 次限制` }
  }

  const recentHour = requestTimestamps.filter(t => t > oneHourAgo).length
  if (recentHour >= RATE_LIMITS.requestsPerHour) {
    return { allowed: false, reason: `超过每小时 ${RATE_LIMITS.requestsPerHour} 次限制` }
  }

  return { allowed: true }
}

export function recordRequest(): void {
  requestTimestamps.push(Date.now())
  while (requestTimestamps.length > RATE_LIMITS.requestsPerHour) {
    requestTimestamps.shift()
  }
}

export function recordUsage(model: string, inputTokens: number, outputTokens: number): void {
  usageHistory.push({ timestamp: Date.now(), inputTokens, outputTokens, model })
  while (usageHistory.length > MAX_HISTORY) usageHistory.shift()
}

export function getUsageSummary(): {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  last24hRequests: number
} {
  const now = Date.now()
  const oneDayAgo = now - 86_400_000
  const last24h = usageHistory.filter(r => r.timestamp > oneDayAgo)

  return {
    totalRequests: usageHistory.length,
    totalInputTokens: usageHistory.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: usageHistory.reduce((s, r) => s + r.outputTokens, 0),
    last24hRequests: last24h.length,
  }
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

let currentLevel: LogLevel = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV ? 'debug' : 'warn'

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel]
}

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString().slice(11, 19)
  return `[${ts}] [${level.toUpperCase()}] [${context}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`
}

export const logger = {
  debug(context: string, message: string, data?: unknown): void {
    if (shouldLog('debug')) console.log(formatMessage('debug', context, message, data))
  },
  info(context: string, message: string, data?: unknown): void {
    if (shouldLog('info')) console.info(formatMessage('info', context, message, data))
  },
  warn(context: string, message: string, data?: unknown): void {
    if (shouldLog('warn')) console.warn(formatMessage('warn', context, message, data))
  },
  error(context: string, message: string, data?: unknown): void {
    if (shouldLog('error')) console.error(formatMessage('error', context, message, data))
  },
}

import type { Terminal } from '@xterm/xterm'

type LogCategory = 'chat' | 'tool' | 'mcp' | 'cmd' | 'error'

const CATEGORY_STYLES: Record<LogCategory, { label: string; color: string }> = {
  chat: { label: '💬 chat', color: '\x1b[32m' },
  tool: { label: '🔧 tool', color: '\x1b[36m' },
  mcp: { label: '🌐 mcp', color: '\x1b[35m' },
  cmd: { label: '⌨️ cmd', color: '\x1b[33m' },
  error: { label: '⚠️ error', color: '\x1b[31m' },
}

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

export interface AgentLogEvent {
  type: string
  content?: string
  toolCall?: { name: string; args: Record<string, unknown> }
  success?: boolean
  result?: string
  error?: { message: string }
}

export class TerminalLogBridge {
  private terminal: Terminal | null = null
  private activeFilters: Set<LogCategory> = new Set(['chat', 'tool', 'mcp', 'cmd', 'error'])
  private paused = false

  attach(terminal: Terminal): void {
    this.terminal = terminal
  }

  detach(): void {
    this.terminal = null
  }

  setFilters(categories: LogCategory[]): void {
    this.activeFilters = new Set(categories)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  handleEvent(event: AgentLogEvent): void {
    if (this.paused || !this.terminal) return

    switch (event.type) {
      case 'message_end':
        if (this.activeFilters.has('chat') && event.content) {
          this.writeLine('chat', event.content.substring(0, 200))
        }
        break
      case 'tool_execution_start':
        if (this.activeFilters.has('tool') && event.toolCall) {
          this.writeLine('tool', `${event.toolCall.name}(${this.formatArgs(event.toolCall.args)})`)
        }
        break
      case 'tool_execution_end':
        if (this.activeFilters.has('tool')) {
          const status = event.success ? '✅' : '❌'
          this.writeLine('tool', `${status} ${event.result?.substring(0, 100) || ''}`)
        }
        break
      case 'error':
        if (this.activeFilters.has('error')) {
          this.writeLine('error', event.error?.message || 'Unknown error')
        }
        break
    }
  }

  writeCommandOutput(output: string): void {
    if (this.paused || !this.terminal) return
    if (!this.activeFilters.has('cmd')) return
    this.writeLine('cmd', output)
  }

  writeMcpLog(message: string): void {
    if (this.paused || !this.terminal) return
    if (!this.activeFilters.has('mcp')) return
    this.writeLine('mcp', message)
  }

  private writeLine(category: LogCategory, text: string): void {
    const style = CATEGORY_STYLES[category]
    const timestamp = DIM + new Date().toLocaleTimeString() + RESET
    const line = `${timestamp} ${style.color}${style.label}${RESET} ${text}\r\n`
    this.terminal!.write(line)
  }

  private formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args)
    if (entries.length === 0) return ''
    return entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v.substring(0, 50) : JSON.stringify(v)?.substring(0, 50)}`).join(', ').substring(0, 120)
  }
}

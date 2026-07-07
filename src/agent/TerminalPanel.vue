<template>
  <Transition name="ws-slide-up">
    <div v-if="visible" class="terminal-panel">
      <div class="terminal-toolbar">
        <span class="terminal-title"><WsIcon name="keyboard" size="xs" /> 终端</span>
        <div class="terminal-filters">
          <button v-for="f in filterOptions" :key="f.key"
            class="filter-btn" :class="{ active: filters.has(f.key) }"
            @click="toggleFilter(f.key)"><WsIcon :name="f.icon" size="xs" /></button>
        </div>
        <div class="terminal-actions">
          <button class="term-action-btn" @click="onClear" title="清屏"><WsIcon name="delete" size="xs" /></button>
          <button class="term-action-btn" @click="onTogglePause" title="暂停/恢复"><WsIcon :name="paused ? 'play' : 'pause'" size="xs" /></button>
          <button class="term-action-btn" @click="emit('close')">✕</button>
        </div>
      </div>
      <div ref="terminalContainer" class="terminal-container"></div>
      <div class="terminal-resize-handle" @mousedown.left="onResizeStart"></div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, watch, nextTick } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalLogBridge } from './TerminalLogBridge'
import { isTauri as detectTauri, createExecutionAdapter } from '@agent/execution'

type LogCategory = 'chat' | 'tool' | 'mcp' | 'cmd' | 'error'

const props = defineProps<{
  visible: boolean
  ptyId: string | null
  logBridge: TerminalLogBridge | null
}>()

const emit = defineEmits<{
  close: []
  resize: [height: number]
  'pty-input': [data: string]
  'pty-resize': [cols: number, rows: number]
}>()

const terminalContainer = ref<HTMLElement>()
const filters = ref<Set<LogCategory>>(new Set(['chat', 'tool', 'mcp', 'cmd', 'error']))
const paused = ref(false)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let unlistenPty: (() => void) | null = null

const filterOptions: { key: LogCategory; icon: string }[] = [
  { key: 'chat', icon: 'manuscript' },
  { key: 'tool', icon: 'settings' },
  { key: 'mcp', icon: 'globe' },
  { key: 'cmd', icon: 'keyboard' },
  { key: 'error', icon: 'warning' },
]

watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    initTerminal()
    if (props.ptyId) {
      await listenPtyOutput()
    }
  } else {
    destroyTerminal()
  }
})

watch(() => props.ptyId, async (newId) => {
  if (props.visible && newId && terminal) {
    await listenPtyOutput()
  }
})

watch(() => props.logBridge, (bridge) => {
  if (bridge && terminal) bridge.attach(terminal)
})

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function initTerminal(): void {
  if (terminal || !terminalContainer.value) return
  terminal = new Terminal({
    theme: {
      background: getCSSVar('--color-bg-surface') || '#1a1a2e',
      foreground: getCSSVar('--color-text-primary') || '#e0e0e0',
      cursor: getCSSVar('--color-primary') || '#6c5ce7',
      selectionBackground: getCSSVar('--color-primary-subtle') || 'rgba(108, 92, 231, 0.3)',
    },
    fontSize: 13,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    cursorBlink: true,
    convertEol: true,
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalContainer.value)
  fitAddon.fit()

  terminal.onData((data) => {
    emit('pty-input', data)
  })

  terminal.onResize(({ cols, rows }) => {
    if (props.ptyId) {
      emit('pty-resize', cols, rows)
    }
  })

  if (props.logBridge) props.logBridge.attach(terminal)
  terminal.write('\x1b[1;36m💻 WorldSmith Terminal\x1b[0m\r\n\r\n')
}

function destroyTerminal(): void {
  if (unlistenPty) { unlistenPty(); unlistenPty = null }
  if (props.logBridge) props.logBridge.detach()
  if (terminal) { terminal.dispose(); terminal = null }
  fitAddon = null
}

async function listenPtyOutput(): Promise<void> {
  if (!props.ptyId) return

  if (unlistenPty) { unlistenPty(); unlistenPty = null }

  if (detectTauri()) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenPty = await listen<string>(`pty-output-${props.ptyId}`, (event) => {
        if (terminal && !paused.value) {
          terminal.write(event.payload)
        }
      })
    } catch {}
  } else {
    try {
      const adapter = await createExecutionAdapter()
      if (!adapter.isAvailable()) {
        await adapter.tryConnect()
      }
      if (adapter.isAvailable()) {
        unlistenPty = await adapter.onPtyOutput(props.ptyId, (data) => {
          if (terminal && !paused.value) {
            terminal.write(data)
          }
        })
      } else {
        if (terminal) {
          terminal.write('\x1b[33m⚠ WebSocket 未连接，无法接收终端输出\x1b[0m\r\n')
        }
      }
    } catch (err) {
      if (terminal) {
        terminal.write(`\x1b[31m✕ 订阅终端输出失败: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`)
      }
    }
  }
}

function onClear(): void {
  if (terminal) terminal.clear()
}

function onTogglePause(): void {
  paused.value = !paused.value
  if (props.logBridge) props.logBridge.setPaused(paused.value)
}

function toggleFilter(key: LogCategory): void {
  const next = new Set(filters.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  filters.value = next
  if (props.logBridge) props.logBridge.setFilters([...next])
}

function onResizeStart(e: MouseEvent): void {
  const startY = e.clientY
  const startH = terminalContainer.value?.clientHeight ?? 200
  const onMove = (ev: MouseEvent) => {
    const delta = startY - ev.clientY
    const newH = Math.max(100, Math.min(600, startH + delta))
    emit('resize', newH)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (fitAddon) fitAddon.fit()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

onBeforeUnmount(() => {
  destroyTerminal()
})
</script>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  overflow: hidden;
}

.terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  user-select: none;
}

.terminal-title {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-family: sans-serif;
  flex-shrink: 0;
}

.terminal-filters {
  display: flex;
  gap: 2px;
  flex: 1;
}

.filter-btn {
  padding: 2px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-xs);
  opacity: 0.4;
  transition: opacity 0.15s;
}

.filter-btn.active { opacity: 1; }
.filter-btn:hover { opacity: 0.8; }

.terminal-actions {
  display: flex;
  gap: 4px;
}

.term-action-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: 2px 4px;
}

.term-action-btn:hover { color: var(--color-text-primary); }

.terminal-container {
  flex: 1;
  min-height: 150px;
  max-height: 400px;
  padding: 4px;
}

.terminal-resize-handle {
  height: 4px;
  cursor: ns-resize;
  background: transparent;
}

.terminal-resize-handle:hover {
  background: var(--color-primary-subtle);
}


</style>

import { ref } from 'vue'
import { createExecutionAdapter, resetExecutionAdapter } from '@agent/execution'
import type { ExecutionAdapter } from '@agent/execution/adapter'

export function useTerminal() {
  const terminalVisible = ref(false)
  const ptyId = ref<string | null>(null)
  const ptyReady = ref(false)

  let adapter: ExecutionAdapter | null = null

  async function getAdapter(): Promise<ExecutionAdapter> {
    if (!adapter) {
      adapter = await createExecutionAdapter()
    }
    return adapter
  }

  async function ensureAdapter(): Promise<ExecutionAdapter | null> {
    const a = await getAdapter()
    if (!a.isAvailable()) {
      const connected = await a.tryConnect()
      if (!connected) return null
    }
    return a
  }

  async function spawnPty(shell?: string, cwd?: string): Promise<string> {
    const a = await getAdapter()
    if (!a.isAvailable()) {
      const connected = await a.tryConnect()
      if (!connected) {
        throw new Error('终端功能当前不可用。Tauri 桌面模式请确认环境正常，Web 模式请启动 worldsmith-server 服务。')
      }
    }
    const id = `pty-${Date.now()}`
    await a.spawnPty(id, { shell: shell || null, cwd: cwd || null, cols: 80, rows: 24 })
    ptyId.value = id
    ptyReady.value = true
    return id
  }

  async function writeToPty(data: string): Promise<void> {
    if (!ptyId.value) return
    const a = await ensureAdapter()
    if (!a) return
    await a.writePty(ptyId.value, data)
  }

  async function resizePty(cols: number, rows: number): Promise<void> {
    if (!ptyId.value) return
    const a = await ensureAdapter()
    if (!a) return
    await a.resizePty(ptyId.value, cols, rows)
  }

  async function killPty(): Promise<void> {
    if (!ptyId.value) return
    const a = await getAdapter()
    try {
      await a.killPty(ptyId.value)
    } catch {}
    ptyId.value = null
    ptyReady.value = false
    if ('disconnect' in a) {
      (a as any).disconnect()
    }
    adapter = null
    resetExecutionAdapter()
  }

  async function onPtyOutput(callback: (data: string) => void): Promise<(() => void) | null> {
    if (!ptyId.value) return null
    const a = await getAdapter()
    return a.onPtyOutput(ptyId.value, callback)
  }

  function showTerminal(): void { terminalVisible.value = true }
  function hideTerminal(): void { terminalVisible.value = false }
  function toggleTerminal(): void { terminalVisible.value = !terminalVisible.value }

  return {
    terminalVisible,
    ptyId,
    ptyReady,
    spawnPty,
    writeToPty,
    resizePty,
    killPty,
    onPtyOutput,
    showTerminal,
    hideTerminal,
    toggleTerminal,
  }
}

import type { ExecutionAdapter } from './adapter'
import { TauriExecutionAdapter } from './tauri-adapter'
import { WebSocketExecutionAdapter } from './ws-adapter'
import { NodeExecutionAdapter, isNodeEnv } from './node-adapter'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
}

export function getWsUrl(): string {
  try {
    return localStorage.getItem('ws_server_url') || 'ws://localhost:3100'
  } catch {
    return 'ws://localhost:3100'
  }
}

let adapterInstance: ExecutionAdapter | null = null

export function createExecutionAdapter(): ExecutionAdapter {
  if (adapterInstance) return adapterInstance

  // 优先级：Node.js 后端 > Tauri 桌面 > 浏览器 WebSocket
  // NodeExecutionAdapter 直接用 child_process，避免 WS 客户端"连自己"死循环
  if (isNodeEnv()) {
    adapterInstance = new NodeExecutionAdapter()
  } else if (isTauri()) {
    adapterInstance = new TauriExecutionAdapter()
  } else {
    adapterInstance = new WebSocketExecutionAdapter({
      url: getWsUrl(),
      reconnect: true,
      maxRetries: 5,
    })
  }

  return adapterInstance
}

export function resetExecutionAdapter(): void {
  if (adapterInstance && 'disconnect' in adapterInstance) {
    (adapterInstance as any).disconnect()
  }
  adapterInstance = null
}

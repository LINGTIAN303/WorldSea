import type { ExecutionAdapter } from './adapter'
import { TauriExecutionAdapter } from './tauri-adapter'
import { WebSocketExecutionAdapter } from './ws-adapter'
import { isNodeEnv } from './env'

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

/**
 * 创建执行适配器
 *
 * 优先级：Node.js 后端 > Tauri 桌面 > 浏览器 WebSocket
 * NodeExecutionAdapter 直接用 child_process，避免 WS 客户端"连自己"死循环
 *
 * 注意：改为 async 以支持动态 import node-adapter（避免浏览器加载 child_process）
 */
export async function createExecutionAdapter(): Promise<ExecutionAdapter> {
  if (adapterInstance) return adapterInstance

  if (isNodeEnv()) {
    // 动态 import：仅在 Node 环境加载 child_process，浏览器不会加载此模块
    const { NodeExecutionAdapter } = await import('./node-adapter')
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

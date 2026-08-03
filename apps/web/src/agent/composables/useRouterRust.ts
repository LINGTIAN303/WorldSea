/**
 * P3-W5 Web 端 stub：Router（Rust-only 高级能力，Web 端不可用）
 *
 * 返回空状态 + no-op 方法。RouterStatusBar 因 sessions 恒空而 v-if 隐藏；
 * AgentChat 中 isRustBackend=false，/router 命令直接 warn 返回。
 * 具名类型宽松定义（index signature）以兼容状态栏组件的字段访问。
 */
import { ref } from 'vue'

export type RustProviderConfig = Record<string, unknown>
export interface RustRouteTarget {
  name: string
  keywords?: string[]
  description?: string
  [key: string]: any
}
export interface RouterEvent {
  type?: string
  [key: string]: any
}
export interface RouterSessionState {
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  decidedTargetName: string | null
  isFallback: boolean
  events: any[]
  [key: string]: any
}

export function useRouterRust() {
  /** 所有活跃 Router 会话状态映射（恒空） */
  const sessions = ref(new Map<string, RouterSessionState>())

  async function create(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  async function run(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  async function destroy(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  function generateSessionId(): string {
    return `router-web-${Date.now()}`
  }
  async function abort(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  async function getState(..._args: unknown[]): Promise<RouterSessionState> {
    return { runStatus: 'idle', decidedTargetName: null, isFallback: false, events: [] }
  }
  function subscribe(..._args: unknown[]): () => void {
    return () => {}
  }

  return {
    sessions,
    create,
    run,
    destroy,
    generateSessionId,
    abort,
    getState,
    subscribe,
  }
}

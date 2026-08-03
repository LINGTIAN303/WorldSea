/**
 * P3-W5 Web 端 stub：Multi-Agent 协作（Rust-only 高级能力，Web 端不可用）
 *
 * 返回空状态 + no-op 方法。MultiAgentStatusBar 因 sessions 恒空而 v-if 隐藏；
 * AgentChat 中 isRustBackend=false，/ma 命令直接 warn 返回。
 * 具名类型宽松定义（index signature）以兼容状态栏组件的字段访问。
 */
import { ref } from 'vue'

export type RustProviderConfig = Record<string, unknown>
export type RustAgentRole = 'coordinator' | 'researcher' | 'critic' | string
export interface RustAgentSpec {
  id: string
  name: string
  role: RustAgentRole
  description: string
  system_prompt?: string
  tools_whitelist?: string[] | null
  max_iterations?: number | null
  initial_message?: string | null
  [key: string]: any
}
export interface RustSharedBlackboard {
  shared_context: Record<string, string>
  agent_outputs: Record<string, string[]>
  [key: string]: any
}
export interface MultiAgentEvent {
  type?: string
  [key: string]: any
}
export interface MultiAgentSessionState {
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  blackboardSnapshot: RustSharedBlackboard | null
  events: any[]
  [key: string]: any
}

export function useMultiAgentRust() {
  /** 所有活跃 Multi-Agent 会话状态映射（恒空） */
  const sessions = ref(new Map<string, MultiAgentSessionState>())

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
    return `ma-web-${Date.now()}`
  }
  async function abort(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  async function getBlackboard(..._args: unknown[]): Promise<RustSharedBlackboard> {
    return { shared_context: {}, agent_outputs: {} }
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
    getBlackboard,
    subscribe,
  }
}

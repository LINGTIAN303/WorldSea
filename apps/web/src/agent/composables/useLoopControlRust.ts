/**
 * P3-W5 Web 端 stub：Loop Control（Rust-only 高级能力，Web 端不可用）
 *
 * 返回空状态 + no-op 方法。LoopControlStatusBar 因 tasks 恒空而 v-if 隐藏；
 * AgentChat 中 isRustBackend=false，create/destroy 不会被调用。
 * 具名类型对齐真实实现（apps/tauri 版）字段结构，兼容状态栏组件类型检查。
 */
import { ref } from 'vue'

export interface LoopControlEvent {
  type?: string
  [key: string]: any
}

export interface RustRateLimitExceeded {
  type: 'turns' | 'tool_calls' | 'tokens' | 'duration'
  current: any
  max: any
  rateLimitExceeded: RustRateLimitExceeded | null
  softTimeoutLevel: string | null
  watchdogAlert: { level: string } | null
  [key: string]: any
}

export interface RustLoopControlStatus {
  taskId: string
  turns: number
  toolCalls: number
  tokens: number
  elapsedMs: number
  rateLimitExceeded: RustRateLimitExceeded | null
  softTimeoutLevel: string | null
  watchdogAlert: { level: string } | null
  createdAt: number
  [key: string]: any
}

export interface RustLoopControlState {
  taskId: string
  status: RustLoopControlStatus | null
  [key: string]: any
}

export function useLoopControlRust() {
  /** 所有活跃 Loop Control 任务状态映射（恒空） */
  const tasks = ref(new Map<string, RustLoopControlState>())

  async function create(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  async function destroy(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  async function check(..._args: unknown[]): Promise<RustLoopControlStatus | null> {
    return null
  }
  async function getStatus(..._args: unknown[]): Promise<RustLoopControlStatus | null> {
    return null
  }
  function subscribe(..._args: unknown[]): () => void {
    return () => {}
  }

  return {
    tasks,
    create,
    destroy,
    check,
    getStatus,
    subscribe,
  }
}

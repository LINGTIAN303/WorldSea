/**
 * P3-W5 Web 端 stub：Tree of Thoughts（Rust-only 高级能力，Web 端不可用）
 *
 * 返回空状态 + no-op 方法。ToTStatusBar/ToTTreeView 因 sessions 恒空而 v-if 隐藏；
 * AgentChat 中 isRustBackend=false，/tot 命令直接 warn 返回。
 * 具名类型宽松定义（index signature）以兼容状态栏组件的字段访问。
 */
import { ref } from 'vue'

export type RustProviderConfig = Record<string, unknown>
export type RustThoughtNodeStatus = 'pending' | 'scored' | 'expanded' | 'pruned' | 'goal'
export interface RustThoughtNode {
  id: string
  parent_id: string | null
  thought: string
  status: RustThoughtNodeStatus
  score: number | null
  [key: string]: any
}
export interface RustToTTreeSnapshot {
  sessionId: string
  nodes: RustThoughtNode[]
  [key: string]: any
}
export interface ToTEvent {
  type?: string
  [key: string]: any
}
export interface ToTSessionState {
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  nodesCreated: number
  currentMaxDepth: number
  bestScore: number | null
  treeSnapshot: RustToTTreeSnapshot | null
  [key: string]: any
}

export function useToTRust() {
  /** 所有活跃 ToT 会话状态映射（恒空） */
  const sessions = ref(new Map<string, ToTSessionState>())

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
    return `tot-web-${Date.now()}`
  }
  async function abort(..._args: unknown[]): Promise<void> {
    // Web 端 no-op（Rust-only）
  }
  async function getTree(..._args: unknown[]): Promise<RustToTTreeSnapshot> {
    return { sessionId: _args[0] as string, nodes: [] }
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
    getTree,
    subscribe,
  }
}

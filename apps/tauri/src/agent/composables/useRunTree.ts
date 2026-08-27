/**
 * useRunTree：会话 run 树数据适配（M3-RK1 前端可视化数据源）
 *
 * 消费 Rust `list_session_runs`（RunStore 纯内存，重启蒸发）：
 * - 扁平 run 数组 → 按 parent_run_id 分组建树（父不在列表的孤儿挂根层，
 *   与 OrchestratorPanel.treeRoots 同策略）
 * - 刷新时机：切换会话 / 切到轨迹 tab / 手动刷新按钮（不轮询）
 * - 状态/管线名解析下沉，组件只做渲染（单一数据源）
 *
 * 详细见 docs/plans/编排模式投放设计/ 下 run 树可视化设计。
 */
import { ref, shallowRef } from 'vue'
import { invoke } from './transport'
import { useAgentRust } from './useAgentRust'

/** 后端 OrchestrationRun 镜像（Rust snake_case 序列化） */
export interface RunRecord {
  run_id: string
  session_id: string
  parent_run_id: string | null
  status: 'running' | 'completed' | 'aborted' | 'error' | 'timeout' | 'interrupted'
  converge_reason?: string | null
  pipeline?: string | null
  artifacts: Array<{ artifact_id: string; summary?: string; kind?: unknown }>
  decisions?: Array<{ kind: string }>
  started_at?: number | null
  finished_at?: number | null
  final_message?: string | null
}

/** run 树节点（children 嵌套；顶层 = 根 run 列表） */
export interface RunTreeNode {
  run: RunRecord
  children: RunTreeNode[]
}

/** 管线名 → 中文标签（复用 OrchestrationSegment 映射 + react/sub 补充） */
const PIPELINE_LABELS: Record<string, string> = {
  'research-plan': '规划执行',
  'quick-plan': '规划执行',
  tot: '思维树探索',
  got: '思维图聚合',
  supervisor: '监督委派',
  'multi-agent': '多智能体协作',
  react: '快问答',
}

/** 状态 → 中文标签（与 RunStatus 六值对齐） */
const STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  completed: '已完成',
  aborted: '已中止',
  error: '失败',
  timeout: '超时',
  interrupted: '已中断',
}

/** 管线名解析：`sub:writer` → 「委派 · writer」；已知预设取中文；未知原样返回 */
export function pipelineLabel(pipeline?: string | null): string {
  if (!pipeline) return '未知管线'
  if (pipeline.startsWith('sub:')) return `委派 · ${pipeline.slice(4)}`
  return PIPELINE_LABELS[pipeline] ?? pipeline
}

/** 状态中文标签（未知回退原值） */
export function runStatusLabel(status: RunRecord['status']): string {
  return STATUS_LABELS[status] ?? status
}

/** 扁平 run 数组 → 树（顶层按 started_at 升序；父未到的孤儿挂根层） */
export function buildRunTree(records: RunRecord[]): RunTreeNode[] {
  if (!records.length) return []
  const byId = new Map<string, RunTreeNode>()
  for (const r of records) {
    byId.set(r.run_id, { run: r, children: [] })
  }
  const roots: RunTreeNode[] = []
  const orphans: RunTreeNode[] = []
  for (const r of records) {
    const node = byId.get(r.run_id)!
    const pid = r.parent_run_id
    const parent = pid ? byId.get(pid) : undefined
    if (parent && parent !== node) {
      parent.children.push(node)
    } else {
      orphans.push(node)
    }
  }
  const sortByStarted = (a: RunTreeNode, b: RunTreeNode) =>
    (a.run.started_at ?? 0) - (b.run.started_at ?? 0)
  orphans.sort(sortByStarted)
  roots.push(...orphans)
  return roots
}

/** 模块级单例：复用 useAgentRust 的当前会话 ref（同一引用） */
const { currentSessionId } = useAgentRust()

export function useRunTree() {
  /** run 树顶层节点（渲染消费；shallowRef 减少深响应开销） */
  const runTree = shallowRef<RunTreeNode[]>([])
  const loading = ref(false)
  const error = ref('')
  /** 最近一次成功刷新时间（空态展示用） */
  const lastRefreshedAt = ref<number | null>(null)

  /** 拉取当前会话全部 run 并建树；无会话时清空 */
  async function refresh(): Promise<void> {
    const sid = currentSessionId.value
    if (!sid) {
      runTree.value = []
      return
    }
    loading.value = true
    error.value = ''
    try {
      const records = await invoke<RunRecord[]>('list_session_runs', { sessionId: sid })
      runTree.value = buildRunTree(records ?? [])
      lastRefreshedAt.value = Date.now()
    } catch (err) {
      // 弱提示：run 树不可用不阻断面板（后端/桥不可用时仅展示错误一行）
      error.value = err instanceof Error ? err.message : String(err)
      runTree.value = []
      console.warn('[useRunTree] list_session_runs 失败:', err)
    } finally {
      loading.value = false
    }
  }

  return {
    runTree,
    loading,
    error,
    lastRefreshedAt,
    refresh,
  }
}

/**
 * 会话分支（UX-a）：分叉 / 回滚 / 检查点
 *
 * 后端命令面 S3-e2 已就绪（`fork_session` / `rewind_session` / `create_checkpoint` /
 * `list_checkpoints`），本模块补前端接线：
 * - 数据：`list_request_boundaries`（UX-a 新增查询命令——`request_seq` 此前前端不可达）；
 * - 事件：`agent:event:session_branch:{session_id}`（forked / rewound / checkpoint_created）；
 * - 匹配：消息行 → 请求边界（`userText` 等值 + 时间就近；**匹配不到返回 null**，绝不猜锚点）。
 *
 * 反馈口径：命令只触发、**事件才反馈**（toast / 刷新 / 切换由 `setupBranchListener`
 * 的 hooks 承担）——避免「命令返回 + 事件到达」双提示。
 *
 * 设计依据：docs/plans/2026-09-21-ZCode能力内化方向探究/14-前端UX批施工计划.md §二 UX-a。
 */
import { ref, watch } from 'vue'
import { useConfirm } from '@worldsea/ui-kit'

import { toastError, toastWarn } from '@/composables/useToast'

import { invoke, listen, type UnlistenFn } from './transport'

// ─── 数据类型（Rust 侧 serde 口径）────────────────

/** 请求边界（`list_request_boundaries`；serde camelCase） */
export interface RequestBoundaryDto {
  requestSeq: number
  capturedAtMs: number
  purpose: string
  modelId: string
  userText: string | null
  checkpointId: string | null
  checkpointKind: string | null
}

/** 检查点定位（`CheckpointAnchor`；serde tag=kind snake_case） */
export type CheckpointAnchor =
  | { kind: 'request_boundary'; request_seq: number }
  | { kind: 'task_progress'; task_id: string }

/** 统一检查点引用（`CheckpointRef`；serde snake_case） */
export interface CheckpointRef {
  id: string
  session_id?: string | null
  anchor: CheckpointAnchor
  created_at_ms: number
}

/** 会话分支事件（`agent:event:session_branch:{session_id}` 载荷） */
export type SessionBranchEvent =
  | { type: 'forked'; sessionId: string; childSessionId: string; requestSeq: number }
  | { type: 'rewound'; sessionId: string; requestSeq: number; dropped: number; kept: number }
  | { type: 'checkpoint_created'; sessionId: string; requestSeq: number; kind: string }

/** 分叉返回（SessionInfo 最小面） */
export interface ForkedSessionInfo {
  id: string
  title?: string
}

/** 事件回调（由 useAgentRust 注入：能访问 switchSession / refreshSessionList） */
export interface BranchEventHooks {
  onForked?: (childSessionId: string, requestSeq: number) => void
  onRewound?: (requestSeq: number, dropped: number, kept: number) => void
  /** auto（每 10 请求自动打点）与 manual 均会触发；提示与否由调用方决定 */
  onCheckpointCreated?: (requestSeq: number, kind: string) => void
}

// ─── 状态（模块级单例：与 useSessionViewState 同款）────────────────

const boundaries = ref<RequestBoundaryDto[]>([])
const checkpoints = ref<CheckpointRef[]>([])
/** 工作区文件操作（W 批；面板「文件 ×N」徽标聚合用） */
const workspaceOps = ref<WorkspaceFileOp[]>([])
/** 历史抽屉显隐（SessionSidebar 入口与 SessionBranchPanel 共享——模块单例） */
const panelOpen = ref(false)

export function openBranchPanel(): void {
  panelOpen.value = true
}

export function closeBranchPanel(): void {
  panelOpen.value = false
}

// ─── 命令面 ─────────────────────────────────

/** 拉取请求边界列表（降序；`limit<=0` 不截断）并写入共享状态 */
export async function loadBoundaries(sessionId: string, limit = 0): Promise<RequestBoundaryDto[]> {
  const list = await invoke<RequestBoundaryDto[]>('list_request_boundaries', { sessionId, limit })
  boundaries.value = Array.isArray(list) ? list : []
  return boundaries.value
}

/** 拉取检查点（会话锚点 + 任务断点合并视图，降序） */
export async function loadCheckpoints(sessionId: string, limit = 0): Promise<CheckpointRef[]> {
  const list = await invoke<CheckpointRef[]>('list_checkpoints', { sessionId, limit })
  checkpoints.value = Array.isArray(list) ? list : []
  return checkpoints.value
}

/** 拉取工作区文件操作（W 批；降序，面板「文件 ×N」徽标聚合用） */
export async function loadWorkspaceOps(sessionId: string, limit = 500): Promise<WorkspaceFileOp[]> {
  const list = await invoke<WorkspaceFileOp[]>('list_workspace_ops', { sessionId, limit })
  workspaceOps.value = Array.isArray(list) ? list : []
  return workspaceOps.value
}

/** 从请求边界分叉（返回子会话；子会话继承父 Provider 配置，不自动运行） */
export async function forkAt(sessionId: string, requestSeq: number): Promise<ForkedSessionInfo> {
  return invoke<ForkedSessionInfo>('fork_session', { sessionId, requestSeq })
}

/**
 * 回滚到请求边界（日志不删、可再回退）。
 *
 * 失败（会话不存在 / 运行中拒绝 / 链缺该序号）原样抛出——由调用方提示。
 */
export async function rewindAt(sessionId: string, requestSeq: number): Promise<void> {
  await invoke('rewind_session', { sessionId, requestSeq })
}

/** 手动打点检查点（锚点 = 当前请求边界；无边界拒绝）→ 返回检查点 id */
export async function createCheckpoint(sessionId: string): Promise<string> {
  return invoke<string>('create_checkpoint', { sessionId })
}

// ─── 确认 + 执行封装（消息行与历史抽屉共用：文案与错误提示单点）────

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 确认弹窗 + 分叉（消息行与抽屉共用）。
 *
 * 返回 `true` = 已发起（成功与否由后续 `forked` 事件反馈）；`false` = 用户取消或失败
 * （失败已 toast——命令错误没有事件，提示必须就地给）。
 */
export async function forkAtConfirmed(sessionId: string, requestSeq: number): Promise<boolean> {
  const { confirm } = useConfirm()
  const ok = await confirm({
    type: 'info',
    title: '从此处分叉',
    description: `将从请求 #${requestSeq} 创建新会话（继承截至该处的对话历史与模型配置，不自动运行）。`,
    confirmText: '分叉',
    cancelText: '取消',
    position: 'bottom',
  })
  if (!ok) return false
  try {
    await forkAt(sessionId, requestSeq)
    return true
  } catch (err) {
    toastError(`分叉失败：${errText(err)}`)
    return false
  }
}

/** 工作区回滚明细报告（Rust `WorkspaceRewindReport`；serde camelCase） */
export interface WorkspaceRewindReport {
  restored: number
  removed: number
  failed: Array<{ path: string; reason: string }>
}

/** 工作区文件操作行（Rust `WorkspaceFileOp`；面板徽标用） */
export interface WorkspaceFileOp {
  requestSeq: number
  path: string
  beforeHash: string | null
  op: string
  atMs: number
}

/**
 * 确认弹窗 + 回滚（运行中会被后端拒绝 → 就地提示）。
 *
 * W 批：弹窗带「同时回滚文件」复选框（默认勾选，Q2）——勾选则**先恢复工作区文件、
 * 再回退会话视图**。文件**逐条失败**（报告 `failed` 非空）不阻断会话回滚（另行提示）；
 * 文件命令**级失败**（IPC/守卫拒绝）则整体失败、会话不动（保持一致态）。
 *
 * 返回 `true` = 已发起（成功由 `rewound` 事件反馈）；`false` = 取消或失败。
 */
export async function rewindAtConfirmed(sessionId: string, requestSeq: number): Promise<boolean> {
  const { confirmWithCheckbox } = useConfirm()
  const { ok, checked } = await confirmWithCheckbox({
    type: 'danger',
    title: '回滚到此处',
    description:
      `将把本会话的活动视图回退到请求 #${requestSeq}；日志不删除、可再次回退。\n` +
      '运行中的任务会被拒绝——请先中断再回滚。',
    confirmText: '回滚',
    cancelText: '取消',
    position: 'bottom',
    checkbox: { label: '同时回滚文件（恢复 Agent 改动过的文件）', defaultChecked: true },
  })
  if (!ok) return false
  try {
    if (checked) {
      const report = await invoke<WorkspaceRewindReport>('rewind_workspace', {
        sessionId,
        requestSeq,
      })
      if (report.failed.length > 0) {
        const head = report.failed
          .slice(0, 3)
          .map((f) => f.path)
          .join('；')
        toastWarn(
          `文件回滚完成（恢复 ${report.restored} / 删除 ${report.removed}），` +
            `${report.failed.length} 项未处理：${head}`,
        )
      }
    }
    await rewindAt(sessionId, requestSeq)
    return true
  } catch (err) {
    toastError(`回滚失败：${errText(err)}`)
    return false
  }
}

/** 手动打点 + 提示（失败就地 toast；成功由 `checkpoint_created` 事件提示） */
export async function createCheckpointConfirmed(sessionId: string): Promise<boolean> {
  try {
    await createCheckpoint(sessionId)
    return true
  } catch (err) {
    toastError(`打点失败：${errText(err)}`)
    return false
  }
}

// ─── 事件监听（按会话注册；幂等）────────────────

const branchUnlistenFns = new Map<string, UnlistenFn>()

/**
 * 为指定会话设置分支事件监听（幂等：已存在则直接返回）。
 *
 * 事件 → hooks（无内置 toast——提示口径由调用方统一）。
 */
export async function setupBranchListener(
  sessionId: string,
  hooks: BranchEventHooks = {},
): Promise<void> {
  if (branchUnlistenFns.has(sessionId)) return
  const eventName = `agent:event:session_branch:${sessionId}`
  try {
    const unlisten = await listen<SessionBranchEvent>(eventName, (e) => {
      const p = e.payload
      if (!p || typeof p.type !== 'string') return
      if (p.type === 'forked') hooks.onForked?.(p.childSessionId, p.requestSeq)
      else if (p.type === 'rewound') hooks.onRewound?.(p.requestSeq, p.dropped, p.kept)
      else if (p.type === 'checkpoint_created') hooks.onCheckpointCreated?.(p.requestSeq, p.kind)
    })
    branchUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useSessionBranch] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的分支事件监听 */
export function teardownBranchListener(sessionId: string): void {
  const unlisten = branchUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    branchUnlistenFns.delete(sessionId)
  }
}

// ─── 消息行 → 请求边界匹配 ────────────────────────

/** 摘要比对长度（与 Rust `USER_TEXT_PREVIEW_CHARS` 一致：后端已按此截断） */
export const USER_TEXT_PREVIEW_CHARS = 120

/** 按字符截断（与 Rust `chars().take` 同口径；emoji 代理对安全） */
function takeChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join('')
}

/**
 * 消息行 → 请求边界匹配（`userText` 等值 + 时间就近消歧）。
 *
 * 返回 `null` = 匹配不到（调用方**不显示**分叉 / 回滚入口——绝不猜锚点）。
 */
export function matchBoundaryForTurn(
  list: ReadonlyArray<RequestBoundaryDto>,
  userText: string,
  timestampMs?: number,
): RequestBoundaryDto | null {
  const want = takeChars(userText.trim(), USER_TEXT_PREVIEW_CHARS)
  if (!want) return null
  const candidates = list.filter(
    (b) => b.userText != null && takeChars(b.userText.trim(), USER_TEXT_PREVIEW_CHARS) === want,
  )
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  // 相同文本多次出现（重复提问）→ 取采集时间与消息时间最近的一条
  if (typeof timestampMs === 'number' && Number.isFinite(timestampMs)) {
    return candidates.reduce((best, cur) =>
      Math.abs(cur.capturedAtMs - timestampMs) < Math.abs(best.capturedAtMs - timestampMs)
        ? cur
        : best,
    )
  }
  return candidates[0]
}

// ─── 消息区接线桥 ────────────────────────────────

/** 消息行最小面（避免 shared-ui 类型反向依赖：只取匹配所需两字段） */
export interface BranchMessageLike {
  content?: string
  timestamp?: number
}

/**
 * 消息区接线桥：把「消息行 → 请求边界」匹配与执行收敛为一处（组件里只留 3 行）。
 *
 * - `getSessionId` / `getTurnCount` 以 getter 传入（组件侧响应式源）：
 *   会话切换 → 拉边界；轮次数变化（每轮结束 +1）→ 刷新（新请求边界随之可见）；
 * - `branchable(msg)`：消息行按钮显隐判定（匹配不到 → false，按钮不出现）；
 * - `onBranch(payload)`：执行（命令成功后就地刷新边界；事件反馈见 setupBranchListener）。
 */
export function useBranchMessageBridge(
  getSessionId: () => string | null,
  getTurnCount: () => number,
): {
  branchable: (msg: BranchMessageLike) => boolean
  onBranch: (payload: { action: 'fork' | 'rewind'; msg: BranchMessageLike }) => Promise<void>
} {
  watch(
    [getSessionId, getTurnCount],
    ([sid]) => {
      if (!sid) {
        boundaries.value = []
        return
      }
      void loadBoundaries(sid).catch((err) =>
        console.warn('[useSessionBranch] 加载请求边界失败:', err),
      )
    },
    { immediate: true },
  )

  function branchable(msg: BranchMessageLike): boolean {
    return matchBoundaryForTurn(boundaries.value, msg.content || '', msg.timestamp) !== null
  }

  async function onBranch(payload: {
    action: 'fork' | 'rewind'
    msg: BranchMessageLike
  }): Promise<void> {
    const sid = getSessionId()
    if (!sid) return
    const hit = matchBoundaryForTurn(boundaries.value, payload.msg.content || '', payload.msg.timestamp)
    if (!hit) return
    const ok =
      payload.action === 'fork'
        ? await forkAtConfirmed(sid, hit.requestSeq)
        : await rewindAtConfirmed(sid, hit.requestSeq)
    if (ok) await loadBoundaries(sid)
  }

  return { branchable, onBranch }
}

// ─── 组合式入口 ────────────────────────────────

export function useSessionBranch() {
  return {
    boundaries,
    checkpoints,
    workspaceOps,
    loadWorkspaceOps,
    panelOpen,
    openBranchPanel,
    closeBranchPanel,
    loadBoundaries,
    loadCheckpoints,
    forkAt,
    rewindAt,
    createCheckpoint,
    forkAtConfirmed,
    rewindAtConfirmed,
    createCheckpointConfirmed,
    setupBranchListener,
    teardownBranchListener,
    matchBoundaryForTurn,
  }
}

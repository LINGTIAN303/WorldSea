/**
 * 轮次（Turn）状态模型：事件归约器 + 回源重建
 *
 * 流区域三层结构的唯一事实源：① 用户消息层 / ② 过程层（所有行段）/ ③ 结果层。
 * 实时流与回源重建走同一套归约规则，保证两者产出结构一致（消除"两套 DOM"）。
 *
 * 设计决策详见 docs/plans/2026-08-29-stream-render-layer-plan.md §三
 * 详细注释详见 docs/details/注释/packages/shared-composables/agent/turnModel.md
 */

import type { ImageAttachment, FileAttachment } from '@agent/index'

// ─── 动作类型（不止工具调用）──────────────────────────────────

/**
 * 动作行段的类型：LLM 消息中一次工具调用或其他的执行
 *
 * 持久化可行性（回源能否重建）标注：
 * - tool      可回源：assistant.tool_calls 给 name/args，tool_result 消息按 tool_call_id 给 result
 * - plan      可回源：get_state 快照携带 plan
 * - subagent  暂不可回源：SubAgent* 事件仅存于前端内存 subAgents
 * - a2ui      暂不可回源：A2UIEvent 仅存于前端内存 a2uiSurfaces
 * - confirm   交互态：历史无需完整还原
 * - phase     暂不可回源：编排轨迹仅存于前端内存 useOrchestrationTrace
 * - router    暂不可回源：RouterDecisionMade 未转发至前端
 * - reflection 暂不可回源：ReflectionResult 前端未消费
 */
export type ActionKind =
  | 'tool'
  | 'subagent'
  | 'plan'
  | 'a2ui'
  | 'confirm'
  | 'phase'
  | 'router'
  | 'reflection'

/** 动作执行状态（'pending' 供计划步骤初始态：plan_created 生成后未开始执行） */
export type ActionStatus = 'running' | 'completed' | 'failed' | 'skipped' | 'pending'

// ─── 行段 ────────────────────────────────────────────

/** 行段基类：唯一 id 供窗口化锚定与高度缓存使用 */
interface SegmentBase {
  id: string
  timestamp: number
}

/** 推理行段：一段连续 reasoning；reasoning/content 交错时会被切成多段 */
export interface ThinkSegment extends SegmentBase {
  kind: 'think'
  text: string
  status: 'streaming' | 'complete'
}

/** 动作行段：一次执行（工具调用 / 委派 / 计划 / 界面操作 等） */
export interface ActionSegment extends SegmentBase {
  kind: 'action'
  action: ActionKind
  status: ActionStatus
  /** 主标题：工具名 / 子 Agent 名 / 阶段名 */
  label: string
  /** 行段种类（v2 数据模型）：由工具名在归约时推导，渲染层按此分行卡（搜索/终端/文件/命令/工具/其他） */
  rowKind: ActionRowKind
  /** 关联 id（tool_call_id / subAgentId / planItemId），回源时用于配对 start 与 end */
  refId?: string
  args?: Record<string, unknown>
  result?: unknown
  error?: string
  /** 执行耗时（毫秒，H7 P0.5 事件权威字段）；旧事件/历史回源无此字段则不显示 */
  durationMs?: number
  /**
   * 2026-09-02 计划步骤行（plan 类动作段）：计划步骤并入过程层行段。
   * 该步骤执行期间的工具动作段 id 记入 `childRefIds`，渲染层据此把子动作行包进
   * 可折叠容器（默认折叠可展开，用户确认的骨架形态）。仅实时流归约维护；回源不重建。
   */
  isPlanStep?: boolean
  childRefIds?: string[]
  /** 2026-09-02 计划步骤默认折叠态（新增步骤折叠；渲染层经 plan_step_toggle 事件驱动） */
  stepCollapsed?: boolean
  /** 2026-09-02 系统工具流式：bash/powershell 增量输出累积（tool_delta 事件追加） */
  stream?: string
  /** 2026-09-02 系统工具流式：stream 达到字符上限后丢弃旧内容（丢旧保新），置真供渲染层提示 */
  streamTruncated?: boolean
  /** 2026-09-02 系统工具流式：文件变更 diff（file_change 事件；绿红对比 + 路径渲染） */
  fileChange?: {
    path: string
    kind: string
    hunks: Array<{ removed?: string[]; added?: string[]; truncated_at?: boolean }>
  }
}

/**
 * 2026-09-02 系统工具流式：stream 字符上限（UTF-16 code unit）。
 * bash/powershell 长输出只保留末尾，丢旧保新（对齐 SessionOutputBuf 64KiB 语义），
 * 超限后置 `streamTruncated`。防大输出在段上无限累积撑爆内存/渲染。
 */
export const TOOL_STREAM_LIMIT = 20_000

/**
 * 行段种类（行段模型 v2）：动作行段的视觉容器类型（数据层分类，与 UI 层
 * toolSemantics 的「操作动词」细分解耦——本分类回答"这是什么种类的行卡"）。
 * 对齐用户定义的行段谱系：搜索段 / 终端段 / 文件段 / 命令段 / 工具段 / 其他段。
 */
export type ActionRowKind = 'search' | 'terminal' | 'file' | 'command' | 'tool' | 'other'

/**
 * 工具名 → 行段种类。前缀/名单匹配，未知工具归 'other'（其他段）。
 * 规则与后端 tools.rs 工具组命名对齐（fs_tools / terminal 会话 / 桥工具），
 * 新工具组接入时在此补一条前缀即可。
 */
export function classifyActionRowKind(label: string): ActionRowKind {
  // 终端段：持久终端会话
  if (/^(shell_session_|detect_shells|detect_terminal)/.test(label)) return 'terminal'
  // 命令段：一次性命令执行
  if (/^(execute_command|code_execute|notebook_execute_code|git_|pkg_|start_server|sys_info)/.test(label))
    return 'command'
  // 搜索段：文件/内容/知识库/图/Web 检索
  if (/(search|_find_path)$/.test(label) || /^(web_search|kb_search|graph_find)/.test(label)) return 'search'
  // 文件段：真文件 CRUD（业务文档工具归工具段，见下）
  if (/^(file_|fs_|read_file|write_file|edit_file|retrofit_)/.test(label)) return 'file'
  // 工具段：已登记的业务工具（实体/关系/笔记/大纲/时间线/手稿/_schema/知识库/UI/工作流…）
  if (
    /^(entity_|relation_|notebook_|mindmap_|outline_|timeline_|manuscript_|schema_|kb_read|kb_delete|ui_|magic_|workflow_|plan_|persona_|memory_delete|graph_)/.test(
      label,
    )
  )
    return 'tool'
  return 'other'
}

/** 文本行段：一轮 LLM 输出的文本；resultCandidate 为真表示是结果层候选 */
export interface TextSegment extends SegmentBase {
  kind: 'text'
  text: string
  status: 'streaming' | 'complete'
  /** 结果层候选：若后续出现动作段，则降级为过程文本段 */
  resultCandidate: boolean
}

export type Segment = ThinkSegment | ActionSegment | TextSegment

// ─── 轮次 ────────────────────────────────────────────

/** 用户消息（① 用户消息层） */
export interface TurnUserMessage {
  id: string
  text: string
  timestamp: number
  images?: ImageAttachment[]
  files?: FileAttachment[]
}

/** 轮次状态 */
export type TurnStatus = 'streaming' | 'complete' | 'error' | 'aborted'

/**
 * 轮次 = 用户消息 + LLM 消息
 *
 * segments 为 ② 过程层的全部行段；resultId 指向其中被固化为 ③ 结果层的文本段。
 * 渲染时：`segments` 中 id === resultId 的渲染为结果层，其余渲染为过程层。
 */
export interface Turn {
  id: string
  userMessage: TurnUserMessage
  segments: Segment[]
  /** 结果层文本段 id；null 表示结果层尚未落地 */
  resultId: string | null
  /** 当前结果层候选段 id，用于 O(1) 定位与降级 */
  candidateId: string | null
  status: TurnStatus
  /** ② 过程层折叠态（由自动折叠控制器与用户手动操作共同驱动） */
  processCollapsed: boolean
  /**
   * 2026-09-02 计划步骤串行执行（激进方案）：当前「激活」的计划步骤段 id。
   * 由 plan_step_status(running) 置位、completed/skipped/failed 清除。
   * 该步骤运行期间产生的所有输出（思维链/文本/工具动作）归入其 childRefIds——
   * 实现「步骤内包含该步骤的完整执行过程」，Agent 显式串行推进步骤。
   */
  activePlanStepId?: string
  /**
   * 用户是否从折叠态手动展开过过程层（常驻折叠行标记，2026-08-30）
   * 为真时展开态在过程行段上方渲染一条「收起」头行，用户可再次折叠——
   * 否则展开后摘要行消失、无法收回。仅影响渲染，不参与折叠判定。
   */
  processPeeked?: boolean
  /** 用户是否曾展开过本轮次的任何行段（latch：展开了又收起仍为 true，用于折叠条件 2/3 的分派） */
  userEverExpanded: boolean
  /** 自动折叠是否已执行过（latch：每个轮次只自动折叠一次，避免反复折叠打扰阅读） */
  hasAutoCollapsed: boolean
  startedAt: number
  endedAt?: number
}

// ─── 事件 ────────────────────────────────────────────

/**
 * 归约器输入事件（与传输层事件解耦：由 useAgentRust 把各通道事件翻译为本类型）
 */
export type TurnEvent =
  /** 开新轮次（prompt 调用时） */
  | { type: 'turn_start'; turnId: string; userMessage: TurnUserMessage }
  /** LLM 子轮开始（StreamStart） */
  | { type: 'round_start'; turnId: string }
  /** 推理增量（ReasoningDelta） */
  | { type: 'reasoning'; turnId: string; delta: string }
  /** 正文增量（StreamDelta） */
  | { type: 'text_delta'; turnId: string; delta: string }
  /** 动作开始（ToolCallStart / SubAgentStarted / PlanCreated ...） */
  | {
      type: 'action_start'
      turnId: string
      id: string
      action: ActionKind
      label: string
      refId?: string
      args?: Record<string, unknown>
    }
  /** 动作结束（ToolCallEnd / SubAgentCompleted / PlanStepUpdate ...） */
  | {
      type: 'action_end'
      turnId: string
      refId: string
      status: Extract<ActionStatus, 'completed' | 'failed' | 'skipped'>
      result?: unknown
      error?: string
      /** 执行耗时（毫秒，H7 P0.5 事件权威字段） */
      durationMs?: number
    }
  /** LLM 子轮结束（StreamEnd，fullText 为权威文本，用于校正增量丢失）
   *  textId：回源时可指定文本段 id，复用持久化消息 id 以对齐实时态 */
  | { type: 'round_end'; turnId: string; fullText?: string; textId?: string }
  /** 动作结束兜底：收口仍未完成的动作段（工具被中断/异常终止时不会有 ToolCallEnd 到达） */
  | { type: 'actions_settle'; turnId: string }
  /** 用户展开了本轮次的某个行段（latch：置 userEverExpanded，供折叠条件分派） */
  | { type: 'turn_expanded'; turnId: string }
  /** 自动折叠执行（latch：置 processCollapsed + hasAutoCollapsed，每轮次只自动折叠一次） */
  | { type: 'auto_collapse'; turnId: string }
  /** 2026-09-02 用户展开/收起某个计划步骤（plan 步骤行的折叠态；基于 id 定位历史轮次） */
  | { type: 'plan_step_toggle'; turnId: string; stepId: string }
  /** 2026-09-02 计划步骤状态流转（plan_update：in_progress→激活 running；completed/skipped/failed→收口）。仅实时流。 */
  | {
      type: 'plan_step_status'
      turnId: string
      stepId: string
      status: Extract<ActionStatus, 'running' | 'completed' | 'failed' | 'skipped'>
      result?: unknown
    }
  /** 2026-09-02 系统工具流式：工具增量输出（bash/powershell 逐行） */
  | { type: 'tool_delta'; turnId: string; toolCallId: string; delta: string }
  /** 2026-09-02 系统工具流式：文件变更 diff（write/edit/edit_diff） */
  | {
      type: 'file_change'
      turnId: string
      toolCallId: string
      path: string
      kind: string
      hunks: Array<{ removed?: string[]; added?: string[]; truncated_at?: boolean }>
    }
  /** 轮次结束（AgentEnd / send_message 返回） */
  | {
      type: 'turn_end'
      turnId: string
      status?: TurnStatus
      finalText?: string
    }

// ─── 归约器 ───────────────────────────────────────────

/** 行段 id 生成器：前缀 + 单调序号，避免同毫秒碰撞 */
let segSeq = 0
export function nextSegmentId(prefix: string): string {
  segSeq += 1
  return `${prefix}-${Date.now()}-${segSeq}`
}

/** 取最后一个轮次的索引，未找到返回 -1 */
function lastTurnIndex(turns: Turn[]): number {
  return turns.length - 1
}

/**
 * 替换指定索引的轮次（保持其余轮次引用不变，便于响应式精确更新）
 */
function replaceTurn(turns: Turn[], index: number, next: Turn): Turn[] {
  const copy = [...turns]
  copy[index] = next
  return copy
}

/**
 * 替换指定索引的行段（保持其余行段引用不变）
 */
function replaceSegment(turn: Turn, index: number, next: Segment): Turn {
  const segments = [...turn.segments]
  segments[index] = next
  return { ...turn, segments }
}

/**
 * 2026-09-02 激进方案辅助：把新产生段的 id 归入当前激活计划步骤的 childRefIds。
 *
 * 步骤 running 期间的所有输出（思维链/文本/动作）都应「塞进」该步骤——渲染层
 * 据 childRefIds 把步骤内容折叠展示。段 id 入步骤、步骤入轮次（引用式更新）。
 * 无激活步骤时原样返回（步骤外内容正常展示）。
 */
function claimIntoActiveStep(turn: Turn, segId: string): Turn {
  if (!turn.activePlanStepId) return turn
  const aid = turn.activePlanStepId
  const idx = turn.segments.findIndex(
    (s) => s.kind === 'action' && (s as ActionSegment).isPlanStep && s.id === aid,
  )
  if (idx < 0) return turn
  const step = turn.segments[idx] as ActionSegment
  const refs = [...(step.childRefIds ?? [])]
  if (!refs.includes(segId)) refs.push(segId)
  return replaceSegment(turn, idx, { ...step, childRefIds: refs })
}

/**
 * 写入或校正一段文本：有结果层候选则就地校正，否则新建文本段
 *
 * 覆盖两种真实情形：模型一次性输出（无 StreamDelta，正文只在 StreamEnd.fullText）、
 * 以及增量全部丢失（传输层丢帧）——两者都不能依赖 delta 先建出段。
 */
function upsertTextSegment(
  turn: Turn,
  text: string,
  status: 'streaming' | 'complete',
  id?: string,
): Turn {
  const idx = turn.candidateId ? turn.segments.findIndex((s) => s.id === turn.candidateId) : -1
  const seg = idx >= 0 ? turn.segments[idx] : undefined
  if (seg && seg.kind === 'text') {
    return replaceSegment(turn, idx, { ...seg, text, status })
  }
  // 2026-09-02 去重：无候选时，向前找最近的被动作降级的正文段
  // （resultCandidate=false 且与权威文本重合），复用校正而非新建——
  // 否则「流式段（被降级）+ round_end 段」会渲染出两段重复文本。
  // 注意从后向前扫：降级段与 round_end 之间可能隔着 think/动作段（只看末段会漏配）。
  if (!turn.candidateId) {
    for (let i = turn.segments.length - 1; i >= 0 && i >= turn.segments.length - 10; i--) {
      const s = turn.segments[i]
      if (!s || s.kind !== 'text') continue
      if (s.resultCandidate !== false) break
      const overlap =
        s.text === text || text.startsWith(s.text) || s.text.startsWith(text)
      if (overlap) {
        return replaceSegment(turn, i, { ...s, text, status })
      }
      break
    }
  }
  const next: TextSegment = {
    // 回源时可指定 id（复用持久化消息 id），使回源态与实时态的行 id 对齐
    id: id ?? nextSegmentId('text'),
    kind: 'text',
    text,
    status,
    resultCandidate: true,
    timestamp: Date.now(),
  }
  return { ...turn, segments: [...turn.segments, next], candidateId: next.id }
}

/**
 * 把当前结果层候选降级为过程文本段（出现新动作即表示该文本是过程说明，不是答案）
 */
function demoteCandidate(turn: Turn): Turn {
  if (!turn.candidateId) return turn
  const idx = turn.segments.findIndex((s) => s.id === turn.candidateId)
  if (idx < 0) return { ...turn, candidateId: null }
  const seg = turn.segments[idx]
  if (seg.kind !== 'text') return { ...turn, candidateId: null }
  const segments = [...turn.segments]
  segments[idx] = { ...seg, resultCandidate: false }
  return { ...turn, segments, candidateId: null }
}

/**
 * 事件归约：把一条事件应用到轮次列表，返回新的轮次列表
 *
 * 纯函数，未命中任何轮次时原样返回（防御：事件先于 turn_start 到达）。
 */
export function reduceEvent(turns: Turn[], event: TurnEvent): Turn[] {
  switch (event.type) {
    case 'turn_start': {
      // 幂等：同 id 轮次已存在则忽略（回源与实时叠加时的防重）
      if (turns.some((t) => t.id === event.turnId)) return turns
      const turn: Turn = {
        id: event.turnId,
        userMessage: event.userMessage,
        segments: [],
        resultId: null,
        candidateId: null,
        status: 'streaming',
        processCollapsed: false,
        userEverExpanded: false,
        hasAutoCollapsed: false,
        startedAt: event.userMessage.timestamp,
      }
      return [...turns, turn]
    }

    case 'round_start': {
      // 子轮开始：闭合上一段，使新一轮的推理/文本各自起新段
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      return replaceTurn(turns, ti, closeLastSegment(turns[ti]))
    }

    case 'reasoning': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      const turn = turns[ti]
      const li = turn.segments.length - 1
      const last = li >= 0 ? turn.segments[li] : undefined
      // 上一段是流式推理则追加，否则新开一段（支持 reasoning/content 交错切分）
      if (last && last.kind === 'think' && last.status === 'streaming') {
        return replaceTurn(
          turns,
          ti,
          replaceSegment(turn, li, { ...last, text: last.text + event.delta }),
        )
      }
      const seg: ThinkSegment = {
        id: nextSegmentId('think'),
        kind: 'think',
        text: event.delta,
        status: 'streaming',
        timestamp: Date.now(),
      }
      // 2026-09-02 激进方案：激活步骤运行期间的思维链归入该步
      return replaceTurn(turns, ti, claimIntoActiveStep({ ...turn, segments: [...turn.segments, seg] }, seg.id))
    }

    case 'text_delta': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      const turn = turns[ti]
      const li = turn.segments.length - 1
      const last = li >= 0 ? turn.segments[li] : undefined
      // 上一段是流式文本则追加，否则新开一段并标记为结果层候选
      if (last && last.kind === 'text' && last.status === 'streaming') {
        return replaceTurn(
          turns,
          ti,
          replaceSegment(turn, li, { ...last, text: last.text + event.delta }),
        )
      }
      const seg: TextSegment = {
        id: nextSegmentId('text'),
        kind: 'text',
        text: event.delta,
        status: 'streaming',
        resultCandidate: true,
        timestamp: Date.now(),
      }
      // 2026-09-02 激进方案：步骤内文本归入该步（不设结果层候选——是过程内容）；
      // 步骤外照旧作为结果层候选流式展示
      const withSeg = { ...turn, segments: [...turn.segments, seg] }
      if (turn.activePlanStepId) {
        return replaceTurn(turns, ti, claimIntoActiveStep(withSeg, seg.id))
      }
      return replaceTurn(turns, ti, { ...withSeg, candidateId: seg.id })
    }

    case 'action_start': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      let turn = turns[ti]
      // 幂等：同 id 动作段已存在则忽略（ToolCallStart 双发去重）
      if (turn.segments.some((s) => s.id === event.id)) return turns
      // 新动作出现 → 降级候选（前面的文本是过程说明，不是答案）
      turn = demoteCandidate(turn)
      // 2026-09-02 计划步骤并入过程层：plan 类动作段标记为计划步骤行。
      // 初始 status=pending（plan_created 一次性生成全部步骤，未开始执行）；
      // plan_update(in_progress) 经 plan_step_status 置 running 后，该步的工具才归为子动作。
      const isPlanStep = event.action === 'plan'
      const seg: ActionSegment = {
        id: event.id,
        kind: 'action',
        action: event.action,
        rowKind: classifyActionRowKind(event.label),
        status: isPlanStep ? 'pending' : 'running',
        label: event.label,
        refId: event.refId,
        args: event.args,
        timestamp: Date.now(),
        ...(isPlanStep ? { isPlanStep: true, stepCollapsed: true, childRefIds: [] } : {}),
      }
      const segments = [...turn.segments, seg]
      // 2026-09-02 激进方案：子动作归属统一经 activePlanStepId——
      // 激活步骤 running 期间产生的所有动作段归入该步 childRefIds（含工具/委派等）。
      let claimed = false
      if (!isPlanStep && turn.activePlanStepId) {
        const aid = turn.activePlanStepId
        for (let i = segments.length - 2; i >= 0; i--) {
          const s = segments[i]
          if (s.kind !== 'action') continue
          const a = s as ActionSegment
          if (a.isPlanStep && a.id === aid) {
            const newRefs = [...(a.childRefIds ?? []), seg.id]
            if (newRefs[newRefs.length - 1] !== a.id) {
              segments[i] = { ...a, childRefIds: newRefs }
            }
            claimed = true
            break
          }
        }
      }
      // 2026-09-02 plan_update 工具行按 item_id 直配归入对应步骤——
      // PlanStepUpdate(running) 广播晚于该工具行本身（apply_plan_result 在 ToolCallEnd 后），
      // 激活机制接不住「激活第一个步骤的那次 plan_update」，按参数 item_id 匹配步骤 refId。
      if (!claimed && !isPlanStep && event.label === 'plan_update') {
        const itemId =
          (event.args?.['item_id'] as string) ?? (event.args?.['itemId'] as string) ?? ''
        if (itemId) {
          for (let i = segments.length - 2; i >= 0; i--) {
            const s = segments[i]
            if (s.kind !== 'action') continue
            const a = s as ActionSegment
            if (a.isPlanStep && a.refId === itemId) {
              const newRefs = [...(a.childRefIds ?? []), seg.id]
              if (newRefs[newRefs.length - 1] !== a.id) {
                segments[i] = { ...a, childRefIds: newRefs }
              }
              break
            }
          }
        }
      }
      return replaceTurn(turns, ti, { ...turn, segments })
    }

    case 'plan_step_status': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      const turn = turns[ti]
      const idx = turn.segments.findIndex(
        (s) => s.kind === 'action' && s.refId === event.stepId,
      )
      if (idx < 0) return turns
      const seg = turn.segments[idx]
      if (seg.kind !== 'action' || !seg.isPlanStep) return turns
      const nextSeg = {
        ...seg,
        status: event.status,
        result: event.result ?? seg.result,
        // 2026-09-02 激进方案：步骤 running 时强制展开（其内输出可见）；
        // 收口后保持展开（执行过程保留可查），仅重置 activePlanStepId
        stepCollapsed: event.status === 'running' ? false : seg.stepCollapsed,
      }
      const segments = turn.segments.map((s, i) => (i === idx ? nextSeg : s))
      const activePlanStepId =
        event.status === 'running'
          ? seg.id
          : turn.activePlanStepId === seg.id
            ? undefined
            : turn.activePlanStepId
      return replaceTurn(turns, ti, { ...turn, segments, activePlanStepId })
    }

    case 'plan_step_toggle': {
      const ti = turns.findIndex((t) => t.id === event.turnId)
      if (ti < 0) return turns
      const turn = turns[ti]
      const idx = turn.segments.findIndex((s) => s.id === event.stepId)
      if (idx < 0) return turns
      const seg = turn.segments[idx]
      if (seg.kind !== 'action' || !seg.isPlanStep) return turns
      // 切折叠态 + 置 userEverExpanded（计划步骤展开也算用户接触过：折叠判定不再自动收起该轮）
      return replaceTurn(turns, ti, {
        ...turn,
        userEverExpanded: true,
        segments: turn.segments.map((s, i) =>
          i === idx ? { ...seg, stepCollapsed: !seg.stepCollapsed } : s,
        ),
      })
    }

    case 'action_end': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      const turn = turns[ti]
      // 按 refId 配对（而非数组顺序），同名工具多次调用互不干扰
      const idx = turn.segments.findIndex(
        (s) => s.kind === 'action' && s.refId === event.refId,
      )
      if (idx < 0) return turns
      const seg = turn.segments[idx]
      // 类型收窄：findIndex 的类型谓词不会传递给后续索引访问，需显式守卫
      if (seg.kind !== 'action') return turns
      return replaceTurn(turns, ti, replaceSegment(turn, idx, {
        ...seg,
        status: event.status,
        result: event.result ?? seg.result,
        error: event.error,
        durationMs: event.durationMs ?? seg.durationMs,
      }))
    }

    case 'round_end': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      let turn = closeLastSegment(turns[ti])
      // fullText 为权威文本：校正增量累积的丢失/截断；无候选时新建段
      // （空串表示本轮无正文，如纯工具调用轮，不建段）
      if (event.fullText) turn = upsertTextSegment(turn, event.fullText, 'complete', event.textId)
      return replaceTurn(turns, ti, turn)
    }

    case 'actions_settle': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      const turn = turns[ti]
      if (!turn.segments.some((s) => s.kind === 'action' && s.status === 'running')) return turns
      return replaceTurn(turns, ti, settleRunningActions(turn))
    }

    // 2026-09-02 系统工具流式：tool_delta 增量输出追加到动作段（按 refId=toolCallId 配对）
    case 'tool_delta': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      const turn = turns[ti]
      const idx = turn.segments.findIndex(
        (s) => s.kind === 'action' && s.refId === event.toolCallId,
      )
      if (idx < 0) return turns
      const seg = turn.segments[idx]
      if (seg.kind !== 'action') return turns
      // 字符上限截断（丢旧保新）：超限只保留末尾 TOOL_STREAM_LIMIT，置 streamTruncated。
      // 截断发生在归约层而非渲染层，避免段上无限累积占内存。
      const combined = (seg.stream ?? '') + event.delta
      if (combined.length <= TOOL_STREAM_LIMIT) {
        return replaceTurn(turns, ti, replaceSegment(turn, idx, { ...seg, stream: combined }))
      }
      return replaceTurn(turns, ti, replaceSegment(turn, idx, {
        ...seg,
        stream: combined.slice(-TOOL_STREAM_LIMIT),
        streamTruncated: true,
      }))
    }

    // 2026-09-02 系统工具流式：file_change diff 写入动作段（绿红对比 + 路径渲染）
    case 'file_change': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      const turn = turns[ti]
      const idx = turn.segments.findIndex(
        (s) => s.kind === 'action' && s.refId === event.toolCallId,
      )
      if (idx < 0) return turns
      const seg = turn.segments[idx]
      if (seg.kind !== 'action') return turns
      return replaceTurn(turns, ti, replaceSegment(turn, idx, {
        ...seg,
        fileChange: {
          path: event.path,
          kind: event.kind,
          hunks: event.hunks,
        },
      }))
    }

    // 以下两个事件按 id 定位而非取最后一个轮次：用户可能展开/折叠的是历史轮次
    case 'turn_expanded': {
      const ti = turns.findIndex((t) => t.id === event.turnId)
      if (ti < 0) return turns
      if (turns[ti].userEverExpanded) return turns
      return replaceTurn(turns, ti, { ...turns[ti], userEverExpanded: true })
    }

    case 'auto_collapse': {
      const ti = turns.findIndex((t) => t.id === event.turnId)
      if (ti < 0) return turns
      const turn = turns[ti]
      if (turn.hasAutoCollapsed && turn.processCollapsed) return turns
      return replaceTurn(turns, ti, { ...turn, processCollapsed: true, hasAutoCollapsed: true })
    }

    case 'turn_end': {
      const ti = lastTurnIndex(turns)
      if (ti < 0 || turns[ti].id !== event.turnId) return turns
      let turn = closeLastSegment(turns[ti])
      // finalText 为权威结果层内容
      if (event.finalText) turn = upsertTextSegment(turn, event.finalText, 'complete')
      // 收口未完成的动作段：轮次已结束而动作仍 running → 中断或异常终止，避免命令段永久转圈
      turn = settleRunningActions(turn)
      // 固化结果层：最后一个候选成为 ③ 结果层
      const resultId = turn.candidateId ?? turn.resultId
      return replaceTurn(turns, ti, {
        ...turn,
        resultId,
        candidateId: null,
        status: event.status ?? 'complete',
        endedAt: Date.now(),
      })
    }

    default:
      return turns
  }
}

/** 收口所有仍在 running 的动作段（置为 failed）：无对应 action_end 即异常终止 */
function settleRunningActions(turn: Turn): Turn {
  return {
    ...turn,
    segments: turn.segments.map((s) =>
      s.kind === 'action' && s.status === 'running' ? { ...s, status: 'failed' as const } : s,
    ),
  }
}

/** 闭合最后一个流式中行段（置为 complete） */
function closeLastSegment(turn: Turn): Turn {
  const li = turn.segments.length - 1
  if (li < 0) return turn
  const seg = turn.segments[li]
  if (seg.kind === 'action') return turn // 动作段由 action_end 收口
  if (seg.status === 'complete') return turn
  return replaceSegment(turn, li, { ...seg, status: 'complete' })
}

/** 批量归约：按序应用事件列表 */
export function reduceEvents(turns: Turn[], events: TurnEvent[]): Turn[] {
  let acc = turns
  for (const e of events) acc = reduceEvent(acc, e)
  return acc
}

// ─── 回源重建 ─────────────────────────────────────────

/** 回源输入消息：兼容 Rust 原始（serde lowercase `toolresult` / snake_case）与前端映射后（camelCase）三种形态 */
export interface RebuildMessage {
  /** 持久化消息 id（有则复用为文本段 id，使回源态与实时态行 id 对齐） */
  id?: string
  role: 'user' | 'assistant' | 'tool_result' | 'toolResult' | 'toolresult' | 'system'
  content: string
  tool_calls?: Array<{ id: string; name: string; args: unknown }>
  tool_call_id?: string
  toolCallId?: string
  meta?: Record<string, unknown>
  /** 推理文本（前端映射后的 AgentMessage 形态） */
  thinking?: string
}

/** 读取推理文本：优先顶层 thinking，回退 meta.thinking（Rust 持久化形态） */
function readThinking(m: RebuildMessage): string {
  if (typeof m.thinking === 'string' && m.thinking) return m.thinking
  const t = m.meta?.thinking
  return typeof t === 'string' ? t : ''
}

/**
 * 解析工具结果：判定成功/失败，并归一化出可读的结果文本
 *
 * 兼容两种输入形态，供实时与回源两条路径共用，保证两者产出一致：
 * - 回源：`toolResult` 消息的 content（`serde_json::to_string` 后的 JSON 字符串）
 * - 实时：`ToolCallEnd` 的 payload.result（已解析的 JSON 值）
 *
 * 失败判定对齐后端（crates/agent-kernel/src/agent/tools.rs:390-399）：
 * 结果顶层含非 null 的 `error` 键即视为失败；`{ error, tool }` 为后端失败固定形态。
 */
export function parseToolResult(raw: unknown): {
  status: 'completed' | 'failed'
  result?: string
  error?: string
} {
  let v: unknown = raw
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw)
    } catch {
      // 非 JSON 文本：原样作为结果
    }
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.error != null) {
      return { status: 'failed', error: typeof o.error === 'string' ? o.error : String(o.error) }
    }
    // shell 工具失败判定补充（观察项落地）：__meta.exit_code ≠ 0 即失败——
    // 后端 shell 结果以 exit_code 表达成败（顶层无 error 键），✓+exit 1 组合矛盾消除
    const meta = o.__meta as Record<string, unknown> | undefined
    const exitCode = meta && typeof meta === 'object' ? meta.exit_code : o.exit_code
    if (typeof exitCode === 'number' && exitCode !== 0) {
      return { status: 'failed', error: `exit ${exitCode}` }
    }
    // 后端工具统一返回 { result } 包装时取其内部值，否则整体序列化
    if (typeof o.result === 'string') return { status: 'completed', result: o.result }
    return { status: 'completed', result: JSON.stringify(v) }
  }
  if (typeof v === 'string') return { status: 'completed', result: v }
  if (v === undefined || v === null) return { status: 'completed' }
  return { status: 'completed', result: String(v) }
}

// ─── R6 第三部分：动作段事件 → TurnEvent 翻译（实时/回源共用）───────────

/** refId 稳定键前缀（动作段 start/end 配对；id=refId 保证幂等去重） */
const R6_REF_PREFIX = 'r6:'

/**
 * 把一条动作段事件（`type:"action_event"` 的 payload：`{ action, ...明细 }` 平铺）
 * 翻译成 TurnEvent 序列（瞬时决策类成对 start/end；进入/结果类按阶段命名成段）。
 *
 * 实时与回源共用：useAgentRust 实时路径（handleStreamEvent）与
 * rebuildFromMessages（assistant.meta.action_events 数组）据此驱动**同一个归约器**，
 * 保证刷新前后动作行段结构一致（R6 第三部分）。
 * 配对规则（与后端 action_event_payload 六类对齐）：
 * - subagent（start/completed/error）：按 subAgentId 配对
 * - phase（entered/result）：按 `runId:phase` 配对；pipe_started/pipe_finished 骨架事件不建段（避免悬空段）
 * - router / reflection：瞬时段 start+end 同刻
 * - confirm（requested/resolved）：按 confirmId 配对
 */
export function actionEventToTurnEvents(
  turnId: string,
  action: string,
  payload: Record<string, unknown>,
): TurnEvent[] {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')

  switch (action) {
    case 'subagent': {
      const subId = str(payload.subAgentId)
      if (!subId) return []
      const refId = `${R6_REF_PREFIX}subagent:${subId}`
      const phase = payload.phase
      if (phase === 'completed') {
        return [
          {
            type: 'action_end',
            turnId,
            refId,
            status: 'completed',
            durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
            result: payload.outputChars,
          },
        ]
      }
      if (phase === 'error') {
        return [{ type: 'action_end', turnId, refId, status: 'failed' }]
      }
      return [
        {
          type: 'action_start',
          turnId,
          id: refId,
          action: 'subagent',
          label: str(payload.name) || '子 Agent',
          refId,
          args: payload.task ? { task: payload.task } : undefined,
        },
      ]
    }
    case 'phase': {
      const runId = str(payload.runId)
      const phaseName = str(payload.phase)
      // pipe 子阶段标识（后端 `event` 键：pipe_started/entered/result/pipe_finished）
      const sub = payload.event
      if (sub === 'entered') {
        if (!runId || !phaseName) return []
        const refId = `${R6_REF_PREFIX}phase:${runId}:${phaseName}`
        return [{ type: 'action_start', turnId, id: refId, action: 'phase', label: phaseName, refId }]
      }
      if (sub === 'result') {
        if (!runId || !phaseName) return []
        const refId = `${R6_REF_PREFIX}phase:${runId}:${phaseName}`
        const status =
          payload.status === 'Success' ? 'completed'
          : payload.status === 'Failed' || payload.status === 'Degraded' ? 'failed'
          : 'completed'
        return [
          {
            type: 'action_end',
            turnId,
            refId,
            status,
            result: str(payload.summary) || undefined,
          },
        ]
      }
      return []
    }
    case 'router': {
      const refId = `${R6_REF_PREFIX}router:${str(payload.phase) || 'decision'}`
      const target = str(payload.target)
      return [
        { type: 'action_start', turnId, id: refId, action: 'router', label: target ? `路由：${target}` : '路由决策', refId },
        { type: 'action_end', turnId, refId, status: 'completed' },
      ]
    }
    case 'reflection': {
      const refId = `${R6_REF_PREFIX}reflection`
      return [
        { type: 'action_start', turnId, id: refId, action: 'reflection', label: '评审', refId },
        { type: 'action_end', turnId, refId, status: 'completed', result: payload.result },
      ]
    }
    case 'confirm': {
      const confirmId = str(payload.confirmId)
      if (!confirmId) return []
      const refId = `${R6_REF_PREFIX}confirm:${confirmId}`
      if (payload.phase === 'resolved') {
        return [
          { type: 'action_end', turnId, refId, status: payload.approved ? 'completed' : 'failed' },
        ]
      }
      return [
        {
          type: 'action_start',
          turnId,
          id: refId,
          action: 'confirm',
          label: `等待确认：${str(payload.tool) || '工具调用'}`,
          refId,
        },
      ]
    }
    default:
      return []
  }
}

/**
 * 回源重建：把持久化消息翻译成事件序列，喂给**同一个**归约器
 *
 * 与实时流走同一套规则，保证两者产出结构一致（这是消除"刷新前后两套 DOM"的判据）。
 * 翻译顺序严格对齐实时流：推理 → 正文 → 工具调用 → 工具结果。
 */
export function rebuildFromMessages(msgs: RebuildMessage[]): Turn[] {
  let turns: Turn[] = []
  let turnId: string | null = null

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]

    if (m.role === 'user') {
      // 用户消息：先收口上一轮，再开新轮
      if (turnId) turns = reduceEvent(turns, { type: 'turn_end', turnId, status: 'complete' })
      turnId = `turn-${i}`
      turns = reduceEvent(turns, {
        type: 'turn_start',
        turnId,
        userMessage: { id: `user-${i}`, text: m.content, timestamp: Date.now() },
      })
      continue
    }

    // 无归属轮次的孤儿消息（历史数据首条非 user）→ 跳过，避免产生游离段
    if (!turnId) continue

    if (m.role === 'assistant') {
      turns = reduceEvent(turns, { type: 'round_start', turnId })
      const thinking = readThinking(m)
      if (thinking) turns = reduceEvent(turns, { type: 'reasoning', turnId, delta: thinking })
      // R6 第三部分：动作段回源——assistant.meta.action_events（事件序）经同一归约器重建
      // （置于正文之前：动作段入过程层，正文保持结果层候选，回源态与实时态结构一致）
      const rawEvents = m.meta?.action_events
      if (Array.isArray(rawEvents)) {
        for (const ev of rawEvents) {
          if (!ev || typeof ev !== 'object') continue
          const ae = ev as Record<string, unknown>
          if (typeof ae.action !== 'string') continue
          for (const te of actionEventToTurnEvents(turnId, ae.action, ae)) {
            turns = reduceEvent(turns, te)
          }
        }
      }
      // 本轮正文（空串不建段）；其后若有工具调用，会被 action_start 自动降级为过程文本
      turns = reduceEvent(turns, { type: 'round_end', turnId, fullText: m.content, textId: m.id })
      for (const tc of m.tool_calls ?? []) {
        turns = reduceEvent(turns, {
          type: 'action_start',
          turnId,
          id: `act-${tc.id}`,
          action: 'tool',
          label: tc.name,
          refId: tc.id,
          args: tc.args as Record<string, unknown>,
        })
      }
      continue
    }

    // 角色名三态兼容：Rust serde `rename_all="lowercase"` 实际产出 "toolresult"
    // （R14：此前只认 'tool_result'/'toolResult'，回源 action_end 全部不触发，
    // settleRunningActions 把所有命令段误标失败）
    if (m.role === 'tool_result' || m.role === 'toolResult' || m.role === 'toolresult') {
      const refId = m.tool_call_id ?? m.toolCallId ?? ''
      if (!refId) continue
      const parsed = parseToolResult(m.content)
      turns = reduceEvent(turns, {
        type: 'action_end',
        turnId,
        refId,
        status: parsed.status,
        result: parsed.result,
        error: parsed.error,
      })
    }
  }

  // 收口最后一轮
  if (turnId) turns = reduceEvent(turns, { type: 'turn_end', turnId, status: 'complete' })
  return turns
}

// ─── 派生视图 ─────────────────────────────────────────

/** 取过程层行段（排除已固化为结果层的那段） */
export function processSegments(turn: Turn): Segment[] {
  return turn.resultId ? turn.segments.filter((s) => s.id !== turn.resultId) : turn.segments
}

/** 取结果层文本段（未落地返回 null） */
export function resultSegment(turn: Turn): TextSegment | null {
  if (!turn.resultId) return null
  const seg = turn.segments.find((s) => s.id === turn.resultId)
  return seg && seg.kind === 'text' ? seg : null
}

/** 轮次是否有可见的过程层内容（用于折叠行摘要与空态判断） */
export function turnActionCount(turn: Turn): number {
  return processSegments(turn).filter((s) => s.kind === 'action').length
}

/** 轮次推理段数量（折叠行摘要用） */
export function turnThinkCount(turn: Turn): number {
  return processSegments(turn).filter((s) => s.kind === 'think').length
}

// ─── 折叠判定（§3.4 三条件）─────────────────────────────

/** 折叠判定结果 */
export type CollapseDecision =
  /** 不满足折叠前置条件（结果层未落地 / 已折叠 / 已自动折叠过） */
  | 'skip'
  /** 立即折叠（条件 1：未展开过；条件 3：已滚出视口） */
  | 'collapse-now'
  /** 在视口内，需等空闲 ≥5s（条件 2） */
  | 'schedule-idle'

/**
 * 单个轮次的过程层折叠判定（纯函数：控制器与单测共用）
 *
 * 三条件（用户精确定义）：
 * 1. 用户未展开过任何行段 → 立即折叠
 * 2. 展开过 && 展开项当前在视口内 → 等空闲后折叠（有操作则重置计时，由控制器处理）
 * 3. 展开过 && 展开项已不在视口内 → 立即折叠
 *
 * 前置：结果层已落地（否则过程中折叠会让用户看不到正在发生什么）。
 * latch：`hasAutoCollapsed` 为真则永不再次自动折叠（用户手动展开后不再自动收起）。
 *
 * @param turn 轮次
 * @param processVisible 该轮次的过程层是否仍在视口内
 */
export function decideCollapse(turn: Turn, processVisible: boolean): CollapseDecision {
  if (turn.status === 'streaming' || !turn.resultId) return 'skip'
  if (turn.processCollapsed || turn.hasAutoCollapsed) return 'skip'
  if (!turn.userEverExpanded) return 'collapse-now'
  if (!processVisible) return 'collapse-now'
  return 'schedule-idle'
}

// ─── 扁平渲染行 ────────────────────────────────────────

/**
 * 扁平渲染行：状态层仍以 Turn 为事实源，渲染层消费扁平序列
 *
 * 保留扁平形态是为了兼容既有窗口化（useMessageWindowing）与行组件，
 * 使其无需感知 Turn 结构；isResult 标记供渲染层区分 ② 过程层与 ③ 结果层。
 */
export type FlatRow =
  | { id: string; turnId: string; type: 'user'; msg: TurnUserMessage; timestamp: number }
  | {
      id: string
      turnId: string
      type: 'think'
      text: string
      status: 'streaming' | 'complete'
      timestamp: number
    }
  | {
      id: string
      turnId: string
      type: 'action'
      action: ActionKind
      label: string
      /** 行段种类（v2）：渲染层按此分行卡 */
      rowKind: ActionRowKind
      status: ActionStatus
      args?: Record<string, unknown>
      result?: unknown
      error?: string
      /** 执行耗时（毫秒，H7 P0.5）；回源无此字段则不显示 */
      durationMs?: number
      /** 2026-09-02 系统工具流式：bash/powershell 增量输出累积（随流透传渲染） */
      stream?: string
      /** 2026-09-02 系统工具流式：stream 超限已丢旧保新（渲染层提示） */
      streamTruncated?: boolean
      /** 2026-09-02 系统工具流式：文件变更 diff（绿红对比 + 路径渲染） */
      fileChange?: ActionSegment['fileChange']
      /** 2026-09-02 计划步骤行：plan 类动作段标记 + 子动作 id 列表 + 折叠态 */
      isPlanStep?: boolean
      childRefIds?: string[]
      stepCollapsed?: boolean
      timestamp: number
    }
  | { id: string; turnId: string; type: 'text'; text: string; isResult: boolean; timestamp: number }
  | { id: string; turnId: string; type: 'divider'; text: string; timestamp: number }
  /** 过程层折叠摘要：过程层折叠时，全部过程行段收敛为这一行（点击可展开）；
   *  expanded=true 时为展开态的常驻折叠头行（点击收起） */
  | {
      id: string
      turnId: string
      type: 'process_summary'
      thinkCount: number
      actionCount: number
      expanded?: boolean
      timestamp: number
    }

/** 行段转渲染行 */
function segmentToRow(s: Segment, turnId: string, isResult: boolean): FlatRow {
  switch (s.kind) {
    case 'think':
      return {
        id: s.id,
        turnId,
        type: 'think',
        text: s.text,
        status: s.status,
        timestamp: s.timestamp,
      }
    case 'action':
      return {
        id: s.id,
        turnId,
        type: 'action',
        action: s.action,
        label: s.label,
        rowKind: s.rowKind,
        status: s.status,
        args: s.args,
        result: s.result,
        error: s.error,
        durationMs: s.durationMs,
        stream: s.stream,
        streamTruncated: s.streamTruncated,
        fileChange: s.fileChange,
        isPlanStep: s.isPlanStep,
        childRefIds: s.childRefIds,
        stepCollapsed: s.stepCollapsed,
        timestamp: s.timestamp,
      }
    case 'text':
      return { id: s.id, turnId, type: 'text', text: s.text, isResult, timestamp: s.timestamp }
  }
}

/**
 * 展平单个轮次（① 用户层 → ② 过程层 → ③ 结果层）
 *
 * 折叠由 `turn.processCollapsed` 驱动：折叠时过程行段收敛为一条 `process_summary` 行，
 * **结果层照常输出**（结果层不属于过程层，不参与折叠）。
 *
 * 单独导出是为了让渲染层做**轮次级增量缓存**：未被本次事件触及的轮次（对象引用未变）
 * 可直接复用上次的 FlatRow[]，无需重算。
 *
 * @param opts.abortedText 提供时，被中止的轮次末尾追加一条分隔行（保留"已停止"的可见反馈）
 */
export function flattenTurn(t: Turn, opts?: { abortedText?: string }): FlatRow[] {
  const rows: FlatRow[] = []
  rows.push({
    id: t.userMessage.id,
    turnId: t.id,
    type: 'user',
    msg: t.userMessage,
    timestamp: t.userMessage.timestamp,
  })

  if (t.processCollapsed) {
    const thinkCount = turnThinkCount(t)
    const actionCount = turnActionCount(t)
    // 无过程内容时不输出摘要行（避免"0 个步骤"的空行）
    if (thinkCount + actionCount > 0) {
      rows.push({
        id: `${t.id}-process`,
        turnId: t.id,
        type: 'process_summary',
        thinkCount,
        actionCount,
        expanded: false,
        timestamp: t.userMessage.timestamp,
      })
    }
    const rs = resultSegment(t)
    if (rs) rows.push(segmentToRow(rs, t.id, true))
  } else {
    // 常驻折叠头行（2026-08-30）：用户从折叠态手动展开后，保留一条「收起」头行，
    // 使过程层可再次折叠——修复此前展开后摘要行消失、无法收回的问题
    const thinkCount = turnThinkCount(t)
    const actionCount = turnActionCount(t)
    if (t.processPeeked && thinkCount + actionCount > 0) {
      rows.push({
        id: `${t.id}-process`,
        turnId: t.id,
        type: 'process_summary',
        thinkCount,
        actionCount,
        expanded: true,
        timestamp: t.userMessage.timestamp,
      })
    }
    for (const s of t.segments) {
      rows.push(segmentToRow(s, t.id, s.id === t.resultId))
    }
  }

  if (t.status === 'aborted' && opts?.abortedText) {
    rows.push({
      id: `${t.id}-aborted`,
      turnId: t.id,
      type: 'divider',
      text: opts.abortedText,
      timestamp: t.endedAt ?? t.startedAt,
    })
  }
  return rows
}

/** 把整个轮次树展平为渲染行序列 */
export function flattenTurns(turns: Turn[], opts?: { abortedText?: string }): FlatRow[] {
  const rows: FlatRow[] = []
  for (const t of turns) {
    // 逐个 push 而非 push(...flattenTurn(t))：避免大数组展开的参数个数上限
    for (const r of flattenTurn(t, opts)) rows.push(r)
  }
  return rows
}

/**
 * turnModel 归约器单测
 *
 * 每个用例对应旧实现（扁平 agentStream）的一个已确认缺陷，确保重构后不复现：
 * - 交错切段 ← 旧实现把第二段 reasoning 拼进第一段
 * - 同名工具各归各 ← 旧实现 findLastToolRow 按名字匹配，第二次调用被吞
 * - 候选降级 ← 旧实现不区分过程文本与最终答案
 */

import { describe, it, expect } from 'vitest'
import {
  classifyActionRowKind,
  reduceEvent,
  reduceEvents,
  rebuildFromMessages,
  flattenTurn,
  flattenTurns,
  processSegments,
  resultSegment,
  turnActionCount,
  turnThinkCount,
  decideCollapse,
  actionEventToTurnEvents,
  type RebuildMessage,
  type Segment,
  type Turn,
  type TurnEvent,
} from '../turnModel'

/** 开一个新轮次 */
function startTurn(turnId = 't1'): Turn[] {
  return reduceEvent([], {
    type: 'turn_start',
    turnId,
    userMessage: { id: 'u1', text: '帮我看看这个项目', timestamp: 1_000 },
  })
}

/** 行段结构指纹：剔除生成的 id，只保留可比对的内容 */
function fingerprint(s: Segment): Record<string, unknown> {
  switch (s.kind) {
    case 'think':
      return { kind: 'think', text: s.text }
    case 'action':
      return { kind: 'action', label: s.label, status: s.status, error: s.error }
    case 'text':
      return { kind: 'text', text: s.text }
  }
}

/** 轮次列表结构指纹：用户消息 + 过程层 + 结果层 */
function structureOf(turns: Turn[]) {
  return turns.map((t) => ({
    user: t.userMessage.text,
    process: processSegments(t).map(fingerprint),
    result: resultSegment(t)?.text ?? null,
  }))
}

describe('turnModel 归约器', () => {
  it('开轮次：写入用户消息，过程层为空', () => {
    const turns = startTurn()
    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage.text).toBe('帮我看看这个项目')
    expect(turns[0].segments).toHaveLength(0)
    expect(turns[0].status).toBe('streaming')
  })

  it('同名工具两次调用：产生两个独立动作段，各自收口（旧实现会吞掉第二次）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'read_file', refId: 'call-1',
    })
    turns = reduceEvent(turns, { type: 'action_end', turnId: 't1', refId: 'call-1', status: 'completed', result: 'r1' })
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a2', action: 'tool', label: 'read_file', refId: 'call-2',
    })
    turns = reduceEvent(turns, { type: 'action_end', turnId: 't1', refId: 'call-2', status: 'failed', error: 'e2' })

    const actions = turns[0].segments.filter((s) => s.kind === 'action')
    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({ refId: 'call-1', status: 'completed', result: 'r1' })
    expect(actions[1]).toMatchObject({ refId: 'call-2', status: 'failed', error: 'e2' })
    expect(turnActionCount(turns[0])).toBe(2)
  })

  it('reasoning → content → reasoning 交错：切成 think/text/think 三段（旧实现会拼进同一段）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'reasoning', turnId: 't1', delta: '先想想' })
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '我先说明' })
    turns = reduceEvent(turns, { type: 'reasoning', turnId: 't1', delta: '再想想' })

    expect(turns[0].segments.map((s) => s.kind)).toEqual(['think', 'text', 'think'])
    const thinks = turns[0].segments.filter((s) => s.kind === 'think')
    expect(thinks[0]).toMatchObject({ text: '先想想' })
    expect(thinks[1]).toMatchObject({ text: '再想想' })
    expect(turnThinkCount(turns[0])).toBe(2)
  })

  it('文本后出现动作：候选文本降级为过程段（不再是答案）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '我来查一下' })
    expect(turns[0].candidateId).not.toBeNull()

    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'read_file', refId: 'c1',
    })
    const text = turns[0].segments.find((s) => s.kind === 'text')
    expect(text).toMatchObject({ resultCandidate: false, text: '我来查一下' })
    expect(turns[0].candidateId).toBeNull()
  })

  it('round_end 的 fullText 校正增量累积（应对传输层丢帧）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '残缺文本' })
    turns = reduceEvent(turns, { type: 'round_end', turnId: 't1', fullText: '完整文本' })

    const text = turns[0].segments.find((s) => s.kind === 'text')
    expect(text).toMatchObject({ text: '完整文本', status: 'complete' })
  })

  it('turn_end 固化结果层：结果段从过程层移出', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '这是答案' })
    turns = reduceEvent(turns, { type: 'turn_end', turnId: 't1', finalText: '这是答案' })

    expect(resultSegment(turns[0])).toMatchObject({ text: '这是答案' })
    expect(processSegments(turns[0])).toHaveLength(0)
    expect(turns[0].status).toBe('complete')
  })

  it('action_start 幂等：同 id 不重复追加（ToolCallStart 双发去重）', () => {
    let turns = startTurn()
    const e: TurnEvent = {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'read_file', refId: 'c1',
    }
    turns = reduceEvent(turns, e)
    turns = reduceEvent(turns, e)
    expect(turns[0].segments.filter((s) => s.kind === 'action')).toHaveLength(1)
  })

  it('未命中的 action_end 不产生副作用', () => {
    const turns = startTurn()
    const after = reduceEvent(turns, {
      type: 'action_end', turnId: 't1', refId: '不存在的 id', status: 'completed',
    })
    expect(after).toBe(turns)
  })

  it('事件先于 turn_start 到达时被安全忽略', () => {
    const after = reduceEvent([], { type: 'text_delta', turnId: 't1', delta: 'x' })
    expect(after).toEqual([])
  })

  it('端到端：两轮工具调用的完整轮次结构', () => {
    const events: TurnEvent[] = [
      { type: 'turn_start', turnId: 't1', userMessage: { id: 'u1', text: '查项目并总结', timestamp: 1_000 } },
      // —— LLM 子轮 1：推理 + 过程文本 + 调工具
      { type: 'round_start', turnId: 't1' },
      { type: 'reasoning', turnId: 't1', delta: '需要先看目录' },
      { type: 'round_end', turnId: 't1', fullText: '我先看一下目录结构' },
      { type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'list_dir', refId: 'c1' },
      { type: 'action_end', turnId: 't1', refId: 'c1', status: 'completed', result: '{"files":[]}' },
      // —— LLM 子轮 2：再推理 + 再调工具
      { type: 'round_start', turnId: 't1' },
      { type: 'reasoning', turnId: 't1', delta: '再看主文件' },
      { type: 'round_end', turnId: 't1', fullText: '' },
      { type: 'action_start', turnId: 't1', id: 'a2', action: 'tool', label: 'read_file', refId: 'c2' },
      { type: 'action_end', turnId: 't1', refId: 'c2', status: 'completed', result: '内容' },
      // —— LLM 子轮 3：最终答案
      { type: 'round_start', turnId: 't1' },
      { type: 'text_delta', turnId: 't1', delta: '项目结构如下：' },
      { type: 'text_delta', turnId: 't1', delta: '共 2 个文件。' },
      { type: 'round_end', turnId: 't1', fullText: '项目结构如下：共 2 个文件。' },
      { type: 'turn_end', turnId: 't1' },
    ]
    const turns = reduceEvents([], events)
    const turn = turns[0]

    // 过程层：2 段推理 + 1 段过程文本 + 2 个动作
    const proc = processSegments(turn)
    expect(proc.map((s) => s.kind)).toEqual(['think', 'text', 'action', 'think', 'action'])
    // 结果层：最后一个候选被固化
    expect(resultSegment(turn)).toMatchObject({ text: '项目结构如下：共 2 个文件。' })
    // 摘要计数
    expect(turnActionCount(turn)).toBe(2)
    expect(turnThinkCount(turn)).toBe(2)
  })

  it('2026-09-02 tool_delta：bash/powershell 增量输出累积到对应工具段（按 refId 配对）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'bash', refId: 'call-9',
    })
    // 两条增量前后到达，累积顺序保持
    turns = reduceEvent(turns, { type: 'tool_delta', turnId: 't1', toolCallId: 'call-9', delta: '构建中...' })
    turns = reduceEvent(turns, { type: 'tool_delta', turnId: 't1', toolCallId: 'call-9', delta: '\n编译完成' })
    const action = turns[0].segments.find((s) => s.kind === 'action' && s.refId === 'call-9')
    expect(action).toMatchObject({ stream: '构建中...\n编译完成' })
  })

  it('2026-09-02 tool_delta 超上限：丢旧保新 + 置 streamTruncated', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'bash', refId: 'call-10',
    })
    // 构造超限增量：旧头 + 大段 + 新尾；总长超过 TOOL_STREAM_LIMIT
    const head = 'h'.repeat(10_000)
    const big = 'X'.repeat(12_000)
    const tail = '尾'.repeat(100)
    turns = reduceEvent(turns, { type: 'tool_delta', turnId: 't1', toolCallId: 'call-10', delta: head })
    turns = reduceEvent(turns, { type: 'tool_delta', turnId: 't1', toolCallId: 'call-10', delta: big })
    turns = reduceEvent(turns, { type: 'tool_delta', turnId: 't1', toolCallId: 'call-10', delta: tail })

    const action = turns[0].segments.find((s) => s.kind === 'action' && s.refId === 'call-10')
    expect(action).toMatchObject({ streamTruncated: true })
    // 只保留末尾 TOOL_STREAM_LIMIT 字符（丢旧保新：新尾在、旧头被丢弃）
    const stream = (action as Segment & { stream?: string }).stream ?? ''
    expect(stream.length).toBeLessThanOrEqual(20_000)
    expect(stream.endsWith(tail)).toBe(true)
    expect(stream.startsWith(head)).toBe(false)
  })

  it('2026-09-02 file_change：write/edit/edit_diff 的绿红 diff 写入对应工具段（含路径）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'edit_diff', refId: 'call-7',
    })
    turns = reduceEvent(turns, {
      type: 'file_change',
      turnId: 't1',
      toolCallId: 'call-7',
      path: 'src/lib.rs',
      kind: 'edit_diff',
      hunks: [{ removed: ['let a = 1;'], added: ['let a = 2;', 'let b = 3;'] }],
    })
    const action = turns[0].segments.find((s) => s.kind === 'action' && s.refId === 'call-7')
    expect(action).toMatchObject({
      fileChange: {
        path: 'src/lib.rs',
        kind: 'edit_diff',
        hunks: [{ removed: ['let a = 1;'], added: ['let a = 2;', 'let b = 3;'] }],
      },
    })
  })

  it('2026-09-02 流式事件未命中工具段时安全忽略（不新建段）', () => {
    const turns = startTurn()
    const after = reduceEvent(turns, { type: 'tool_delta', turnId: 't1', toolCallId: '幽灵', delta: 'x' })
    expect(after).toBe(turns)
  })

  it('2026-09-02 计划步骤：plan 动作段标记 isPlanStep + 初始 pending 折叠，状态流转驱动 running/收口', () => {
    let turns = startTurn()
    // 两个计划步骤（plan_created 一次性生成）
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'p1', action: 'plan', label: '步骤一', refId: 's1',
    })
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'p2', action: 'plan', label: '步骤二', refId: 's2',
    })
    let steps = turns[0].segments.filter((s) => s.kind === 'action')
    expect(steps.every((s) => (s as any).isPlanStep)).toBe(true)
    expect(steps.every((s) => (s as any).stepCollapsed)).toBe(true) // 默认折叠
    expect(steps.every((s) => s.status === 'pending')).toBe(true) // 初始 pending

    // 步骤一激活 → running；此时工具动作应归为步骤一的子动作
    turns = reduceEvent(turns, { type: 'plan_step_status', turnId: 't1', stepId: 's1', status: 'running' })
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'tool-a', action: 'tool', label: 'read_file', refId: 'c1',
    })
    const s1 = turns[0].segments.find((s) => s.id === 'p1') as any
    expect(s1.status).toBe('running')
    expect(s1.childRefIds).toEqual(['tool-a']) // 工具归入激活步骤

    // 步骤一完成收口 → 状态 completed；子动作保留
    turns = reduceEvent(turns, { type: 'plan_step_status', turnId: 't1', stepId: 's1', status: 'completed', result: '产出x' })
    const done = turns[0].segments.find((s) => s.id === 'p1') as any
    expect(done.status).toBe('completed')
    expect(done.result).toBe('产出x')

    // 步骤二激活后，新工具归入步骤二而非步骤一
    turns = reduceEvent(turns, { type: 'plan_step_status', turnId: 't1', stepId: 's2', status: 'running' })
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'tool-b', action: 'tool', label: 'bash', refId: 'c2',
    })
    const s2 = turns[0].segments.find((s) => s.id === 'p2') as any
    expect(s2.childRefIds).toEqual(['tool-b'])
    expect((turns[0].segments.find((s) => s.id === 'p1') as any).childRefIds).toEqual(['tool-a'])
  })

  it('2026-09-02 计划步骤折叠切换：plan_step_toggle 翻转 stepCollapsed + 置 userEverExpanded', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'p1', action: 'plan', label: '步骤', refId: 's1',
    })
    expect((turns[0].segments[0] as any).stepCollapsed).toBe(true)
    turns = reduceEvent(turns, { type: 'plan_step_toggle', turnId: 't1', stepId: 'p1' })
    expect((turns[0].segments[0] as any).stepCollapsed).toBe(false)
    expect(turns[0].userEverExpanded).toBe(true)
  })

  it('2026-09-02 激进方案：步骤 running 自动展开 + 思维链/文本/工具全部归入激活步骤', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'p1', action: 'plan', label: '步骤一', refId: 's1',
    })
    // running → 强制展开（stepCollapsed=false）
    turns = reduceEvent(turns, { type: 'plan_step_status', turnId: 't1', stepId: 's1', status: 'running' })
    let s1 = turns[0].segments.find((s) => s.id === 'p1') as any
    expect(s1.stepCollapsed).toBe(false) // 自动展开
    expect(turns[0].activePlanStepId).toBe('p1') // 激活步骤置位

    // 步骤内思维链 → 归入步骤
    turns = reduceEvent(turns, { type: 'reasoning', turnId: 't1', delta: '先分析需求' })
    // 步骤内工具动作 → 归入步骤
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'tool-a', action: 'tool', label: 'read_file', refId: 'c1',
    })
    s1 = turns[0].segments.find((s) => s.id === 'p1') as any
    expect(s1.childRefIds.length).toBe(2) // think + tool 都归入
    const thinkId = s1.childRefIds[0]
    const thinkSeg = turns[0].segments.find((s) => s.id === thinkId)
    expect(thinkSeg?.kind).toBe('think')
    const toolSeg = turns[0].segments.find((s) => s.id === s1.childRefIds[1])
    expect(toolSeg?.kind).toBe('action')

    // 步骤收口 → activePlanStepId 清除；子动作保留（过程可查）
    turns = reduceEvent(turns, { type: 'plan_step_status', turnId: 't1', stepId: 's1', status: 'completed' })
    expect(turns[0].activePlanStepId).toBeUndefined()
    s1 = turns[0].segments.find((s) => s.id === 'p1') as any
    expect(s1.childRefIds.length).toBe(2)
    expect(s1.stepCollapsed).toBe(false) // 收口后保持展开（可查过程）
  })

  it('2026-09-02 激进方案：步骤外输出不归入任何步骤（无激活步骤）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'p1', action: 'plan', label: '步骤一', refId: 's1',
    })
    // 未激活时产出 think/text/tool → 不归入
    turns = reduceEvent(turns, { type: 'reasoning', turnId: 't1', delta: '开始前思考' })
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'tool-x', action: 'tool', label: 'bash', refId: 'cx',
    })
    const s1 = turns[0].segments.find((s) => s.id === 'p1') as any
    expect(s1.childRefIds ?? []).toEqual([])
  })

  it('2026-09-02 plan_update 工具行按 item_id 直配归入对应步骤（激活广播晚于工具行）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'p1', action: 'plan', label: '步骤一', refId: 'pi-1',
    })
    // plan_update(pi-1, in_progress) 工具行到达时步骤还没被激活（running 广播在工具执行完后）
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'u1', action: 'tool', label: 'plan_update',
      refId: 'cu', args: { item_id: 'pi-1', status: 'in_progress' },
    })
    const s1 = turns[0].segments.find((s) => s.id === 'p1') as any
    expect(s1.childRefIds).toContain('u1') // 按 item_id 归入对应步骤
  })

  it('2026-09-02 round_end 去重：降级正文段与 round_end 之间隔着动作段时仍复用（防文本重复）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'round_start', turnId: 't1' })
    // 流式正文（候选）
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '好的，我来创建计划。' })
    // 动作出现 → 候选降级
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'plan_create', refId: 'c1',
    })
    // round_end 权威文本与降级段一致 → 应复用而非新建（只 1 段文本）
    turns = reduceEvent(turns, { type: 'round_end', turnId: 't1', fullText: '好的，我来创建计划。' })
    const texts = turns[0].segments.filter((s) => s.kind === 'text')
    expect(texts.length).toBe(1)
    expect((texts[0] as any).text).toBe('好的，我来创建计划。')
  })
})

describe('回源重建', () => {
  /** 同一段对话的两种来源：实时事件序列 vs 持久化消息序列 */
  const liveEvents: TurnEvent[] = [
    { type: 'turn_start', turnId: 't1', userMessage: { id: 'u1', text: '查项目并总结', timestamp: 1_000 } },
    // —— 子轮 1
    { type: 'round_start', turnId: 't1' },
    { type: 'reasoning', turnId: 't1', delta: '需要先看目录' },
    { type: 'round_end', turnId: 't1', fullText: '我先看一下目录结构' },
    { type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'list_dir', refId: 'c1' },
    { type: 'action_end', turnId: 't1', refId: 'c1', status: 'completed', result: '{"files":[]}' },
    // —— 子轮 2
    { type: 'round_start', turnId: 't1' },
    { type: 'reasoning', turnId: 't1', delta: '再看主文件' },
    { type: 'round_end', turnId: 't1', fullText: '' },
    { type: 'action_start', turnId: 't1', id: 'a2', action: 'tool', label: 'read_file', refId: 'c2' },
    { type: 'action_end', turnId: 't1', refId: 'c2', status: 'completed', result: '内容' },
    // —— 子轮 3：最终答案
    { type: 'round_start', turnId: 't1' },
    { type: 'text_delta', turnId: 't1', delta: '项目结构如下：' },
    { type: 'text_delta', turnId: 't1', delta: '共 2 个文件。' },
    { type: 'round_end', turnId: 't1', fullText: '项目结构如下：共 2 个文件。' },
    { type: 'turn_end', turnId: 't1' },
  ]

  const persisted: RebuildMessage[] = [
    { role: 'user', content: '查项目并总结' },
    {
      role: 'assistant',
      content: '我先看一下目录结构',
      meta: { thinking: '需要先看目录' },
      tool_calls: [{ id: 'c1', name: 'list_dir', args: {} }],
    },
    { role: 'tool_result', content: '{"files":[]}', tool_call_id: 'c1' },
    {
      role: 'assistant',
      content: '',
      meta: { thinking: '再看主文件' },
      tool_calls: [{ id: 'c2', name: 'read_file', args: {} }],
    },
    { role: 'tool_result', content: '内容', tool_call_id: 'c2' },
    { role: 'assistant', content: '项目结构如下：共 2 个文件。' },
  ]

  it('实时构建与回源重建产出同一棵树（核心验收：消灭两套 DOM）', () => {
    const live = reduceEvents([], liveEvents)
    const rebuilt = rebuildFromMessages(persisted)

    expect(live).toHaveLength(1)
    expect(rebuilt).toHaveLength(1)
    expect(structureOf(rebuilt)).toEqual(structureOf(live))
  })

  it('回源结构符合三层预期：过程层 5 段 + 结果层 1 段', () => {
    const [turn] = rebuildFromMessages(persisted)

    expect(processSegments(turn).map((s) => s.kind)).toEqual([
      'think', 'text', 'action', 'think', 'action',
    ])
    expect(resultSegment(turn)?.text).toBe('项目结构如下：共 2 个文件。')
    expect(turnActionCount(turn)).toBe(2)
    expect(turnThinkCount(turn)).toBe(2)
  })

  it('tool_result 按 tool_call_id 关联回动作段，不再生成正文行（旧实现会渲染 raw JSON）', () => {
    const [turn] = rebuildFromMessages(persisted)
    const actions = processSegments(turn).filter((s) => s.kind === 'action')

    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({ label: 'list_dir', status: 'completed' })
    expect(actions[1]).toMatchObject({ label: 'read_file', status: 'completed' })
    // 结果 JSON 不应出现在任何文本段中
    const texts = processSegments(turn).filter((s) => s.kind === 'text')
    expect(texts.map((s) => (s.kind === 'text' ? s.text : '')).join('')).not.toContain('"files"')
  })

  it('工具失败：结果含 error 键时动作段标记 failed', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: '读文件' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', name: 'read_file', args: {} }],
      },
      { role: 'tool_result', content: '{"error":"文件不存在","tool":"read_file"}', tool_call_id: 'c1' },
      { role: 'assistant', content: '读取失败' },
    ])

    const [turn] = turns
    const action = processSegments(turn).find((s) => s.kind === 'action')
    expect(action).toMatchObject({ status: 'failed', error: '文件不存在' })
  })

  it('meta.thinking 与顶层 thinking 都能还原推理段', () => {
    const viaMeta = rebuildFromMessages([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '答案', meta: { thinking: '来自 meta 的推理' } },
    ])
    const viaTop = rebuildFromMessages([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '答案', thinking: '来自顶层的推理' },
    ])

    expect(processSegments(viaMeta[0])[0]).toMatchObject({ kind: 'think', text: '来自 meta 的推理' })
    expect(processSegments(viaTop[0])[0]).toMatchObject({ kind: 'think', text: '来自顶层的推理' })
  })

  it('多次提问 → 多个轮次，各自独立收口', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
      { role: 'assistant', content: '第二答' },
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0].userMessage.text).toBe('第一问')
    expect(resultSegment(turns[0])?.text).toBe('第一答')
    expect(turns[1].userMessage.text).toBe('第二问')
    expect(resultSegment(turns[1])?.text).toBe('第二答')
  })

  it('中止的轮次展平后带「已停止」分隔行（保留可见反馈）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '部分输出' })
    turns = reduceEvent(turns, { type: 'turn_end', turnId: 't1', status: 'aborted' })

    const rows = flattenTurns(turns, { abortedText: '已由用户停止' })
    expect(rows.at(-1)).toMatchObject({ type: 'divider', text: '已由用户停止' })
    // 未提供文案时不插入分隔行（避免无意义的空行）
    expect(flattenTurns(turns).at(-1)?.type).toBe('text')
  })

  it('首条非 user 的孤儿消息被跳过，不产生游离段', () => {
    const turns = rebuildFromMessages([
      { role: 'system', content: '归档摘要' },
      { role: 'assistant', content: '孤儿回答' },
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '答案' },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage.text).toBe('问题')
  })
})

describe('过程层折叠与展平', () => {
  /** 构造一个含完整三层结构的轮次：推理 → 过程文本 → 工具动作 → 结果层 */
  function buildFullTurn(): Turn[] {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'reasoning', turnId: 't1', delta: '先分析一下' })
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '我先看看文件' })
    turns = reduceEvent(turns, {
      type: 'action_start', turnId: 't1', id: 'a1', action: 'tool', label: 'read_file', refId: 'call-1',
    })
    turns = reduceEvent(turns, {
      type: 'action_end', turnId: 't1', refId: 'call-1', status: 'completed', result: 'r1',
    })
    turns = reduceEvent(turns, { type: 'round_end', turnId: 't1', fullText: '答案是 42' })
    turns = reduceEvent(turns, { type: 'turn_end', turnId: 't1', status: 'complete' })
    return turns
  }

  /** 把轮次置为折叠态 */
  function collapse(turns: Turn[]): Turn[] {
    return turns.map((t) => ({ ...t, processCollapsed: true }))
  }

  it('展开态：过程层与结果层按序展平，结果层带 isResult 标记', () => {
    const rows = flattenTurns(buildFullTurn())
    expect(rows.map((r) => r.type)).toEqual(['user', 'think', 'text', 'action', 'text'])
    // 第一个 text 是过程说明，最后一个是结果层
    expect(rows[2]).toMatchObject({ type: 'text', text: '我先看看文件', isResult: false })
    expect(rows[4]).toMatchObject({ type: 'text', text: '答案是 42', isResult: true })
  })

  it('折叠态：过程行段收敛为一条摘要行，结果层照常输出', () => {
    const rows = flattenTurns(collapse(buildFullTurn()))
    expect(rows.map((r) => r.type)).toEqual(['user', 'process_summary', 'text'])
    expect(rows[1]).toMatchObject({
      type: 'process_summary',
      thinkCount: 1,
      actionCount: 1,
    })
    // 结果层不属于过程层，不参与折叠
    expect(rows[2]).toMatchObject({ type: 'text', text: '答案是 42', isResult: true })
  })

  it('无过程内容时折叠不产生摘要行（避免「0 个步骤」空行）', () => {
    let turns = startTurn()
    turns = reduceEvent(turns, { type: 'text_delta', turnId: 't1', delta: '直接回答' })
    turns = reduceEvent(turns, { type: 'turn_end', turnId: 't1', status: 'complete' })

    const rows = flattenTurns(collapse(turns))
    expect(rows.map((r) => r.type)).toEqual(['user', 'text'])
    expect(rows[1]).toMatchObject({ isResult: true })
  })

  it('展平行携带 turnId：多轮次各自归属，行序连续', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
      { role: 'assistant', content: '第二答' },
    ])
    const rows = flattenTurns(turns)
    expect(rows.map((r) => r.turnId)).toEqual(['turn-0', 'turn-0', 'turn-2', 'turn-2'])
  })

  it('折叠后行 id 稳定（同 turnId 派生），避免切状态时整表重建', () => {
    const turns = buildFullTurn()
    const expanded = flattenTurns(turns)
    const collapsed = flattenTurns(collapse(turns))
    // 用户行与结果层行的 id 在两种状态下保持一致
    expect(collapsed[0].id).toBe(expanded[0].id)
    expect(collapsed.at(-1)?.id).toBe(expanded.at(-1)?.id)
  })

  it('turn_expanded：置 userEverExpanded latch，重复事件幂等', () => {
    const turns = buildFullTurn()
    const once = reduceEvent(turns, { type: 'turn_expanded', turnId: 't1' })
    expect(once[0].userEverExpanded).toBe(true)
    // latch 已置位 → 不产生新引用（避免无谓的响应式触发）
    expect(reduceEvent(once, { type: 'turn_expanded', turnId: 't1' })).toBe(once)
  })

  it('auto_collapse：同时置折叠态与 latch，且幂等', () => {
    const turns = buildFullTurn()
    const collapsed = reduceEvent(turns, { type: 'auto_collapse', turnId: 't1' })
    expect(collapsed[0].processCollapsed).toBe(true)
    expect(collapsed[0].hasAutoCollapsed).toBe(true)
    expect(reduceEvent(collapsed, { type: 'auto_collapse', turnId: 't1' })).toBe(collapsed)
  })

  it('auto_collapse 后手动展开：解除折叠但保留 latch（不再被自动收起）', () => {
    const collapsed = reduceEvent(buildFullTurn(), { type: 'auto_collapse', turnId: 't1' })
    const manual = collapsed.map((t) => ({ ...t, processCollapsed: false }))
    expect(manual[0].processCollapsed).toBe(false)
    expect(manual[0].hasAutoCollapsed).toBe(true)
  })

  it('展开/折叠事件对不存在的轮次：原样返回', () => {
    const turns = buildFullTurn()
    expect(reduceEvent(turns, { type: 'turn_expanded', turnId: 'nope' })).toBe(turns)
    expect(reduceEvent(turns, { type: 'auto_collapse', turnId: 'nope' })).toBe(turns)
  })

  it('折叠三条件：结果层未落地 → skip；已落地且未展开过 → 立即折叠（条件 1）', () => {
    // 轮次仍在流式、结果层未落地 → 不折叠（过程中折叠会让用户看不到正在发生什么）
    let streaming = startTurn()
    streaming = reduceEvent(streaming, { type: 'reasoning', turnId: 't1', delta: '思考中' })
    expect(decideCollapse(streaming[0], true)).toBe('skip')

    // 结果层已落地 + 用户未展开过任何行段 → 立即折叠
    expect(decideCollapse(buildFullTurn()[0], true)).toBe('collapse-now')
  })

  it('折叠三条件：展开过 → 视口内等空闲（条件 2），视口外立即折叠（条件 3）', () => {
    const turns = reduceEvent(buildFullTurn(), { type: 'turn_expanded', turnId: 't1' })
    expect(decideCollapse(turns[0], true)).toBe('schedule-idle')
    expect(decideCollapse(turns[0], false)).toBe('collapse-now')
  })

  it('折叠三条件：已自动折叠过 → skip（latch，每轮次只自动折叠一次）', () => {
    const turns = reduceEvent(buildFullTurn(), { type: 'auto_collapse', turnId: 't1' })
    expect(decideCollapse(turns[0], true)).toBe('skip')
    expect(decideCollapse(turns[0], false)).toBe('skip')
  })

  it('flattenTurn 单轮展平与 flattenTurns 全量展平逐行一致（渲染层轮次级增量缓存的前提）', () => {
    const turns = buildFullTurn()
    const expandedSingle = flattenTurn(turns[0], { abortedText: '已由用户停止' })
    const expandedAll = flattenTurns(turns, { abortedText: '已由用户停止' })
    expect(expandedSingle).toEqual(expandedAll)

    // 折叠态同样一致（折叠分支在 flattenTurn 内部，不能只测展开分支）
    const collapsedSingle = flattenTurn(collapse(turns)[0], { abortedText: '已由用户停止' })
    const collapsedAll = flattenTurns(collapse(turns), { abortedText: '已由用户停止' })
    expect(collapsedSingle).toEqual(collapsedAll)
  })
})


// ── R14 回归：Rust serde lowercase 角色名 ──────────────────────────────

describe('R14 回归：toolresult（serde lowercase 实际值）', () => {
  // Rust MessageRole 为 #[serde(rename_all = "lowercase")]，持久化角色是 "toolresult"；
  // 此前只匹配 'tool_result'/'toolResult' → action_end 全不触发 → settleRunningActions
  // 把全部命令段误标 failed。本用例以真实序列化值防回归。
  it('以 "toolresult" 为角色的回源：action_end 正确触发，成功命令段不再误标 failed', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: '读一下文件' } as never,
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', name: 'read_file', args: {} }],
      } as never,
      { role: 'toolresult', content: '{"stdout":"ok"}', tool_call_id: 'c1' } as never,
      { role: 'assistant', content: '读到了' } as never,
    ])

    expect(turns).toHaveLength(1)
    const actions = turns[0].segments.filter((s) => s.kind === 'action')
    expect(actions).toHaveLength(1)
    // R14 修复前：此处为 'failed'（settleRunningActions 兜底）
    expect(actions[0]).toMatchObject({ label: 'read_file', status: 'completed', result: '{"stdout":"ok"}' })
    expect(resultSegment(turns[0])?.text).toBe('读到了')
  })

  it('失败结果（error 键）以 "toolresult" 角色回源仍判 failed', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: 'x' } as never,
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'sh', args: {} }] } as never,
      { role: 'toolresult', content: '{"error":"not found"}', tool_call_id: 'c1' } as never,
    ] as never)

    const actions = turns[0].segments.filter((s) => s.kind === 'action')
    expect(actions[0]).toMatchObject({ status: 'failed' })
  })
})


// ── 行段模型 v2：ActionSegment.rowKind 分类 ──────────────────────────

describe('行段模型 v2：classifyActionRowKind（工具名 → 行段种类）', () => {
  it('六类行段种类归类正确', () => {
    expect(classifyActionRowKind('shell_session_exec')).toBe('terminal')
    expect(classifyActionRowKind('execute_command')).toBe('command')
    expect(classifyActionRowKind('git_status')).toBe('command')
    expect(classifyActionRowKind('content_search')).toBe('search')
    expect(classifyActionRowKind('web_search')).toBe('search')
    expect(classifyActionRowKind('read_file')).toBe('file')
    expect(classifyActionRowKind('fs_write')).toBe('file')
    expect(classifyActionRowKind('entity_create')).toBe('tool')
    expect(classifyActionRowKind('kb_search')).toBe('search')
    expect(classifyActionRowKind('mystery_tool_xyz')).toBe('other')
  })

  it('action_start 归约时写入 rowKind（数据层推导，与渲染解耦）', () => {
    const turns = reduceEvents([], [
      { type: 'turn_start', turnId: 't', userMessage: { id: 'u', text: 'x', timestamp: 1 } },
      { type: 'action_start', turnId: 't', id: 'a1', action: 'tool', label: 'execute_command' },
      { type: 'action_start', turnId: 't', id: 'a2', action: 'tool', label: 'content_search' },
    ] as never)
    const actions = turns[0].segments.filter((s) => s.kind === 'action')
    expect(actions[0]).toMatchObject({ rowKind: 'command' })
    expect(actions[1]).toMatchObject({ rowKind: 'search' })
  })

  it('flattenTurns 展平 action 行携带 rowKind（渲染透传链数据源）', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: 'x' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'shell_session_exec', args: {} }] },
      { role: 'toolresult', content: '{"stdout":"ok"}', tool_call_id: 'c1' },
    ] as never)
    const rows = flattenTurns(turns).filter((r) => r.type === 'action')
    expect(rows[0]).toMatchObject({ label: 'shell_session_exec', rowKind: 'terminal' })
  })
})


describe('shell exit_code≠0 失败判定（观察项落地）', () => {
  it('exit_code=0 成功；exit_code=1 无 error 键也判 failed', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: 'x' } as never,
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'sh', args: {} }, { id: 'c2', name: 'sh', args: {} }] } as never,
      { role: 'toolresult', content: '{"stdout":"ok","__meta":{"exit_code":0}}', tool_call_id: 'c1' } as never,
      { role: 'toolresult', content: '{"stdout":"","stderr":"找不到文件","__meta":{"exit_code":1}}', tool_call_id: 'c2' } as never,
    ] as never)
    const actions = turns[0].segments.filter((s) => s.kind === 'action')
    expect(actions[0]).toMatchObject({ status: 'completed' })
    expect(actions[1]).toMatchObject({ status: 'failed' })
  })
})

describe('R6 第三部分：动作段事件翻译与回源重建', () => {
  it.each([
    ['subagent.start', 'subagent', { phase: 'start', subAgentId: 'sa-1', name: '写作助手', task: '写段落' }, 1, 'subagent'],
    ['subagent.completed', 'subagent', { phase: 'completed', subAgentId: 'sa-1', outputChars: 120, durationMs: 1500 }, 1, ''],
    ['subagent.error', 'subagent', { phase: 'error', subAgentId: 'sa-1' }, 1, ''],
    ['phase.entered', 'phase', { event: 'entered', runId: 'r-1', phase: 'plan' }, 1, 'phase'],
    ['phase.result-success', 'phase', { event: 'result', runId: 'r-1', phase: 'plan', status: 'Success', summary: '3 步' }, 1, ''],
    ['phase.result-failed', 'phase', { event: 'result', runId: 'r-1', phase: 'plan', status: 'Failed', summary: '重规划' }, 1, ''],
    ['phase.pipe-skeleton', 'phase', { event: 'pipe_started', runId: 'r-1' }, 0, ''],
    ['router', 'router', { phase: 'decision', target: 'query' }, 2, 'router'],
    ['reflection', 'reflection', { result: { score: 80 } }, 2, 'reflection'],
    ['confirm.requested', 'confirm', { phase: 'requested', confirmId: 'cf-1', tool: 'entity_create' }, 1, 'confirm'],
    ['confirm.resolved-approved', 'confirm', { phase: 'resolved', confirmId: 'cf-1', approved: true }, 1, ''],
    ['unknown', 'unknown_action', { phase: 'x' }, 0, ''],
  ])('%s → %i 条事件', (_name, action, payload, count, firstAction) => {
    const events = actionEventToTurnEvents('t1', action as string, payload as Record<string, unknown>)
    expect(events).toHaveLength(count)
    if (firstAction && count > 0) {
      expect(events[0]).toMatchObject({ type: 'action_start', action: firstAction, turnId: 't1' })
    }
  })

  it('subagent 配对：start 段被 completed 收口，携带耗时', () => {
    let turns = startTurn()
    for (const te of actionEventToTurnEvents('t1', 'subagent', { phase: 'start', subAgentId: 'sa-1', name: '写作助手', task: '写段落' })) turns = reduceEvent(turns, te)
    for (const te of actionEventToTurnEvents('t1', 'subagent', { phase: 'completed', subAgentId: 'sa-1', outputChars: 120, durationMs: 1500 })) turns = reduceEvent(turns, te)
    const seg = turns[0].segments[0]
    expect(seg).toMatchObject({ kind: 'action', action: 'subagent', label: '写作助手', status: 'completed', durationMs: 1500 })
  })

  it('phase entered/result 成段并在 Status 映射失败态', () => {
    let turns = startTurn()
    for (const te of actionEventToTurnEvents('t1', 'phase', { event: 'result', runId: 'r-1', phase: 'execute', status: 'Failed', summary: '重规划耗尽' })) turns = reduceEvent(turns, te)
    // 无 entered 先行 → result 的 end 找不到配对（幂等忽略），不产生悬空段
    expect(turns[0].segments.filter((s) => s.kind === 'action')).toHaveLength(0)
  })

  it('回源重建：assistant.meta.action_events → 动作段入过程层、正文保留结果层', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: '调研主题' } as never,
      {
        role: 'assistant',
        content: '最终结论正文',
        meta: {
          action_events: [
            { seq: 0, action: 'phase', event: 'entered', runId: 'r-1', phase: 'plan' },
            { seq: 1, action: 'phase', event: 'result', runId: 'r-1', phase: 'plan', status: 'Success', summary: '3 步' },
            { seq: 2, action: 'subagent', phase: 'start', subAgentId: 'sa-1', name: '写作助手', task: '写段落' },
            { seq: 3, action: 'subagent', phase: 'completed', subAgentId: 'sa-1', outputChars: 120, durationMs: 1500 },
            { seq: 4, action: 'router', phase: 'decision', target: 'query' },
          ],
        },
      } as never,
    ] as never)
    const structure = structureOf(turns)
    expect(structure[0].result).toBe('最终结论正文')
    const actions = turns[0].segments.filter((s) => s.kind === 'action')
    // phase 段 + subagent 段 + router 瞬时段
    expect(actions).toHaveLength(3)
    expect(actions[0]).toMatchObject({ action: 'phase', label: 'plan', status: 'completed' })
    expect(actions[1]).toMatchObject({ action: 'subagent', label: '写作助手', status: 'completed', durationMs: 1500 })
    expect(actions[2]).toMatchObject({ action: 'router', status: 'completed' })
  })

  it('回源重建：无动作段的事件序为空不动，正文仍正常（回归）', () => {
    const turns = rebuildFromMessages([
      { role: 'user', content: 'x' } as never,
      { role: 'assistant', content: '回复', meta: {} } as never,
    ] as never)
    expect(turns[0].segments.length).toBeGreaterThan(0)
    expect(resultSegment(turns[0])?.text).toBe('回复')
  })
})

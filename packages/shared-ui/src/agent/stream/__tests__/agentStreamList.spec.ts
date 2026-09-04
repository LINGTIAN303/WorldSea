// aggregatePlanBlocks 顺序无关聚合单测（A，2026-09-04）
// 覆盖：步骤行/子动作/普通行顺叙、乱序（子动作先于步骤行）、交错、多步骤隔离。
import { describe, it, expect } from 'vitest'
import { aggregatePlanBlocks } from '../aggregatePlanBlocks'
import type { AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'

/** 构造工具行（工具/步骤通用） */
function toolRow(id: string, label: string, extra: Record<string, unknown> = {}): AgentStreamItem {
  return {
    type: 'tool',
    id,
    timestamp: 1,
    tc: { label } as unknown as AgentStreamItem extends { tc: infer T } ? T : never,
    ...extra,
  } as unknown as AgentStreamItem
}

function stepRow(id: string, label: string, childRefIds: string[] = []): AgentStreamItem {
  return toolRow(id, label, { isPlanStep: true, childRefIds, stepCollapsed: true })
}

/** 拿块（带 _step） */
function stepsOf(blocks: ReturnType<typeof aggregatePlanBlocks>) {
  return blocks.filter((b) => (b as { _step?: unknown })._step) as Array<{
    id: string
    _step: AgentStreamItem & { id: string }
    _children: AgentStreamItem[]
  }>
}

describe('aggregatePlanBlocks', () => {
  it('顺叙：步骤行在前、子动作在后 → 全部归入块', () => {
    const process = [
      stepRow('p1', '步骤一', ['t1']),
      toolRow('t1', 'read_file'),
      stepRow('p2', '步骤二', ['t2']),
      toolRow('t2', 'bash'),
    ]
    const blocks = aggregatePlanBlocks(process)
    const steps = stepsOf(blocks)
    expect(steps).toHaveLength(2)
    expect(steps[0]._children.map((c) => c.id)).toEqual(['t1'])
    expect(steps[1]._children.map((c) => c.id)).toEqual(['t2'])
  })

  it('乱序：子动作先于步骤行到达 → 仍归入块（不平铺）', () => {
    // 真实场景：PlanStepUpdate 广播晚于工具行 → 步骤行出现在子动作之后
    const process = [
      toolRow('t1', 'read_file'),
      toolRow('c1', 'plan_update'),
      stepRow('p1', '步骤一', ['t1', 'c1']),
    ]
    const blocks = aggregatePlanBlocks(process)
    const steps = stepsOf(blocks)
    expect(steps).toHaveLength(1)
    // 块内保持子动作原始相对顺序
    expect(steps[0]._children.map((c) => c.id)).toEqual(['t1', 'c1'])
  })

  it('交错：多步骤子动作交错到达 → 各归其块', () => {
    const process = [
      toolRow('t2', 'bash'), // 步骤二的子动作先到
      stepRow('p1', '步骤一', ['t1']),
      toolRow('t1', 'read_file'),
      toolRow('t3', 'grep'), // 步骤二另一个子动作
      stepRow('p2', '步骤二', ['t2', 't3']),
    ]
    const blocks = aggregatePlanBlocks(process)
    const steps = stepsOf(blocks)
    expect(steps.map((s) => s._step.id)).toEqual(['p1', 'p2'])
    expect(steps[0]._children.map((c) => c.id)).toEqual(['t1'])
    expect(steps[1]._children.map((c) => c.id)).toEqual(['t2', 't3'])
  })

  it('普通行不入块：非子动作行保持普通行（顺序不变）', () => {
    const process = [
      toolRow('x1', 'web_search'),
      stepRow('p1', '步骤一', ['t1']),
      toolRow('t1', 'read_file'),
      toolRow('x2', 'bash'),
    ]
    const blocks = aggregatePlanBlocks(process)
    // 普通行 x1/x2 直出；仅步骤块 + 两普通行
    const steps = stepsOf(blocks)
    expect(steps).toHaveLength(1)
    expect(blocks.filter((b) => !(b as { _step?: unknown })._step).map((b) => (b as AgentStreamItem).id)).toEqual(['x1', 'x2'])
  })

  it('子动作 id 未在 childRefIds → 不入块（孤儿行直出）', () => {
    const process = [
      toolRow('orphan', 'bash'),
      stepRow('p1', '步骤一', ['t1']),
      toolRow('t1', 'read_file'),
    ]
    const blocks = aggregatePlanBlocks(process)
    const steps = stepsOf(blocks)
    expect(steps).toHaveLength(1)
    expect(steps[0]._children.map((c) => c.id)).toEqual(['t1'])
    expect(blocks.filter((b) => !(b as { _step?: unknown })._step).map((b) => (b as AgentStreamItem).id)).toEqual(['orphan'])
  })

  it('空/无步骤：原样返回', () => {
    expect(aggregatePlanBlocks([])).toEqual([])
    const onlyTools = [toolRow('a', 'bash'), toolRow('b', 'read_file')]
    const blocks = aggregatePlanBlocks(onlyTools)
    expect(blocks.map((b) => (b as AgentStreamItem).id)).toEqual(['a', 'b'])
  })
})
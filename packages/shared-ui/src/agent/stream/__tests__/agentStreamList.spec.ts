// aggregatePlanBlocks 顺序无关聚合单测（A，2026-09-04 升级：多级折叠树）
// 覆盖：步骤行/子动作/普通行顺叙、乱序（子动作先于步骤行）、交错、多步骤隔离、
//       组合行段（连续非文本行）、计划折叠区包裹、待办项内子动作组合、pending 过滤不在此层。
import { describe, it, expect } from 'vitest'
import {
  aggregatePlanBlocks,
  type ProcessBlock,
  type PlanItemBlock,
  type PlanZoneBlock,
  type CombinationBlock,
} from '../aggregatePlanBlocks'
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

function thinkRow(id: string): AgentStreamItem {
  return { type: 'think', id, text: '推理', status: 'complete', timestamp: 1 } as AgentStreamItem
}

function textRow(id: string): AgentStreamItem {
  return {
    type: 'assistant',
    id,
    timestamp: 1,
    msg: { id, role: 'assistant', content: '说明', timestamp: 1 },
  } as AgentStreamItem
}

function stepRow(id: string, label: string, childRefIds: string[] = []): AgentStreamItem {
  return toolRow(id, label, {
    isPlanStep: true,
    childRefIds,
    stepCollapsed: true,
    planOrder: 0,
    planDescription: '说明文字',
  })
}

/** 取块内全部 plan_item（递归进 plan_zone / plan_item rows） */
function planItemsOf(blocks: ProcessBlock[]): PlanItemBlock[] {
  const out: PlanItemBlock[] = []
  const walk = (list: ProcessBlock[]) => {
    for (const b of list) {
      if ((b as { kind?: string }).kind === 'plan_item') {
        const pi = b as PlanItemBlock
        out.push(pi)
        walk(pi.rows)
      } else if ((b as { kind?: string }).kind === 'plan_zone') {
        walk((b as PlanZoneBlock).items)
      }
    }
  }
  walk(blocks)
  return out
}

/** 取块内全部 combination（递归进 plan_zone / plan_item rows） */
function combinationsOf(blocks: ProcessBlock[]): CombinationBlock[] {
  const out: CombinationBlock[] = []
  const walk = (list: ProcessBlock[]) => {
    for (const b of list) {
      const kind = (b as { kind?: string }).kind
      if (kind === 'combination') out.push(b as CombinationBlock)
      else if (kind === 'plan_zone') walk((b as PlanZoneBlock).items)
      else if (kind === 'plan_item') walk((b as PlanItemBlock).rows)
    }
  }
  walk(blocks)
  return out
}

describe('aggregatePlanBlocks', () => {
  it('顺叙：步骤行在前、子动作在后 → 全部归入待办项块（子动作组合为组合行段）', () => {
    const process = [
      stepRow('p1', '步骤一', ['t1']),
      toolRow('t1', 'read_file'),
      stepRow('p2', '步骤二', ['t2']),
      toolRow('t2', 'bash'),
    ]
    const blocks = aggregatePlanBlocks(process)
    // 无前缀行 → 直接是 plan_zone
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as PlanZoneBlock).kind).toBe('plan_zone')
    const items = planItemsOf(blocks)
    expect(items.map((i) => i.item.id)).toEqual(['p1', 'p2'])
    // 子动作行收进待办项的组合行段
    const combos = combinationsOf(blocks)
    expect(combos[0].rows.map((r) => r.id)).toEqual(['t1'])
    expect(combos[1].rows.map((r) => r.id)).toEqual(['t2'])
  })

  it('乱序：子动作先于步骤行到达 → 仍归入块（不平铺）', () => {
    // 真实场景：PlanStepUpdate 广播晚于工具行 → 步骤行出现在子动作之后
    const process = [
      toolRow('t1', 'read_file'),
      toolRow('c1', 'plan_update'),
      stepRow('p1', '步骤一', ['t1', 'c1']),
    ]
    const blocks = aggregatePlanBlocks(process)
    const items = planItemsOf(blocks)
    expect(items).toHaveLength(1)
    const combo = combinationsOf(blocks)[0]
    // 块内保持子动作原始相对顺序
    expect(combo.rows.map((r) => r.id)).toEqual(['t1', 'c1'])
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
    const items = planItemsOf(blocks)
    expect(items.map((i) => i.item.id)).toEqual(['p1', 'p2'])
    const combos = combinationsOf(blocks)
    expect(combos[0].rows.map((r) => r.id)).toEqual(['t1'])
    expect(combos[1].rows.map((r) => r.id)).toEqual(['t2', 't3'])
  })

  it('普通行不入组合：text 行独立，前后 think/tool 各成组合；计划区从首待办项原位包裹', () => {
    const process = [
      textRow('x1'),
      thinkRow('y1'),
      toolRow('y2', 'web_search'),
      stepRow('p1', '步骤一', ['t1']),
      toolRow('t1', 'read_file'),
      thinkRow('y3'),
    ]
    const blocks = aggregatePlanBlocks(process)
    // 顶层：text 直出；think/tool 组合 → 组合块；zone（p1 及其后行）
    expect(blocks).toHaveLength(3)
    expect((blocks[0] as AgentStreamItem).id).toBe('x1') // text 直出
    const zone = blocks[2] as PlanZoneBlock
    expect(zone.kind).toBe('plan_zone')
    const items = planItemsOf(blocks)
    expect(items.map((i) => i.item.id)).toEqual(['p1'])
    // 首待办项之前的 think(y1)/tool(y2) 组合块
    const preCombos = combinationsOf([blocks[1]])
    expect(preCombos[0].rows.map((r) => r.id)).toEqual(['y1', 'y2'])
    // 待办项之后的 think(y3) 在 zone 内（组合行段）
    const zoneCombos = combinationsOf([zone])
    expect(zoneCombos.map((c) => c.rows.map((r) => r.id))).toEqual([
      ['t1'],
      ['y3'],
    ])
  })

  it('孤儿行直出：子动作 id 未在 childRefIds → 不归属任何待办项（顶层组合）', () => {
    const process = [
      toolRow('orphan', 'bash'),
      stepRow('p1', '步骤一', ['t1']),
      toolRow('t1', 'read_file'),
    ]
    const blocks = aggregatePlanBlocks(process)
    const items = planItemsOf(blocks)
    expect(items).toHaveLength(1)
    // 孤儿行在组合行段中直出（不在待办项内）
    const combos = combinationsOf(blocks)
    expect(combos[0].rows.map((r) => r.id)).toEqual(['orphan'])
    expect(combos[1].rows.map((r) => r.id)).toEqual(['t1'])
  })

  it('无步骤：连续非文本行段收进组合行段，text 直出', () => {
    expect(aggregatePlanBlocks([])).toEqual([])
    const process = [textRow('a'), toolRow('b', 'bash'), toolRow('c', 'read_file'), textRow('d')]
    const blocks = aggregatePlanBlocks(process)
    expect((blocks[0] as AgentStreamItem).id).toBe('a')
    expect((blocks[1] as CombinationBlock).kind).toBe('combination')
    expect((blocks[1] as CombinationBlock).rows.map((r) => r.id)).toEqual(['b', 'c'])
    expect((blocks[2] as AgentStreamItem).id).toBe('d')
  })

  it('待办项头字段透传：planOrder/planDescription 随 item 保留', () => {
    const process = [stepRow('p1', '步骤一', []), stepRow('p2', '步骤二', [])]
    const blocks = aggregatePlanBlocks(process)
    const items = planItemsOf(blocks)
    expect(items[0].item.planDescription).toBe('说明文字')
    expect(items[0].item.planOrder).toBe(0)
  })
})
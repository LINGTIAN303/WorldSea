/**
 * groupTurns 契约（2026-09-20 帧率修复③）
 *
 * 锁定的行为：
 * - 等价性：与「无缓存全量重建」产出的分组结构逐字段一致（复用不得改变渲染结果）
 * - 整组复用：某轮次在窗口内的源行引用未变 → 该组对象（含 `process` 块数组）**引用相同**
 *   （Vue 据此跳过 ProcessBlocks 子树 patch）；源行变化 → 只重建该组
 * - 缓存有界：窗口外轮次的条目被清理，避免跨会话长期累积
 */
import { describe, expect, it } from 'vitest'
import type { AgentStreamItem } from '@worldsea/shared-composables/agent/useAgent'
import { groupTurns, type GroupCacheEntry, type TurnGroup } from '../groupTurns'

function userRow(id: string, turnId: string): AgentStreamItem {
  return {
    type: 'user',
    id,
    turnId,
    timestamp: 1,
    msg: { id, role: 'user', content: '问题', timestamp: 1 },
  } as unknown as AgentStreamItem
}

function thinkRow(id: string, turnId: string, text = '推理'): AgentStreamItem {
  return { type: 'think', id, turnId, text, status: 'complete', timestamp: 1 } as unknown as AgentStreamItem
}

function resultRow(id: string, turnId: string, content = '答案'): AgentStreamItem {
  return {
    type: 'assistant',
    id,
    turnId,
    timestamp: 1,
    isResult: true,
    msg: { id, role: 'assistant', content, timestamp: 1 },
  } as unknown as AgentStreamItem
}

/** 一轮：用户行 + 过程行 + 结果行 */
function turnRows(n: number, thinkText = '推理'): AgentStreamItem[] {
  const tid = `t${n}`
  return [userRow(`u${n}`, tid), thinkRow(`k${n}`, tid, thinkText), resultRow(`r${n}`, tid)]
}

function rowsOfTurns(count: number): AgentStreamItem[] {
  const out: AgentStreamItem[] = []
  for (let i = 0; i < count; i++) for (const r of turnRows(i)) out.push(r)
  return out
}

/** 无缓存全量重建（等价性参照） */
function rebuild(items: AgentStreamItem[]): TurnGroup[] {
  return groupTurns(items, new Map<string, GroupCacheEntry>())
}

/** 只比较渲染相关字段（忽略内部缓存凭据） */
function renderShape(groups: TurnGroup[]) {
  return groups.map((g) => ({
    id: g.id,
    user: g.user?.id ?? null,
    result: g.result?.id ?? null,
    tail: g.tail.map((r) => r.id),
    processKinds: g.process.map((b) => (b as { kind?: string }).kind ?? (b as AgentStreamItem).id),
  }))
}

describe('groupTurns 等价性', () => {
  it('缓存命中与否产出的分组结构一致', () => {
    const items = rowsOfTurns(6)
    const cache = new Map<string, GroupCacheEntry>()
    const cold = groupTurns(items, cache)
    const warm = groupTurns(items, cache) // 全命中复用
    expect(renderShape(warm)).toEqual(renderShape(cold))

    // 单行变化（结果层内容更新）后仍与全量重建一致
    const changed = [...items]
    changed[changed.length - 1] = resultRow('r5', 't5', '答案 v2')
    expect(renderShape(groupTurns(changed, cache))).toEqual(renderShape(rebuild(changed)))
  })

  it('孤儿组 / 异常双结果组 / tail 行的分组语义不变', () => {
    // 切片从轮次中间开始：无用户行 → orphan 组承接
    const orphan = [thinkRow('k0', 't0'), resultRow('r0', 't0')]
    expect(renderShape(rebuild(orphan))[0].id).toBe('orphan-k0')

    // 同组双结果 → 第二个结果另起 tail 组
    const doubleResult = [userRow('u1', 't1'), resultRow('r1', 't1'), resultRow('r2', 't1')]
    const shapes = renderShape(rebuild(doubleResult))
    expect(shapes.map((s) => s.id)).toEqual(['t1', 'tail-r2'])
    expect(shapes[0].result).toBe('r1')
    expect(shapes[1].result).toBe('r2')

    // 结果层之后的行入 tail
    const withTail = [userRow('u2', 't2'), resultRow('r3', 't2'), thinkRow('k2', 't2')]
    expect(renderShape(rebuild(withTail))[0].tail).toEqual(['k2'])
  })
})

describe('groupTurns 整组复用（帧率修复③核心）', () => {
  it('未变轮次：分组对象与 process 块数组引用保持不变', () => {
    const items = rowsOfTurns(3)
    const cache = new Map<string, GroupCacheEntry>()
    const first = groupTurns(items, cache)

    const second = groupTurns(items, cache)
    for (let i = 0; i < first.length; i++) {
      expect(second[i], `组 ${i}`).toBe(first[i]) // 组对象同一引用
      expect(second[i].process).toBe(first[i].process) // 块数组同一引用
    }
  })

  it('单轮变化：只重建该轮次，其余轮次引用不变', () => {
    const items = rowsOfTurns(4)
    const cache = new Map<string, GroupCacheEntry>()
    const first = groupTurns(items, cache)

    // 模拟流式：末轮新增一行（其余行对象引用不变）
    const streamed = [...items, thinkRow('k3b', 't3', '继续推理')]
    const second = groupTurns(streamed, cache)

    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).toBe(first[2])
    expect(second[3]).not.toBe(first[3]) // 被触及的轮次重建
    expect(second[3].process).not.toBe(first[3].process)
  })

  it('内容原地更新（同一行对象引用）不触发重建', () => {
    // 归约器不可变：行内容变化必然换引用；此处锁定「引用相等即复用」的判据边界
    const items = rowsOfTurns(2)
    const cache = new Map<string, GroupCacheEntry>()
    const first = groupTurns(items, cache)
    expect(groupTurns([...items], cache)[0]).toBe(first[0])
  })

  it('缓存有界：窗口外轮次条目被清理', () => {
    const cache = new Map<string, GroupCacheEntry>()
    groupTurns(rowsOfTurns(20), cache) // 20 轮入缓存
    expect(cache.size).toBe(20)

    // 窗口滑到只有 3 轮 → 超过 3×2 触发清理
    const windowed = rowsOfTurns(3)
    groupTurns(windowed, cache)
    expect(cache.size).toBe(3)
  })
})

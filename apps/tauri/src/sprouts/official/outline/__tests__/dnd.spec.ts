/**
 * dnd 单测 —— 白板拖拽载荷的读写与「是否接受这次拖拽」的判定。
 *
 * jsdom 不实现 DataTransfer 构造函数，故用最小替身（只实现被测代码真正用到的 `types` 与 `getData`）。
 * 这两个函数看起来简单，但它们决定「拖拽到底能不能落地」——2026-09-17 真机反馈
 * 「右栏拖拽像没实现」，根因候选正是 drop 侧缺 `dropEffect`/类型判定，故补测试锁住行为。
 */
import { describe, it, expect } from 'vitest'
import { acceptsNodeDrag, NODE_DND_MIME, readNodeIdFromDnD } from '../board/dnd'

function dataTransfer(types: string[], data: Record<string, string> = {}): DataTransfer {
  return {
    types,
    getData: (t: string) => data[t] ?? '',
  } as unknown as DataTransfer
}

function dragEvent(dt: DataTransfer | null): DragEvent {
  return { dataTransfer: dt } as unknown as DragEvent
}

describe('dnd / acceptsNodeDrag', () => {
  it('types 含本芽 MIME → 接受', () => {
    expect(acceptsNodeDrag(dataTransfer([NODE_DND_MIME]))).toBe(true)
  })

  it('含其它类型（如系统拖文件）→ 不接受', () => {
    expect(acceptsNodeDrag(dataTransfer(['Files']))).toBe(false)
    expect(acceptsNodeDrag(dataTransfer(['text/plain']))).toBe(false)
  })

  it('混合类型里含本芽 MIME → 接受（拖拽载荷同时写了 text/plain 也照样认）', () => {
    expect(acceptsNodeDrag(dataTransfer(['text/plain', NODE_DND_MIME]))).toBe(true)
  })

  it('空 / 缺失 dataTransfer → 不接受（不抛错）', () => {
    expect(acceptsNodeDrag(dataTransfer([]))).toBe(false)
    expect(acceptsNodeDrag(null)).toBe(false)
  })
})

describe('dnd / readNodeIdFromDnD', () => {
  it('从本芽 MIME 读出节点 id', () => {
    const ev = dragEvent(dataTransfer([NODE_DND_MIME], { [NODE_DND_MIME]: 'node-1' }))
    expect(readNodeIdFromDnD(ev)).toBe('node-1')
  })

  it('读不到 → null（不是空串，调用方据此提前返回）', () => {
    expect(readNodeIdFromDnD(dragEvent(dataTransfer([NODE_DND_MIME])))).toBeNull()
    expect(readNodeIdFromDnD(dragEvent(null))).toBeNull()
  })

  it('getData 抛错时返回 null 而不是把异常抛给 drop 流程', () => {
    const throwing = {
      types: [NODE_DND_MIME],
      getData: () => { throw new Error('SecurityError') },
    } as unknown as DataTransfer
    expect(readNodeIdFromDnD(dragEvent(throwing))).toBeNull()
  })

  it('MIME 常量保持稳定（跨版本兼容：旧拖拽源写的是同一个字符串）', () => {
    expect(NODE_DND_MIME).toBe('application/x-worldsea-outline-node')
  })
})

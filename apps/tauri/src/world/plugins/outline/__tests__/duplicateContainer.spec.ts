/**
 * 复制容器 · 布局侧纯函数单测（2026-10-18，Q1=A）
 *
 * 护栏重点：
 *   ① 组件必须**换新 id**（否则两容器的组件 id 撞车）；
 *   ② `config` 必须**深一层拷贝**（否则改副本会改到源）；
 *   ③ 折叠态不复制（新容器必须可见）；自适应尺寸不复制 `size`；
 *   ④ 新节点已在本板有容器时必须拒绝（一板一节点一容器）。
 */
import { describe, it, expect } from 'vitest'
import { cloneContainerIntoLayout } from '../board/duplicateContainer'
import {
  createComponent,
  createContainer,
  createEmptyBoardLayout,
  type BoardContainer,
  type OutlineBoardLayout,
} from '../board/layoutSchema'

function seed(container: BoardContainer): OutlineBoardLayout {
  return { ...createEmptyBoardLayout(), containers: [container] }
}

function sampleContainer(): BoardContainer {
  const c = createContainer('node-a', { x: 100, y: 200 })
  c.size = { w: 216, h: 306 }
  c.components = [
    createComponent('title', 0, { numbered: true }),
    createComponent('progress', 1),
  ]
  return c
}

describe('cloneContainerIntoLayout', () => {
  it('复制出独立容器：新 id、指向新节点、位置右下偏移 +24', () => {
    const src = sampleContainer()
    const res = cloneContainerIntoLayout(seed(src), src.id, 'node-b')
    expect(res).not.toBeNull()
    const created = res!.layout.containers.find(c => c.id === res!.containerId)!
    expect(created.id).not.toBe(src.id)
    expect(created.nodeId).toBe('node-b')
    expect(created.pos).toEqual({ x: 124, y: 224 })
    expect(res!.layout.containers).toHaveLength(2)
  })

  it('组件数量与顺序一致，但组件 id 全部换新', () => {
    const src = sampleContainer()
    const res = cloneContainerIntoLayout(seed(src), src.id, 'node-b')!
    const created = res.layout.containers.find(c => c.id === res.containerId)!
    expect(created.components.map(c => c.form)).toEqual(['title', 'progress'])
    expect(created.components.map(c => c.order)).toEqual([0, 1])
    const srcIds = new Set(src.components.map(c => c.id))
    for (const c of created.components) expect(srcIds.has(c.id)).toBe(false)
  })

  it('config 是深一层拷贝：改副本不影响源', () => {
    const src = sampleContainer()
    const res = cloneContainerIntoLayout(seed(src), src.id, 'node-b')!
    const created = res.layout.containers.find(c => c.id === res.containerId)!
    expect(created.components[0].config).toEqual({ numbered: true })
    expect(created.components[0].config).not.toBe(src.components[0].config)
    ;(created.components[0].config as Record<string, unknown>).numbered = false
    expect(src.components[0].config).toEqual({ numbered: true })
  })

  it('尺寸随源复制；源为自适应时不产生 size', () => {
    const sized = sampleContainer()
    const a = cloneContainerIntoLayout(seed(sized), sized.id, 'n1')!
    expect(a.layout.containers[1].size).toEqual({ w: 216, h: 306 })

    const auto = createContainer('node-c', { x: 0, y: 0 })
    auto.components = [createComponent('title', 0)]
    const b = cloneContainerIntoLayout(seed(auto), auto.id, 'n2')!
    expect(b.layout.containers[1].size).toBeUndefined()
  })

  it('折叠态不复制（新容器必须可见）', () => {
    const src = sampleContainer()
    src.collapsed = true
    const res = cloneContainerIntoLayout(seed(src), src.id, 'node-b')!
    expect(res.layout.containers[1].collapsed).toBeUndefined()
  })

  it('源容器不存在 → null', () => {
    expect(cloneContainerIntoLayout(seed(sampleContainer()), 'no-such', 'n')).toBeNull()
  })

  it('新节点已在本板有容器 → null（一板一节点一容器）', () => {
    const src = sampleContainer()
    const occupied = createContainer('node-b', { x: 0, y: 0 })
    const layout: OutlineBoardLayout = { ...createEmptyBoardLayout(), containers: [src, occupied] }
    expect(cloneContainerIntoLayout(layout, src.id, 'node-b')).toBeNull()
  })
})

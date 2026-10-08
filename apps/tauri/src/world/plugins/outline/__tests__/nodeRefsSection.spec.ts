/**
 * NodeRefsSection（Inspector「关联实体」编辑行）行为测试（2026-10-08）。
 *
 * 锁的契约：写入唯一经 outlineLinks（幂等）经 relationStore 即时刷新；类型从注册表
 * 反查——唯一合法直建、建筑二义默认「发生于」且行内可一键改；解除即时；跳转走
 * ws-navigate 新契约形状 { entityType, entityId }。
 *
 * Teleport 注意：添加浮层经 FloatingPanel Teleport 到 body，VTU wrapper.find 不穿透，
 * 浮层内容一律用 document 查询。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useEntityStore, useRelationStore, type Entity } from '@worldsea/entity-core'

import NodeRefsSection from '../board/components/NodeRefsSection.vue'

function ent(id: string, type: string, name: string): Entity {
  return { id, type, name, description: '', properties: {}, tags: [], createdAt: '', updatedAt: '' } as Entity
}

const NODE = ent('n1', 'outline_node', '第一幕')
const CHAR = ent('c1', 'character', '阿甲')
const REGION = ent('g1', 'region', '王城')
const BUILDING = ent('b1', 'building', '城堡')
const ITEM = ent('i1', 'item', '铁剑')

let pinia: Pinia
let wrapper: VueWrapper | undefined

async function seed() {
  const es = useEntityStore()
  for (const e of [NODE, CHAR, REGION, BUILDING, ITEM]) await es.add(e)
}

async function seedRef(type = 'outline_mentions', targetId = 'c1') {
  await useRelationStore().add({
    id: `rel-${type}-${targetId}`,
    type,
    sourceId: 'n1',
    targetId,
    properties: {},
    createdAt: '',
    updatedAt: '',
  } as never)
}

function mountSection() {
  wrapper = mount(NodeRefsSection, { props: { node: NODE }, global: { plugins: [pinia] } })
  return wrapper
}

/** 浮层（Teleport 到 body）里的候选按钮 */
function candButtons(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('.nrs-cand')]
}
function findCand(name: string): HTMLElement | undefined {
  return candButtons().find(el => el.textContent?.includes(name))
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
  await seed()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.querySelectorAll('.fp-panel, .fp-overlay').forEach(el => el.remove())
})

describe('NodeRefsSection / 列表与候选', () => {
  it('未关联：空态可见；候选＝合法目标类型实体，大纲节点自身不入候选', async () => {
    const w = mountSection()
    expect(w.find('.nrs-empty').exists()).toBe(true)

    await w.find('.nrs-add').trigger('click')
    await nextTick()

    expect(candButtons()).toHaveLength(4)
    expect(findCand('阿甲')).toBeTruthy()
    expect(findCand('第一幕')).toBeUndefined()
  })

  it('已有关联：列表显示名字与关系标签；孤儿关系（实体已删）不显示', async () => {
    await seedRef('outline_located_in', 'g1')
    const w = mountSection()
    await vi.waitFor(() => expect(w.find('.nrs-name').exists()).toBe(true))
    expect(w.find('.nrs-name').text()).toBe('王城')
    expect(w.find('.nrs-rel').text()).toBe('发生于')

    // 孤儿：关系指向不存在的实体
    await seedRef('outline_mentions', 'ghost')
    await nextTick()
    expect(w.findAll('.nrs-item')).toHaveLength(1)
  })
})

describe('NodeRefsSection / 建立与改类型', () => {
  it('区域唯一合法：点击候选直建「发生于」，候选即时移除（已关联排除）', async () => {
    const w = mountSection()
    await w.find('.nrs-add').trigger('click')
    await nextTick()
    findCand('王城')!.click()

    await vi.waitFor(() => {
      const rels = useRelationStore().relations.filter(r => r.type === 'outline_located_in')
      expect(rels).toHaveLength(1)
      expect(rels[0]).toMatchObject({ sourceId: 'n1', targetId: 'g1' })
    })
    await nextTick()
    expect(w.find('.nrs-name').text()).toBe('王城')
    expect(w.find('.nrs-rel').text()).toBe('发生于')
    expect(findCand('王城')).toBeUndefined()
  })

  it('建筑二义：默认「发生于」；行内「改」→ 一键换「提及」（先建后删，不留丢关联窗口）', async () => {
    const w = mountSection()
    await w.find('.nrs-add').trigger('click')
    await nextTick()
    findCand('城堡')!.click()

    await vi.waitFor(() => {
      const rels = useRelationStore().relations.filter(r => r.targetId === 'b1')
      expect(rels).toHaveLength(1)
      expect(rels[0].type).toBe('outline_located_in')
    })
    await nextTick()
    const swapBtn = w.findAll('.nrs-act').find(b => b.text().includes('改'))
    expect(swapBtn?.text()).toContain('提及')

    await swapBtn!.trigger('click')
    await vi.waitFor(() => {
      const rels = useRelationStore().relations.filter(r => r.targetId === 'b1')
      expect(rels).toHaveLength(1)
      expect(rels[0].type).toBe('outline_mentions')
    })
  })

  it('唯一合法的行不显示「改」按钮（无第二类型可换）', async () => {
    await seedRef('outline_located_in', 'g1')
    const w = mountSection()
    await vi.waitFor(() => expect(w.find('.nrs-name').exists()).toBe(true))
    expect(w.findAll('.nrs-act').filter(b => b.text().includes('改'))).toHaveLength(0)
  })
})

describe('NodeRefsSection / 解除与跳转', () => {
  it('解除：行内解除 → 关系清空、空态回归', async () => {
    await seedRef('outline_located_in', 'g1')
    const w = mountSection()
    await vi.waitFor(() => expect(w.find('.nrs-name').exists()).toBe(true))

    await w.find('.nrs-act--danger').trigger('click')
    await vi.waitFor(() => {
      expect(useRelationStore().relations.filter(r => r.sourceId === 'n1' || r.targetId === 'n1')).toHaveLength(0)
    })
    await nextTick()
    expect(w.find('.nrs-empty').exists()).toBe(true)
  })

  it('跳转：点击联动名派发 ws-navigate 新契约形状', async () => {
    await seedRef('outline_located_in', 'g1')
    const w = mountSection()
    await vi.waitFor(() => expect(w.find('.nrs-name').exists()).toBe(true))

    const events: unknown[] = []
    const onNav = (e: Event) => { events.push((e as CustomEvent).detail) }
    window.addEventListener('ws-navigate', onNav)
    try {
      await w.find('.nrs-name').trigger('click')
      expect(events).toEqual([{ entityType: 'region', entityId: 'g1' }])
    } finally {
      window.removeEventListener('ws-navigate', onNav)
    }
  })
})

describe('NodeRefsSection / 挂载守卫', () => {
  it('BoardInspector 以 :node 挂载本件（调用形状正则，防摘）', () => {
    const src = readFileSync(join(__dirname, '..', 'board', 'components', 'BoardInspector.vue'), 'utf8')
    expect(src).toMatch(/<NodeRefsSection\s+:node="node"\s*\/>/)
  })
})

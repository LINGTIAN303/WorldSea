/**
 * NodeDetailDock（节点详情载体）行为测试（2026-10-08「outline 接入详情载体」裁定）。
 *
 * 锁：缺省＝抽屉载体（panel-id 用 outline_node 命名空间）；node 为空/载体关闭 → 隐藏；
 * NodeDetailView 的事件透传到装配层（updateNodeField / unlinkChapter / openNode）；
 * BoardView 以调用形状挂载本件（防摘）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCarrier } from '@worldsea/plugin-sdk'
import type { Entity } from '@worldsea/entity-core'

import NodeDetailDock from '../board/components/NodeDetailDock.vue'
import NodeDetailView from '../board/components/NodeDetailView.vue'

/** 抽屉载体组件（注册表取引用——包根不导出载体件本体，与 detailCarrier.spec 的相对导入同物） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DRAWER = getCarrier('drawer')!.component as any

const NODE = {
  id: 'n1', type: 'outline_node', name: '第一幕', description: '', tags: [],
  properties: { status: '草稿', nodeType: 'scene' },
} as unknown as Entity

let pinia: Pinia

function mountDock(props: Record<string, unknown> = {}, shallow = true) {
  return mount(NodeDetailDock, {
    props: { node: NODE, ...props },
    global: { plugins: [pinia] },
    shallow,
  })
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  // 载体覆写落 localStorage：不清会左右用例（detailCarrier.spec 的既有纪律）
  localStorage.clear()
})

describe('NodeDetailDock', () => {
  it('缺省＝抽屉载体，panel-id 走 outline_node 命名空间（防与实体芽串键）', async () => {
    const w = mountDock()
    await nextTick()
    const carrier = w.findComponent(DRAWER)
    expect(carrier.exists()).toBe(true)
    expect(carrier.props('panelId')).toBe('detail-outline_node')
    expect(carrier.props('visible')).toBe(true)
    expect(carrier.props('entity')).toMatchObject({ id: 'n1' })
  })

  it('node 为空 → 载体隐藏（无选中不出详情）', async () => {
    const w = mountDock({ node: null })
    await nextTick()
    expect(w.findComponent(DRAWER).props('visible')).toBe(false)
  })

  it('载体关闭后隐藏；换节点时重置（重新可见）', async () => {
    const w = mountDock()
    await nextTick()
    w.findComponent(DRAWER).vm.$emit('close')
    await nextTick()
    expect(w.findComponent(DRAWER).props('visible')).toBe(false)

    await w.setProps({ node: { ...NODE, id: 'n2' } as Entity })
    await nextTick()
    expect(w.findComponent(DRAWER).props('visible')).toBe(true)
  })

  it('槽内容事件透传：updateNodeField / unlinkChapter / openNode', async () => {
    const w = mountDock({ linkedChapterName: '第一章' }, false)
    await nextTick()
    const view = w.findComponent(NodeDetailView)
    expect(view.exists()).toBe(true)
    expect(view.props('linkedChapterName')).toBe('第一章')

    view.vm.$emit('updateNodeField', 'status', '完成', '改状态')
    view.vm.$emit('unlinkChapter')
    view.vm.$emit('openNode')
    expect(w.emitted('updateNodeField')![0]).toEqual(['status', '完成', '改状态'])
    expect(w.emitted('unlinkChapter')).toHaveLength(1)
    expect(w.emitted('openNode')).toHaveLength(1)
  })
})

describe('NodeDetailDock / 挂载守卫', () => {
  it('BoardView 以调用形状挂载本件（防摘）', () => {
    const src = readFileSync(join(__dirname, '..', 'board', 'BoardView.vue'), 'utf8')
    expect(src).toMatch(/<NodeDetailDock\s+:node="inspectedNode"/)
  })
})

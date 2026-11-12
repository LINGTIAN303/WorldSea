/**
 * 「打开正文」外部导航 composable 行为测试（2026-10-08）。
 *
 * 锁的契约：跨视图跳转（挂起位）与同视图跳转（事件通道）都能落到
 * 「先落书、后开章」（openBook 内部 await flushSave 后会清 current，顺序不可颠倒）；
 * bookId 失效/缺失 → 未归书层；实体不存在/类型不符 → no-op；卸载即注销。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { useEntityStore, useUIStore, type Entity } from '@worldsea/entity-core'

import { useManuscriptExternalNav } from '../composables/useManuscriptExternalNav'
import { installStoreServices } from './storeServices'
import { clearWorldServiceTable } from '../../../service-registry'

function ent(id: string, type: string, name: string, props: Record<string, unknown> = {}): Entity {
  return { id, type, name, description: '', properties: props, tags: [], createdAt: '', updatedAt: '' } as Entity
}

const BOOK = ent('b1', 'book', '第一卷')
const CH = ent('ch1', 'manuscript', '第一章', { bookId: 'b1' })
const ORPHAN = ent('ch2', 'manuscript', '孤儿章', { bookId: 'b-gone' })
const NOBOOK = ent('ch3', 'manuscript', '未归章', {})

let pinia: Pinia
let wrapper: VueWrapper | undefined

async function seed() {
  const es = useEntityStore()
  for (const e of [BOOK, CH, ORPHAN, NOBOOK]) await es.add(e)
}

interface Calls {
  openBook: string[]
  openChapter: string[]
  /** 调用顺序（「先落书、后开章」是硬契约：openBook 内部会清 current） */
  order: string[]
}

function makeHarness(): Calls {
  const calls: Calls = { openBook: [], openChapter: [], order: [] }
  const deps = {
    openBook: async (id: string) => { calls.openBook.push(id); calls.order.push(`book:${id}`) },
    openChapter: (e: Entity) => { calls.openChapter.push(e.id); calls.order.push(e.id) },
  }
  const Host = defineComponent({
    setup() {
      useManuscriptExternalNav(deps)
      return () => h('div')
    },
  })
  wrapper = mount(Host, { global: { plugins: [pinia] } })
  return calls
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
  // useManuscriptExternalNav 已改经树服务取数（批次 H），不起树时必须登记转发服务表
  installStoreServices()
  await seed()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  clearWorldServiceTable()
})

describe('useManuscriptExternalNav', () => {
  it('挂起位（跨视图跳转）：先落书、后开章', async () => {
    useUIStore().selectEntity('ch1')
    const calls = makeHarness()
    await vi.waitFor(() => expect(calls.openChapter).toEqual(['ch1']))
    expect(calls.openBook).toEqual(['b1'])
    expect(calls.order).toEqual(['book:b1', 'ch1'])
  })

  it('事件通道（已挂载）：ws-select-entity → 打开归属书与章节', async () => {
    const calls = makeHarness()
    await flush()
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: 'ch1' } }))
    await vi.waitFor(() => expect(calls.openChapter).toEqual(['ch1']))
    expect(calls.openBook).toEqual(['b1'])
    expect(calls.order).toEqual(['book:b1', 'ch1'])
  })

  it('bookId 失效 → 落到「未归书」层', async () => {
    useUIStore().selectEntity('ch2')
    const calls = makeHarness()
    await vi.waitFor(() => expect(calls.openChapter).toEqual(['ch2']))
    expect(calls.openBook).toEqual([''])
    expect(calls.order).toEqual(['book:', 'ch2'])
  })

  it('无 bookId → 未归书层', async () => {
    useUIStore().selectEntity('ch3')
    const calls = makeHarness()
    await vi.waitFor(() => expect(calls.openChapter).toEqual(['ch3']))
    expect(calls.openBook).toEqual([''])
  })

  it('实体不存在 / 类型不符（book）→ no-op', async () => {
    useUIStore().selectEntity('b1')
    const calls = makeHarness()
    await flush()
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: 'nope' } }))
    await flush()
    expect(calls.openBook).toEqual([])
    expect(calls.openChapter).toEqual([])
  })

  it('卸载后事件不再响应', async () => {
    const calls = makeHarness()
    await flush()
    wrapper!.unmount()
    wrapper = undefined
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: 'ch1' } }))
    await flush()
    expect(calls.openChapter).toEqual([])
  })
})

/**
 * boardLayout 单测 —— 布局体解析容错 + 白板布局读写（store 级）。
 *
 * 【为什么 store 级】useBoardLayout 的写路径要经过实体 store（properties 整体替换语义），
 * 只有接真实 store 才能验证「保存不丢其他字段」这个最容易踩的坑。
 * 【环境】entity store 持久化走 Dexie/IndexedDB → fake-indexeddb；tauri invoke 需 mock。
 * 【断言纪律】共享 IndexedDB，故每条断言用唯一 id/名字（不用"总数"这类会被前序用例污染的断言）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `http://asset.localhost/${p}`,
}))

import {
  BOARD_LAYOUT_VERSION,
  createEmptyBoardLayout,
  findContainerByNode,
  parseBoardLayout,
  serializeBoardLayout,
  type OutlineBoardLayout,
} from '../board/layoutSchema'
// 用 ReturnType 精确取 store / composable 的类型：避免 any 造成回调参数隐式 any
import type { useEntityStore as UseEntityStore } from '@worldsea/entity-core'
import type { useBoardLayout as UseBoardLayout } from '../board/composables/useBoardLayout'

type EntityStoreApi = ReturnType<typeof UseEntityStore>
type BoardLayoutApi = ReturnType<typeof UseBoardLayout>

function uid(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** 造一个白板实体（properties 含全部字段，用于验证保存不丢字段） */
async function createBoard(
  es: { add: (entity: any) => Promise<string> },
  name: string,
): Promise<string> {
  const id = uid('board')
  const now = new Date().toISOString()
  await es.add({
    id,
    type: 'outline_board',
    name,
    description: '测试白板',
    properties: {
      viewport: '{"zoom":1.5,"panX":12,"panY":-8}',
      layout: '',
      thumbnail: 'asset://thumb.png',
      snap: 'guides',
      gridEnabled: true,
    },
    tags: [],
    createdAt: now,
    updatedAt: now,
  })
  return id
}

/**
 * 动态 import 缓存：entity-core/store 链首次编译较重（冷启动，实测 4.6s），
 * 放 beforeAll 预热并放宽预算，避免在用例内吃 5s 默认超时（照 agentDataBridges.spec 的做法）。
 */
let useEntityStoreRef: (() => EntityStoreApi) | null = null
let useBoardLayoutRef: (() => BoardLayoutApi) | null = null

beforeAll(async () => {
  useEntityStoreRef = (await import('@worldsea/entity-core')).useEntityStore as () => EntityStoreApi
  useBoardLayoutRef = (await import('../board/composables/useBoardLayout')).useBoardLayout as () => BoardLayoutApi
}, 30000)

async function setup() {
  setActivePinia(createPinia())
  const es = (useEntityStoreRef as () => EntityStoreApi)()
  return { es, board: (useBoardLayoutRef as () => BoardLayoutApi)() }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

describe('layoutSchema / parseBoardLayout 容错', () => {
  it('空输入 / 非法 JSON / 非对象 → 空布局且不抛错', () => {
    for (const bad of ['', '   ', '{oops', 'null', 'undefined', 42, [], true]) {
      const out = parseBoardLayout(bad)
      expect(out.version).toBe(BOARD_LAYOUT_VERSION)
      expect(out.containers).toEqual([])
      expect(out.sections).toEqual([])
    }
  })

  it('字段缺失与类型不符时补默认值', () => {
    const out = parseBoardLayout(JSON.stringify({
      containers: [
        { nodeId: 'n1', pos: { x: '10', y: null }, components: [{ form: 'title' }, { nope: 1 }] },
        { /* 缺 nodeId */ pos: { x: 1, y: 1 } },
        'not-an-object',
      ],
    }))
    expect(out.containers).toHaveLength(1)
    const c = out.containers[0]
    expect(c.nodeId).toBe('n1')
    expect(c.pos.x).toBe(10)
    expect(c.pos.y).toBe(0)
    // 无 form 的组件被丢弃，剩下的补默认 order
    expect(c.components).toHaveLength(1)
    expect(c.components[0].order).toBe(0)
  })

  it('组件按 order 升序归一，区按 order 排序', () => {
    const out = parseBoardLayout(JSON.stringify({
      containers: [{ nodeId: 'n1', pos: { x: 0, y: 0 }, components: [
        { id: 'c2', form: 'sentence', order: 2 }, { id: 'c1', form: 'title', order: 1 },
      ] }],
      sections: [
        { id: 's2', order: 2, rect: { x: 0, y: 0, w: 10, h: 10 } },
        { id: 's1', order: 1, rect: { x: 0, y: 0, w: 10, h: 10 } },
      ],
    }))
    expect(out.containers[0].components.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(out.sections.map(s => s.id)).toEqual(['s1', 's2'])
    expect(out.sections[0].arrange).toBe('free')
  })

  it('序列化后可无损往返', () => {
    const layout: OutlineBoardLayout = {
      version: BOARD_LAYOUT_VERSION,
      sections: [],
      containers: [{
        id: 'bct-1', nodeId: 'n1', pos: { x: 5, y: 6 },
        components: [{ id: 'bc-1', form: 'title', order: 1, config: { numbering: 'numeric' } }],
      }],
    }
    expect(parseBoardLayout(serializeBoardLayout(layout))).toEqual(layout)
  })
})

describe('useBoardLayout / 首次进入适配（viewport 从未保存）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('viewport 为空串（新建白板的形态）→ pendingFit 为真，视口回默认', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '首适白板 A')
    // 把 viewport 置空，模拟「从未设置」
    await es.update(id, { properties: { viewport: '' } })
    await board.load(id)
    expect(board.pendingFit.value).toBe(true)
    expect(board.viewport.value).toEqual({ zoom: 1, panX: 0, panY: 0 })
  })

  it('viewport 已保存 → pendingFit 为假，按保存值恢复', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '首适白板 B')
    await board.load(id)
    expect(board.pendingFit.value).toBe(false)
    expect(board.viewport.value).toEqual({ zoom: 1.5, panX: 12, panY: -8 })
  })

  it('viewport 是坏 JSON → 视为未设置；坏数据不炸视图', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '首适白板 C')
    await es.update(id, { properties: { viewport: '{坏' } })
    await board.load(id)
    expect(board.pendingFit.value).toBe(true)
    expect(board.viewport.value).toEqual({ zoom: 1, panX: 0, panY: 0 })
  })

  it('setViewport 后保存 → 再次 load 不再是首次（pendingFit 转假）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '首适白板 D')
    await es.update(id, { properties: { viewport: '' } })
    await board.load(id)
    expect(board.pendingFit.value).toBe(true)
    board.setViewport({ zoom: 1.2, panX: -30, panY: 40 })
    await board.saveNow()

    await board.load(id)
    expect(board.pendingFit.value).toBe(false)
    expect(board.viewport.value).toEqual({ zoom: 1.2, panX: -30, panY: 40 })
  })
})

describe('useBoardLayout / 缩略图', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('setThumbnail 后落盘，且不丢其他 properties 字段', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '缩略白板 A')
    await board.load(id)
    board.setThumbnail('data:image/jpeg;base64,AAAA')
    await board.saveNow()

    const saved = (es.entities ?? []).find(e => e.id === id)
    const props = saved?.properties as Record<string, unknown>
    expect(props.thumbnail).toBe('data:image/jpeg;base64,AAAA')
    // 同一处保存链：其它字段仍在
    expect(props.viewport).toBe('{"zoom":1.5,"panX":12,"panY":-8}')
    expect(props.snap).toBe('guides')
    expect(props.gridEnabled).toBe(true)
  })

  it('load 读回已存缩略图；空串不覆盖为 undefined', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '缩略白板 B')
    await board.load(id)
    expect(board.thumbnail.value).toBe('asset://thumb.png') // 帮助函数里预置的值
    board.setThumbnail('')
    await board.saveNow()
    await board.load(id)
    expect(board.thumbnail.value).toBe('')
  })

  it('空布局生成的空串缩略图不会污染已存图（视图层只在有值时 set）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '缩略白板 C')
    await board.load(id)
    const before = board.thumbnail.value
    // 模拟 renderBoardThumbnail 在无 canvas 环境返回 ''
    const dataUrl = ''
    if (dataUrl) board.setThumbnail(dataUrl)
    await board.saveNow()
    expect(board.thumbnail.value).toBe(before)
  })
})

describe('useBoardLayout / 读写与保存', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('load 读到空布局（新白板）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 A')
    expect(await board.load(id)).toBe(true)
    expect(board.layout.value).toEqual(createEmptyBoardLayout())
    expect(board.saveState.value).toBe('idle')
  })

  it('load 不存在的白板返回 false 且布局为空', async () => {
    const { board } = await setup()
    expect(await board.load('nope')).toBe(false)
    expect(board.layout.value.containers).toEqual([])
  })

  it('addContainer 后 saveNow 落盘，且**不丢其他 properties 字段**', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 B')
    await board.load(id)

    const cid = board.addContainer('node-1', { x: 120.4, y: 40.6 })
    expect(cid).toBeTruthy()
    await board.saveNow()

    const saved = (es.entities ?? []).find(e => e.id === id)
    const props = saved?.properties as Record<string, unknown>
    // 关键回归：properties 整体替换语义下，viewport/thumbnail/snap/gridEnabled 必须还在
    expect(props.viewport).toBe('{"zoom":1.5,"panX":12,"panY":-8}')
    expect(props.thumbnail).toBe('asset://thumb.png')
    expect(props.snap).toBe('guides')
    expect(props.gridEnabled).toBe(true)
    // 位置取整
    const layout = parseBoardLayout(props.layout)
    expect(layout.containers).toHaveLength(1)
    expect(layout.containers[0].pos).toEqual({ x: 120, y: 41 })
    expect(board.saveState.value).toBe('saved')
  })

  it('同一节点重复入板被拒（一板一节点一容器）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 C')
    await board.load(id)
    const first = board.addContainer('node-dup', { x: 0, y: 0 })
    const second = board.addContainer('node-dup', { x: 300, y: 300 })
    expect(first).toBeTruthy()
    expect(second).toBeNull()
    expect(board.layout.value.containers).toHaveLength(1)
    expect(findContainerByNode(board.layout.value, 'node-dup')?.id).toBe(first)
  })

  it('移动 / 缩放 / 折叠 / 归属区 都能改到布局', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 D')
    await board.load(id)
    const cid = board.addContainer('node-d', { x: 0, y: 0 }) as string

    board.moveContainer(cid, { x: 44.2, y: 90.8 })
    expect(board.layout.value.containers[0].pos).toEqual({ x: 44, y: 91 })

    board.resizeContainer(cid, { w: 200, h: 88 })
    expect(board.layout.value.containers[0].size).toEqual({ w: 200, h: 88 })

    board.toggleCollapsed(cid)
    expect(board.layout.value.containers[0].collapsed).toBe(true)

    board.setContainerSection(cid, 'sec-1')
    expect(board.layout.value.containers[0].sectionId).toBe('sec-1')
    board.setContainerSection(cid, null)
    expect(board.layout.value.containers[0].sectionId).toBeUndefined()

    // 尺寸下限保护
    board.resizeContainer(cid, { w: 10, h: 10 })
    expect(board.layout.value.containers[0].size).toEqual({ w: 120, h: 48 })
  })

  it('组件增删改与重排', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 E')
    await board.load(id)
    const cid = board.addContainer('node-e', { x: 0, y: 0 }) as string

    const t1 = board.addComponent(cid, 'title') as string
    const t2 = board.addComponent(cid, 'sentence') as string
    expect(t1 && t2).toBeTruthy()
    expect(board.layout.value.containers[0].components.map(c => c.order)).toEqual([1, 2])

    board.updateComponentConfig(cid, t1, { numbering: 'chinese' })
    expect(board.layout.value.containers[0].components[0].config).toEqual({ numbering: 'chinese' })

    board.reorderContainerComponents(cid, [t2, t1])
    expect(board.layout.value.containers[0].components.map(c => c.id)).toEqual([t2, t1])
    expect(board.layout.value.containers[0].components.map(c => c.order)).toEqual([1, 2])

    board.removeComponent(cid, t1)
    expect(board.layout.value.containers[0].components.map(c => c.id)).toEqual([t2])
  })

  it('删除容器不影响组件数据以外的任何东西（可重复调用不报错）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 F')
    await board.load(id)
    const cid = board.addContainer('node-f', { x: 0, y: 0 }) as string
    board.removeContainerById(cid)
    expect(board.layout.value.containers).toEqual([])
    board.removeContainerById(cid) // 再删一次是安全的空操作
    expect(board.layout.value.containers).toEqual([])
  })

  it('悬空容器可列出、可显式清理', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 G')
    await board.load(id)
    board.addContainer('alive', { x: 0, y: 0 })
    board.addContainer('dead', { x: 10, y: 10 })

    const existing = new Set(['alive'])
    expect(board.listDangling(existing)).toHaveLength(1)
    expect(board.cleanupDangling(existing)).toBe(1)
    expect(board.layout.value.containers.map(c => c.nodeId)).toEqual(['alive'])
    expect(board.cleanupDangling(existing)).toBe(0)
  })

  it('连续变更只触发一次落盘（防抖合并）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 H')
    await board.load(id)
    const cid = board.addContainer('node-h', { x: 0, y: 0 }) as string

    const spy = vi.spyOn(es, 'update')
    for (let i = 1; i <= 5; i++) board.moveContainer(cid, { x: i * 10, y: 0 })
    expect(board.saveState.value).toBe('saving')
    expect(spy).not.toHaveBeenCalled()

    await sleep(700) // 越过 500ms 防抖窗口
    expect(spy).toHaveBeenCalledTimes(1)

    const saved = (es.entities ?? []).find(e => e.id === id)
    const layout = parseBoardLayout((saved?.properties as Record<string, unknown>).layout)
    expect(layout.containers[0].pos.x).toBe(50) // 只落最后一次
  })

  it('dispose 后未到期的防抖不再落盘', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 I')
    await board.load(id)
    const cid = board.addContainer('node-i', { x: 0, y: 0 }) as string
    const spy = vi.spyOn(es, 'update')
    board.moveContainer(cid, { x: 77, y: 0 })
    board.dispose()
    await sleep(700)
    expect(spy).not.toHaveBeenCalled()
  })

  it('白板实体被删后保存进入 error 态（不静默丢数据）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '白板 J')
    await board.load(id)
    board.addContainer('node-j', { x: 0, y: 0 })
    await es.remove(id)
    await board.saveNow()
    expect(board.saveState.value).toBe('error')
  })
})

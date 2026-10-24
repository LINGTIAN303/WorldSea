/**
 * boardSections 单测 —— 区（Section）操作：画区 / 归属 / 平移带容器 / 调整尺寸重排 / 删区二选一（store 级）。
 *
 * 【为什么 store 级】区操作的落点仍是白板实体 `properties.layout`，且要验证「一次区变更 = 一次落盘」，
 * 必须接真实实体 store（properties 整体替换语义）。
 * 【断言纪律】共享 IndexedDB，每条断言用唯一 id/名字，不用「总数」这类会被前序用例污染的断言。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `http://asset.localhost/${p}`,
}))

import { parseBoardLayout } from '../board/layoutSchema'
import { SECTION_GAP, SECTION_HEADER, SECTION_PADDING } from '../board/sectionArrange'
import type { useEntityStore as UseEntityStore } from '@worldsea/entity-core'
import type { useBoardLayout as UseBoardLayout } from '../board/composables/useBoardLayout'

type EntityStoreApi = ReturnType<typeof UseEntityStore>
type BoardLayoutApi = ReturnType<typeof UseBoardLayout>

function uid(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

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

/** 动态 import 预热（entity-core 首编译冷启动较重，见 boardLayout.spec 的同款处理） */
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

/** 内容原点（区内容器排布的起点） */
const ORIGIN = { x: SECTION_PADDING, y: SECTION_HEADER + SECTION_PADDING }

describe('useBoardLayout / 区：画区与自动归属', () => {
  it('画区后，中心落在区内的既有容器自动归属，区外容器不受影响', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 A')
    await board.load(id)
    const inside = board.addContainer('sec-in', { x: 0, y: 0 }) as string // 中心 (100,40)
    const outside = board.addContainer('sec-out', { x: 2000, y: 2000 }) as string

    const secId = board.addSection({ x: -50, y: -50, w: 400, h: 300 }) as string
    expect(secId).toBeTruthy()

    const find = (cid: string) => board.layout.value.containers.find(c => c.id === cid)
    expect(find(inside)?.sectionId).toBe(secId)
    expect(find(outside)?.sectionId).toBeUndefined()
    expect(board.layout.value.sections).toHaveLength(1)
    expect(board.layout.value.sections[0].title).toBe('区 1')
    expect(board.layout.value.sections[0].arrange).toBe('free')
  })

  it('第二个区按 order 递增命名', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 A2')
    await board.load(id)
    board.addSection({ x: 0, y: 0, w: 300, h: 300 })
    board.addSection({ x: 800, y: 0, w: 300, h: 300 })
    expect(board.layout.value.sections.map(s => s.order)).toEqual([1, 2])
    expect(board.layout.value.sections.map(s => s.title)).toEqual(['区 1', '区 2'])
  })
})

describe('useBoardLayout / 区：平移带内容器', () => {
  it('区平移 = 区矩形与其内容器整体平移；区外容器不动', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 B')
    await board.load(id)
    const inside = board.addContainer('mv-in', { x: 0, y: 0 }) as string
    const outside = board.addContainer('mv-out', { x: 3000, y: 3000 }) as string
    const secId = board.addSection({ x: -50, y: -50, w: 400, h: 300 }) as string

    const before = board.layout.value.containers.find(c => c.id === inside)!.pos
    board.moveSectionTo(secId, { x: 70, y: 110, w: 400, h: 300 })

    const sec = board.layout.value.sections[0]
    expect({ x: sec.rect.x, y: sec.rect.y }).toEqual({ x: 70, y: 110 })
    expect(board.layout.value.containers.find(c => c.id === inside)!.pos)
      .toEqual({ x: before.x + 120, y: before.y + 160 })
    expect(board.layout.value.containers.find(c => c.id === outside)!.pos)
      .toEqual({ x: 3000, y: 3000 })
  })

  it('位置未变化时不产生新的布局对象（避免无意义保存）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 B2')
    await board.load(id)
    const secId = board.addSection({ x: 0, y: 0, w: 400, h: 300 }) as string
    const snapshot = board.layout.value
    board.moveSectionTo(secId, { x: 0, y: 0, w: 400, h: 300 })
    expect(board.layout.value).toBe(snapshot)
  })

  it('对不存在的区是安全的空操作', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 B3')
    await board.load(id)
    const snapshot = board.layout.value
    board.moveSectionTo('sec-nope', { x: 10, y: 10, w: 100, h: 100 })
    board.removeSectionById('sec-nope')
    board.renameSection('sec-nope', 'x')
    expect(board.layout.value).toBe(snapshot)
  })
})

describe('useBoardLayout / 区：调整尺寸与排布', () => {
  it('free：调整区尺寸后容器保持相对位置', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 C')
    await board.load(id)
    const ca = board.addContainer('rs-a', { x: 0, y: 100 }) as string
    const secId = board.addSection({ x: 0, y: 0, w: 600, h: 400 }) as string
    const before = board.layout.value.containers.find(c => c.id === ca)!.pos

    board.resizeSection(secId, { x: 0, y: 0, w: 900, h: 700 })
    expect(board.layout.value.sections[0].rect.w).toBe(900)
    expect(board.layout.value.containers.find(c => c.id === ca)!.pos).toEqual(before)
  })

  it('vertical：切换排布后按 y 顺序堆叠，间距为 gap，且只影响区内容器', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 C2')
    await board.load(id)
    const lower = board.addContainer('v-low', { x: 0, y: 300 }) as string // 中心 y=340
    const upper = board.addContainer('v-up', { x: 0, y: 60 }) as string   // 中心 y=100
    const outsider = board.addContainer('v-out', { x: 4000, y: 4000 }) as string
    const secId = board.addSection({ x: 0, y: 0, w: 800, h: 800 }) as string

    board.setSectionArrange(secId, 'vertical')
    const posOf = (cid: string) => board.layout.value.containers.find(c => c.id === cid)!.pos
    expect(posOf(upper)).toEqual({ x: ORIGIN.x, y: ORIGIN.y })
    expect(posOf(lower)).toEqual({ x: ORIGIN.x, y: ORIGIN.y + 80 + SECTION_GAP })
    expect(posOf(outsider)).toEqual({ x: 4000, y: 4000 })
  })

  it('vertical 状态下调整尺寸会自动重排（同一次变更）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 C3')
    await board.load(id)
    const ca = board.addContainer('rz-a', { x: 500, y: 500 }) as string // 中心 (600,540)
    const secId = board.addSection({ x: 0, y: 0, w: 900, h: 900 }) as string
    board.setSectionArrange(secId, 'vertical')
    board.moveContainer(ca, { x: 20, y: 20 })

    // vertical 下扩大区 → 容器被拉回内容原点
    board.resizeSection(secId, { x: 0, y: 0, w: 1200, h: 1000 })
    expect(board.layout.value.containers.find(c => c.id === ca)!.pos).toEqual(ORIGIN)
  })

  it('free 区的手动重排为原样（不改变容器位置）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 C4')
    await board.load(id)
    const ca = board.addContainer('mr-a', { x: 33, y: 44 }) as string
    const secId = board.addSection({ x: 0, y: 0, w: 600, h: 600 }) as string
    board.rearrangeSection(secId)
    expect(board.layout.value.containers.find(c => c.id === ca)!.pos).toEqual({ x: 33, y: 44 })
  })

  it('区尺寸有下限钳制（不会出现 0 宽高的区）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 C5')
    await board.load(id)
    const secId = board.addSection({ x: 0, y: 0, w: 400, h: 300 }) as string
    board.resizeSection(secId, { x: 0, y: 0, w: 1, h: 1 })
    expect(board.layout.value.sections[0].rect.w).toBe(80)
    expect(board.layout.value.sections[0].rect.h).toBe(60)
  })
})

describe('useBoardLayout / 区：删区二选一', () => {
  it('detach：仅删区，容器落回画布且位置不变', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 D')
    await board.load(id)
    const ca = board.addContainer('dt-a', { x: 0, y: 0 }) as string
    const secId = board.addSection({ x: -50, y: -50, w: 400, h: 300 }) as string
    expect(board.layout.value.containers.find(c => c.id === ca)?.sectionId).toBe(secId)

    board.removeSectionById(secId, 'detach')
    expect(board.layout.value.sections).toHaveLength(0)
    const kept = board.layout.value.containers.find(c => c.id === ca)
    expect(kept).toBeTruthy()
    expect(kept?.sectionId).toBeUndefined()
    expect(kept?.pos).toEqual({ x: 0, y: 0 })
  })

  it('cascade：区与区内容器一起删（不涉及节点实体）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 D2')
    await board.load(id)
    board.addContainer('cs-a', { x: 0, y: 0 })
    board.addContainer('cs-b', { x: 5000, y: 5000 })
    const secId = board.addSection({ x: -50, y: -50, w: 400, h: 300 }) as string

    board.removeSectionById(secId, 'cascade')
    expect(board.layout.value.sections).toHaveLength(0)
    expect(board.layout.value.containers.map(c => c.nodeId)).toEqual(['cs-b'])
  })
})

describe('useBoardLayout / 区：命名与归属重算', () => {
  it('区可重命名；空标题回退为无标题', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 E')
    await board.load(id)
    const secId = board.addSection({ x: 0, y: 0, w: 400, h: 300 }) as string
    board.renameSection(secId, '  第三幕  ')
    expect(board.layout.value.sections[0].title).toBe('第三幕')
    board.renameSection(secId, '   ')
    expect(board.layout.value.sections[0].title).toBeUndefined()
  })

  it('容器拖动结束重算归属：进区则归属，出区则脱离', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 F')
    await board.load(id)
    const ca = board.addContainer('st-a', { x: 3000, y: 3000 }) as string
    const secId = board.addSection({ x: 0, y: 0, w: 400, h: 300 }) as string
    expect(board.layout.value.containers.find(c => c.id === ca)?.sectionId).toBeUndefined()

    board.moveContainer(ca, { x: 100, y: 100 }) // 中心 (200,140) 落在区内
    board.settleContainerSection(ca)
    expect(board.layout.value.containers.find(c => c.id === ca)?.sectionId).toBe(secId)

    board.moveContainer(ca, { x: 3000, y: 3000 })
    board.settleContainerSection(ca)
    expect(board.layout.value.containers.find(c => c.id === ca)?.sectionId).toBeUndefined()
  })

  it('拖动结束：非 free 区按落点重排（同一次变更）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 F3')
    await board.load(id)
    const secId = board.addSection({ x: 0, y: 0, w: 400, h: 600 }) as string
    board.setSectionArrange(secId, 'vertical')
    const a = board.addContainer('st-c', { x: 20, y: 300 }, secId) as string
    const b = board.addContainer('st-d', { x: 20, y: 42 }, secId) as string

    board.moveContainer(a, { x: 20, y: 0 }) // 拖到 b 上方
    board.settleContainerSection(a)

    const ca = board.layout.value.containers.find(c => c.id === a)!
    const cb = board.layout.value.containers.find(c => c.id === b)!
    expect(ca.pos.y).toBeLessThan(cb.pos.y)
  })

  it('归属未变时不产生新的布局对象', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 F2')
    await board.load(id)
    const ca = board.addContainer('st-b', { x: 0, y: 0 }) as string
    board.addSection({ x: -50, y: -50, w: 400, h: 300 })
    const snapshot = board.layout.value
    board.settleContainerSection(ca) // 仍在原区，归属没变
    expect(board.layout.value).toBe(snapshot)
  })
})

describe('useBoardLayout / 区：保存链', () => {
  it('区操作落盘后不丢其他 properties 字段，且能无损读回', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 G')
    await board.load(id)
    board.addContainer('pv-a', { x: 0, y: 0 })
    const secId = board.addSection({ x: -50, y: -50, w: 400, h: 300 }) as string
    board.renameSection(secId, '第一幕')
    await board.saveNow()

    const saved = (es.entities ?? []).find(e => e.id === id)
    const props = saved?.properties as Record<string, unknown>
    // 关键回归：properties 整体替换语义下，其他字段必须还在
    expect(props.viewport).toBe('{"zoom":1.5,"panX":12,"panY":-8}')
    expect(props.thumbnail).toBe('asset://thumb.png')
    expect(props.snap).toBe('guides')
    expect(props.gridEnabled).toBe(true)

    const layout = parseBoardLayout(props.layout)
    expect(layout.sections).toHaveLength(1)
    expect(layout.sections[0].title).toBe('第一幕')
    expect(layout.containers[0].sectionId).toBe(secId)
  })

  it('区连续变更只触发一次落盘（防抖合并）', async () => {
    const { es, board } = await setup()
    const id = await createBoard(es, '区白板 H')
    await board.load(id)
    const secId = board.addSection({ x: 0, y: 0, w: 400, h: 300 }) as string
    const spy = vi.spyOn(es, 'update')
    for (let i = 1; i <= 5; i++) board.moveSectionTo(secId, { x: i * 10, y: 0, w: 400, h: 300 })
    expect(spy).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r, 700))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

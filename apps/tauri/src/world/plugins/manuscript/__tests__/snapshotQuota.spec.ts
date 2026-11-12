/**
 * 章节快照双配额测试（批1）：手动 ≤20 / 自动 ≤10 / 总池 ≤30，互不挤占；
 * 自动快照内容与最近一次相同则短路。锁定 properties.snapshots 体积不失控。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { useChapterSnapshots, MAX_MANUAL_SNAPSHOTS, MAX_AUTO_SNAPSHOTS, MAX_TOTAL_SNAPSHOTS } from '../composables/useChapterSnapshots'
import { installStoreServices } from './storeServices'
import { clearWorldServiceTable } from '../../../service-registry'

function makeChapter(): Entity {
  const now = new Date().toISOString()
  return {
    id: 'ms-snap-test',
    type: 'manuscript',
    name: '快照测试章节',
    description: '',
    properties: { snapshots: '[]' },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

describe('章节快照双配额', () => {
  let pinia: Pinia
  let es: ReturnType<typeof useEntityStore>

  beforeEach(() => {
    pinia = createPinia()
    es = useEntityStore(pinia)
    vi.spyOn(es, 'update').mockResolvedValue(undefined)
    // useChapterSnapshots 已改经树服务取数（批次 H），不起树时必须登记转发服务表
    installStoreServices()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearWorldServiceTable()
  })

  function setup() {
    const current: Ref<Entity | null> = ref(makeChapter())
    const api = useChapterSnapshots(current)
    api.loadSnapshots(current.value)
    return api
  }

  it('手动快照超过 20 条挤出最旧手动', async () => {
    const api = setup()
    for (let i = 0; i < MAX_MANUAL_SNAPSHOTS + 3; i++) {
      await api.createSnapshot(`<p>v${i}</p>`, i)
    }
    expect(api.snapshots.value.length).toBe(MAX_MANUAL_SNAPSHOTS)
    expect(api.snapshots.value.at(-1)?.content).toBe(`<p>v3</p>`) // v0~v2 被挤
    expect(api.snapshots.value[0]?.content).toBe(`<p>v22</p>`)
  })

  it('自动快照超过 10 条挤出最旧自动，不占手动位', async () => {
    const api = setup()
    for (let i = 0; i < MAX_AUTO_SNAPSHOTS + 4; i++) {
      await api.createSnapshot(`<p>auto-${i}</p>`, i, undefined, 'auto')
    }
    const autos = api.snapshots.value.filter(s => s.kind === 'auto')
    expect(autos.length).toBe(MAX_AUTO_SNAPSHOTS)
    expect(api.snapshots.value.at(-1)?.content).toBe(`<p>auto-4</p>`) // 最旧 4 条自动被挤
  })

  it('手动与自动互不挤占（各满额时总池 30）', async () => {
    const api = setup()
    for (let i = 0; i < MAX_MANUAL_SNAPSHOTS; i++) {
      await api.createSnapshot(`<p>m${i}</p>`, i)
    }
    for (let i = 0; i < MAX_AUTO_SNAPSHOTS; i++) {
      await api.createSnapshot(`<p>a${i}</p>`, i, undefined, 'auto')
    }
    expect(api.snapshots.value.length).toBe(MAX_TOTAL_SNAPSHOTS)
    // 再来一张自动：挤掉最旧自动，手动 20 张原封不动
    await api.createSnapshot('<p>a-new</p>', 0, undefined, 'auto')
    const manuals = api.snapshots.value.filter(s => s.kind !== 'auto')
    const autos = api.snapshots.value.filter(s => s.kind === 'auto')
    expect(manuals.length).toBe(MAX_MANUAL_SNAPSHOTS)
    expect(autos.length).toBe(MAX_AUTO_SNAPSHOTS)
    expect(autos[0]?.content).toBe('<p>a-new</p>') // 新自动在最前（新→旧数组）
    expect(autos.at(-1)?.content).toBe('<p>a1</p>') // 最旧自动 a0 被挤
  })

  it('自动快照内容与最近一次相同则短路', async () => {
    const api = setup()
    await api.createSnapshot('<p>same</p>', 5)
    await api.createSnapshot('<p>same</p>', 5, undefined, 'auto')
    await api.createSnapshot('<p>same</p>', 5, undefined, 'auto')
    expect(api.snapshots.value.length).toBe(1)
  })

  it('自动快照带「自动」标签与 kind 标记', async () => {
    const api = setup()
    await api.createSnapshot('<p>x</p>', 1, undefined, 'auto')
    expect(api.snapshots.value[0]?.label).toBe('自动')
    expect(api.snapshots.value[0]?.kind).toBe('auto')
  })
})

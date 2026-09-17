/**
 * agentDataBridges 单测（2026-09-14 全局桥架构）——首个 bridge 级测试。
 *
 * 核心验证：①数据动作与视图挂载解耦（不挂任何组件直接 dispatch 事件，
 * store 状态真实变化——假成功的反义）；②query requestId 回传协议；
 * ③install 幂等不双消费。
 *
 * 【结构约束】install 的 installed 标志是模块级、window listener 常驻（生产=
 * app 生命周期），因此本文件 **beforeAll 单次 install + 共享同一 pinia/store**，
 * 各用例用唯一标题断言自己的产物（贴近生产：install 一次全程共享）。
 * store 持久化走 tauri invoke → mock 为 resolve（内存态即断言对象）。
 * useOutlineTree 顶层 import 的 @worldsea/plugin-sdk 在 node 测试环境求值炸
 * （ui-kit barrel 的 useDialog 链）→ mock 之（桥只用 useDuplicateNameCheck，
 * 且 Agent 路径根本不调它）。
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
// entity store 持久化走 Dexie/IndexedDB；jsdom 无 IndexedDB → fake polyfill（根 devDeps 已有）
import 'fake-indexeddb/auto'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `http://asset.localhost/${p}`,
}))

vi.mock('@worldsea/plugin-sdk', () => ({
  useDuplicateNameCheck: () => ({
    checkAndConfirmName: async (n: string) => n,
  }),
}))

function fireAction(pluginId: string, action: string, payload: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('worldsea:agent:plugin-action', {
    detail: { pluginId, action, payload, timestamp: Date.now() },
  }))
}

function fireQuery(pluginId: string, query: string, params: Record<string, unknown> = {}, requestId = 'q-test'): void {
  window.dispatchEvent(new CustomEvent('worldsea:agent:plugin-query', {
    detail: { pluginId, query, params, requestId, timestamp: Date.now() },
  }))
}

/** 轮询等待条件成立（写动作 fire-and-forget：持久化链路是异步的，只关心「最终必达」；
 *  串行队列会累积前序用例的存储耗时，预算放宽到 8s） */
async function waitFor(cond: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now()
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 10))
  }
  return cond()
}

beforeAll(async () => {
  setActivePinia(createPinia())
  const mod = await import('@/agent/agentDataBridges')
  mod.installAgentDataBridges()
}, 30000) // 首次编译 entity-core/plugin 链较重（冷启动），放宽 hook 预算

describe('agentDataBridges 数据动作（与视图挂载解耦）', () => {
  it('manuscript:create_chapter 无视图挂载也必达（bookId 缺省=未归书）', async () => {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    fireAction('manuscript', 'create_chapter', { title: '第一章 试炼', content: '<p>正文</p>' })
    const arrived = await waitFor(() => es.entities.some(e => e.type === 'manuscript' && e.name === '第一章 试炼'))
    expect(arrived).toBe(true)

    const ch = es.entities.find(e => e.type === 'manuscript' && e.name === '第一章 试炼')
    expect(ch!.properties.bookId).toBe('')
    expect(ch!.properties.status).toBe('草稿')
    expect(ch!.properties.wordCount).toBe(2) // stripTags('正文').length
  })

  it('create_chapter 的 bookId 显式指定进 properties，sortOrder 按书内计数', async () => {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    fireAction('manuscript', 'create_chapter', { title: '书一甲', bookId: 'book-1' })
    fireAction('manuscript', 'create_chapter', { title: '书一乙', bookId: 'book-1' })
    fireAction('manuscript', 'create_chapter', { title: '书二甲', bookId: 'book-2' })
    // 精确名单等待（总数条件会在中间态提前放行）
    await waitFor(() => ['书一甲', '书一乙', '书二甲'].every(n => es.entities.some(e => e.name === n)))

    const inBook1 = es.entities.filter(e => e.type === 'manuscript' && e.properties.bookId === 'book-1')
    expect(inBook1.map(c => c.properties.sortOrder).sort()).toEqual([0, 1])
    const inBook2 = es.entities.filter(e => e.type === 'manuscript' && e.properties.bookId === 'book-2')
    expect(inBook2.map(c => c.properties.sortOrder)).toEqual([0])
  })

  it('notebook:create_note 落实体（folderId 不传=未分类）', async () => {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    fireAction('notebook', 'create_note', { name: 'AI 笔记', content: '内容' })
    await waitFor(() => es.entities.some(e => e.type === 'notebook' && e.name === 'AI 笔记'))

    const note = es.entities.find(e => e.type === 'notebook' && e.name === 'AI 笔记')
    expect(note!.properties.folderId).toBe('')
    expect(note!.properties.content).toBe('内容')
  })

  it('outline:create_node 落实体并同步 parent_child 关系', async () => {
    const { useEntityStore, useRelationStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()
    const rs = useRelationStore()

    fireAction('outline', 'create_node', { title: '桥测第一幕' })
    await waitFor(() => es.entities.some(e => e.type === 'outline_node' && e.name === '桥测第一幕'))
    const root = es.entities.find(e => e.type === 'outline_node' && e.name === '桥测第一幕')
    expect(root!.properties.parentId).toBe('')

    fireAction('outline', 'create_node', { title: '桥测第一场', parentId: root!.id, type: 'scene' })
    await waitFor(() => es.entities.some(e => e.type === 'outline_node' && e.name === '桥测第一场'))
    const child = es.entities.find(e => e.type === 'outline_node' && e.name === '桥测第一场')
    expect(child!.properties.parentId).toBe(root!.id)
    expect(child!.properties.nodeType).toBe('scene')
    // 关系一致性：parent_child 关系已建
    expect(rs.relations.some(r => r.type === 'parent_child' && r.sourceId === root!.id && r.targetId === child!.id)).toBe(true)
  })

  it('outline:batch_create 树递归建 + delete_node 递归删除子树', async () => {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    // 精确名单断言（「桥测」前缀会与上一用例的「桥测第一幕/第一场」计数冲突）
    const names = ['桥测卷一', '桥测章一', '桥测章二']
    const allThere = () => names.every(n => es.entities.some(e => e.type === 'outline_node' && e.name === n))
    const allGone = () => names.every(n => !es.entities.some(e => e.type === 'outline_node' && e.name === n))

    fireAction('outline', 'batch_create', {
      structure: { title: '桥测卷一', children: [{ title: '桥测章一' }, { title: '桥测章二' }] },
    })
    const got3 = await waitFor(allThere, 15000)
    expect(got3).toBe(true)

    const root = es.entities.find(e => e.type === 'outline_node' && e.name === '桥测卷一')!
    fireAction('outline', 'delete_node', { nodeId: root.id })
    const deleted = await waitFor(allGone, 15000)
    expect(deleted).toBe(true)
  }, 45000)
})

describe('大纲写动作的属性保全（2026-09-17 质量体检回归）', () => {
  /**
   * 三条真实缺陷的护栏（详见 docs/plans/2026-09-16-大纲白板-施工分解.md §十四）：
   * ① `update_node` 原写 `properties: rest` → 整个 properties 被替换，节点脱树
   * ② `useOutlineTree.moveNode` 原写 `properties: { parentId, order }` → 状态/摘要被抹
   * ③ `useOutlineTree` 原调 `es.loadByType` → 把 store 的 entities 整体收窄为 outline_node
   */
  it('update_node 只提交增量时，未提及的字段仍在（parentId/order/content 不被抹）', async () => {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    fireAction('outline', 'batch_create', {
      structure: { title: '护栏卷', children: [{ title: '护栏章', summary: '初始摘要' }] },
    })
    const created = await waitFor(
      () => ['护栏卷', '护栏章'].every(n => es.entities.some(e => e.type === 'outline_node' && e.name === n)),
      15000,
    )
    expect(created).toBe(true)

    const parent = es.entities.find(e => e.type === 'outline_node' && e.name === '护栏卷')!
    const child = es.entities.find(e => e.type === 'outline_node' && e.name === '护栏章')!
    // 建树时 batch_create 已把 summary 落到 description（摘要口径统一）
    expect(child.description).toBe('初始摘要')

    fireAction('outline', 'update_node', {
      nodeId: child.id,
      changes: { status: '完成', summary: '改后的摘要' },
    })
    const done = await waitFor(() => es.entities.find(e => e.id === child.id)?.properties.status === '完成')
    expect(done).toBe(true)

    const after = es.entities.find(e => e.id === child.id)!
    expect(after.properties.parentId).toBe(parent.id) // 未脱树
    expect(after.properties.order).toBe(1) // 序号仍在
    expect(after.properties.content).toBe('') // 未变成 undefined
    expect(after.properties.storylines).toBe('')
    expect(after.description).toBe('改后的摘要') // summary 归一写入 description
  }, 45000)

  it('move_node 换父后，状态与摘要仍在（useOutlineTree.moveNode 的护栏）', async () => {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    fireAction('outline', 'batch_create', {
      structure: { title: '护栏甲', children: [{ title: '护栏乙' }, { title: '护栏丙' }] },
    })
    const created = await waitFor(
      () => ['护栏甲', '护栏乙', '护栏丙'].every(n => es.entities.some(e => e.type === 'outline_node' && e.name === n)),
      15000,
    )
    expect(created).toBe(true)

    const a = es.entities.find(e => e.name === '护栏甲')!
    const b = es.entities.find(e => e.name === '护栏乙')!
    const c = es.entities.find(e => e.name === '护栏丙')!

    fireAction('outline', 'update_node', { nodeId: b.id, changes: { status: '草稿', summary: '乙的摘要' } })
    const updated = await waitFor(() => es.entities.find(e => e.id === b.id)?.properties.status === '草稿')
    expect(updated).toBe(true)

    // 把丙移到甲下第 0 位（仍是甲的子节点，只是序号变化）
    fireAction('outline', 'move_node', { nodeId: c.id, newParentId: a.id, position: 0 })
    const moved = await waitFor(() => es.entities.find(e => e.id === c.id)?.properties.order === 1)
    expect(moved).toBe(true)

    const cAfter = es.entities.find(e => e.id === c.id)!
    expect(cAfter.properties.parentId).toBe(a.id)
    expect(cAfter.properties.status).toBe('未写') // 未被抹成 undefined
    expect(cAfter.properties.content).toBe('')

    // 重排不得波及同胞的属性
    const bAfter = es.entities.find(e => e.id === b.id)!
    expect(bAfter.description).toBe('乙的摘要')
    expect(bAfter.properties.status).toBe('草稿')
  }, 45000)

  it('大纲写动作不挤掉其它类型的实体（loadByType 收窄护栏）', async () => {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    // 自成一体：本用例自己造一个「别的芽」的实体作为探针
    fireAction('notebook', 'create_note', { name: '护栏笔记', content: '探针' })
    const probe = await waitFor(() => es.entities.some(e => e.type === 'notebook' && e.name === '护栏笔记'))
    expect(probe).toBe(true)

    fireAction('outline', 'batch_create', { structure: { title: '护栏丁' } })
    await waitFor(() => es.entities.some(e => e.type === 'outline_node' && e.name === '护栏丁'))
    const d = es.entities.find(e => e.type === 'outline_node' && e.name === '护栏丁')!

    // 这两条路径历史上都会调 es.loadByType('outline_node')（= setAll 收窄）
    fireAction('outline', 'move_node', { nodeId: d.id, newParentId: '', position: 0 })
    fireAction('outline', 'delete_node', { nodeId: d.id })
    const deleted = await waitFor(() => !es.entities.some(e => e.name === '护栏丁'))
    expect(deleted).toBe(true)

    // 关键断言：store 里仍有其它类型的实体（收窄会把它们全部挤掉，直到下次 loadAll）
    expect(es.entities.some(e => e.type === 'notebook' && e.name === '护栏笔记')).toBe(true)
    expect(es.entities.some(e => e.type === 'manuscript')).toBe(true)
  }, 45000)
})

describe('agentDataBridges 查询回传协议', () => {
  it('query 带 requestId 派发 → 结果事件回传（requestId 配对 + 数据正确）', async () => {
    fireAction('manuscript', 'create_chapter', { title: '回传测试章' })
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()
    await waitFor(() => es.entities.some(e => e.name === '回传测试章'))

    const results: Array<{ requestId?: string; result?: { ok: boolean; data?: Array<{ name: string }> } }> = []
    const onResult = (e: Event) => results.push((e as CustomEvent).detail as typeof results[number])
    window.addEventListener('worldsea:agent:plugin-query-result', onResult)

    fireQuery('manuscript', 'list_chapters', {}, 'q-list-unique')
    const answered = await waitFor(() => results.some(r => r.requestId === 'q-list-unique'))

    window.removeEventListener('worldsea:agent:plugin-query-result', onResult)
    expect(answered).toBe(true) // 单次 install → 恰一次回传（幂等防双消费的侧面验证）
    expect(results.filter(r => r.requestId === 'q-list-unique')).toHaveLength(1)
    // 事件 detail.result = 查询原始数据（{ ok, data } 包裹发生在 agent-runtime 侧）
    const data = results.find(r => r.requestId === 'q-list-unique')!.result as unknown as Array<{ name: string }>
    expect(Array.isArray(data)).toBe(true)
    expect(data.some(c => c.name === '回传测试章')).toBe(true)
  })

  it('get_chapter_content 未命中返回 found:false', async () => {
    const results: Array<{ requestId?: string; result?: { ok: boolean; data?: { found: boolean } } }> = []
    const onResult = (e: Event) => results.push((e as CustomEvent).detail as typeof results[number])
    window.addEventListener('worldsea:agent:plugin-query-result', onResult)

    fireQuery('manuscript', 'get_chapter_content', { chapterId: 'no-such-xyz' }, 'q-miss-unique')
    const answered = await waitFor(() => results.some(r => r.requestId === 'q-miss-unique'))

    window.removeEventListener('worldsea:agent:plugin-query-result', onResult)
    expect(answered).toBe(true)
    // detail.result = 查询原始数据（get_chapter_content 的原始形态带 found 标志）
    const data = results.find(r => r.requestId === 'q-miss-unique')!.result as unknown as { found: boolean }
    expect(data.found).toBe(false)
  })

  it('未注册查询不回传（发送侧超时报错的前提）', async () => {
    const results: Array<{ requestId?: string }> = []
    const onResult = (e: Event) => results.push((e as CustomEvent).detail as typeof results[number])
    window.addEventListener('worldsea:agent:plugin-query-result', onResult)

    fireQuery('timeline', 'get_events', {}, 'q-unreg-unique')
    await new Promise(r => setTimeout(r, 30))

    window.removeEventListener('worldsea:agent:plugin-query-result', onResult)
    expect(results.filter(r => r.requestId === 'q-unreg-unique')).toHaveLength(0)
  })
})

describe('install 幂等', () => {
  it('重复 install 不双消费（同一事件只落一条实体）', async () => {
    const mod = await import('@/agent/agentDataBridges')
    mod.installAgentDataBridges() // 第二次调用（beforeAll 已装过，installed=true 直接跳过）
    const { useEntityStore } = await import('@worldsea/entity-core')
    const es = useEntityStore()

    fireAction('manuscript', 'create_chapter', { title: '幂等测试章' })
    const arrived = await waitFor(() => es.entities.some(e => e.name === '幂等测试章'))
    expect(arrived).toBe(true)
    expect(es.entities.filter(e => e.name === '幂等测试章').length).toBe(1)
  })
})

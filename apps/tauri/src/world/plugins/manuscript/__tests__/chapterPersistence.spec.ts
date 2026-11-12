/**
 * 文稿芽 · 切章节窗口 · 脏内容归属（回归 · 2026-10-11）
 *
 * 缺陷史：useChapterEditor 「切走前落盘」以 currentChapter 为目标；而 ManuscriptView.select()
 * 的时序是 `current.value = m; ...; loadChapter(m)` —— 落盘执行时 current 已是**新章节**。
 * 在 2000ms 防抖窗口内切章节（saveStatus='unsaved'），旧章节的未落库正文会被写到新章节 id
 * （实测复现：update 记录 {id: ms-B, content: 含旧章节脏字}），旧章节丢最新输入。
 * 修复：落盘目标改 loadedChapterId（编辑器实际加载的章节）+ properties 取 store 实时值；
 * 同章节同内容的重复加载短路（不重载、不重置选区）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { EditorContent } from '@tiptap/vue-3'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { useChapterEditor } from '../composables/useChapterEditor'
import { installStoreServices } from './storeServices'
import { clearWorldServiceTable } from '../../../service-registry'

function makeEntity(id: string, content: string): Entity {
  const now = new Date().toISOString()
  return {
    id,
    type: 'manuscript',
    name: '测试章节',
    description: '',
    properties: { content, wordCount: 4 },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function drain(ms = 50): Promise<void> {
  await nextTick()
  await new Promise((r) => setTimeout(r, ms))
}

describe('文稿芽 · 切章节窗口 · 脏内容归属（回归）', () => {
  let pinia: Pinia

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    // useChapterEditor 已改经树服务取数（批次 H），不起树时必须登记转发服务表
    installStoreServices()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearWorldServiceTable()
  })

  it('2000ms 窗口内切章节：脏内容写入 A（旧）、不写入 B（新），编辑器正常加载 B', async () => {
    const es = useEntityStore(pinia)
    const updateSpy = vi.spyOn(es, 'update') // 保留真实实现，仅记录调用参数

    const A = makeEntity('ms-A', '<p>甲内容</p>')
    const B = makeEntity('ms-B', '<p>乙内容</p>')
    await es.add(A, 'user')
    await es.add(B, 'user')

    const current = ref<Entity | null>(null)
    let api: ReturnType<typeof useChapterEditor> | null = null
    const Host = defineComponent({
      setup() {
        api = useChapterEditor(current)
        return () => h('div', api!.editor.value ? [h(EditorContent, { editor: api!.editor.value })] : [])
      },
    })
    const wrapper = mount(Host, { global: { plugins: [pinia] } })

    // ① 选 A 并脏化（onUpdate → scheduleAutosave → saveStatus='unsaved'，2000ms 未到）
    current.value = A
    api!.loadChapter(A)
    api!.editor.value!.commands.insertContent('脏字')

    // ② 2000ms 窗口内切到 B：复刻 ManuscriptView.select() 的真实时序
    //    （current.value = m 先执行 → 再 loadChapter(m)）
    current.value = B
    api!.loadChapter(B)
    await drain()

    const calls = updateSpy.mock.calls.map((c: unknown[]) => ({
      id: c[0] as string,
      content: String((c[1] as { properties?: { content?: unknown } })?.properties?.content ?? ''),
    }))

    // 旧章节的未落库正文必须落到 A（修复前缺陷：落到 B）
    expect(
      calls.filter((c) => c.id === 'ms-A' && c.content.includes('脏字')).length,
      '脏内容应写入 A（旧章节）',
    ).toBeGreaterThan(0)
    expect(calls.filter((c) => c.id === 'ms-B').length, 'B 不应被写入').toBe(0)
    // A 的最新内容（含脏字）已入内存
    expect(String(es.entities.find((e) => e.id === 'ms-A')!.properties?.content ?? '')).toContain('脏字')
    // 编辑器正常加载出 B
    expect(api!.editor.value!.getHTML()).toContain('乙内容')

    wrapper.unmount()
  })
})

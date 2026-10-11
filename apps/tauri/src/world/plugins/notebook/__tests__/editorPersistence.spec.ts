/**
 * 笔记本编辑器 · 保存链路契约回归（2026-10-11）
 *
 * 锁定两条修复契约（缺陷史详见 useNoteEditor 内「切走前落盘」「同 id 回流不重载」注释）：
 * ① 切换窗口归属：300ms 未落库窗口内切笔记，脏内容必须写到**旧笔记**（loadedNoteId），
 *    不得写入新笔记（修复前实测：脏内容写到新笔记 id、旧笔记丢最新输入）；
 * ② 回流不重载：同一篇笔记因自动保存回流（store 按引用替换）触发 props/loadNote 时，
 *    编辑器不得 setContent 重载（修复前：选区塌缩 →「打字丢光标」）。
 *
 * 双轨覆盖：直驱 useNoteEditor 锁 composable 语义；组件级锁 NotebookTipTapEditor 的
 * watch「按 id 触发」契约（防回退为按引用——那会重新引入丢光标缺陷）。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { defineComponent, h, computed, ref, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { EditorContent } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { useNoteEditor } from '../composables/useNoteEditor'
import NotebookTipTapEditor from '../components/NotebookTipTapEditor.vue'

function makeNote(id: string, content: string): Entity {
  const now = new Date().toISOString()
  return {
    id,
    type: 'notebook',
    name: '测试笔记',
    description: '',
    properties: { content, noteType: 'markdown' },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function drain(ms = 50): Promise<void> {
  await nextTick()
  await new Promise((r) => setTimeout(r, ms))
}

/** 直驱宿主：复刻 NotebookTipTapEditor 的传参形态（computed 包裹 props） */
function mountHost(pinia: Pinia, currentRef: Ref<Entity | null>) {
  let api!: ReturnType<typeof useNoteEditor>
  const Host = defineComponent({
    setup() {
      api = useNoteEditor(computed(() => currentRef.value))
      return () => h('div', api.editor.value ? [h(EditorContent, { editor: api.editor.value })] : [])
    },
  })
  const wrapper = mount(Host, { global: { plugins: [pinia] } })
  return { get api() { return api }, wrapper }
}

describe('笔记本编辑器 · 切换窗口 · 脏内容归属（回归）', () => {
  let pinia: Pinia
  let updateSpy: MockInstance

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('300ms 窗口内切笔记：脏内容写入 A（旧）、不写入 B（新），编辑器正常加载 B', async () => {
    const es = useEntityStore(pinia)
    updateSpy = vi.spyOn(es, 'update') // 保留真实实现，仅记录调用参数

    const A = makeNote('nb-A', '<p>甲内容</p>')
    const B = makeNote('nb-B', '<p>乙内容</p>')
    await es.add(A, 'user')
    await es.add(B, 'user')

    const currentRef = ref<Entity | null>(null)
    const { api, wrapper } = mountHost(pinia, currentRef)

    // ① 载入 A 并脏化（onUpdate → scheduleAutosave → saveStatus='unsaved'，300ms 未到）
    currentRef.value = A
    api.loadNote(A)
    api.editor.value!.commands.insertContent('脏字')

    // ② 300ms 窗口内切到 B（复刻 NotebookView 时序：currentNote 重算 → props 更新 → watch → loadNote(B)）
    currentRef.value = B
    api.loadNote(B)
    await drain()

    const calls = updateSpy.mock.calls.map((c: unknown[]) => ({
      id: c[0] as string,
      content: String((c[1] as { properties?: { content?: unknown } })?.properties?.content ?? ''),
    }))

    // 旧笔记的未落库正文必须落到 A（修复前缺陷：落到 B）
    expect(
      calls.filter((c) => c.id === 'nb-A' && c.content.includes('脏字')).length,
      '脏内容应写入 A（旧笔记）',
    ).toBeGreaterThan(0)
    expect(calls.filter((c) => c.id === 'nb-B').length, 'B 不应收到任何写入').toBe(0)
    // A 的最新内容（含脏字）已入内存
    expect(String(es.entities.find((e) => e.id === 'nb-A')!.properties?.content ?? '')).toContain('脏字')
    // 编辑器正常加载出 B
    expect(api.editor.value!.getHTML()).toContain('乙内容')

    wrapper.unmount()
  })
})

describe('笔记本编辑器 · 同 id 回流短路（回归）', () => {
  let pinia: Pinia

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('同笔记同内容的 loadNote 短路：选区保持不塌缩（自动保存回流场景）', async () => {
    const es = useEntityStore(pinia)
    const A = makeNote('nb-A2', '<p>甲内容</p>')
    await es.add(A, 'user')

    const currentRef = ref<Entity | null>(A)
    const { api, wrapper } = mountHost(pinia, currentRef)
    api.loadNote(A)

    api.editor.value!.commands.setTextSelection(3)
    const before = api.editor.value!.state.selection.from
    expect(before).toBe(3)

    // 模拟回流：store 引用替换后的新对象再次 loadNote（同 id、内容一致）
    const live = es.entities.find((e) => e.id === 'nb-A2')!
    api.loadNote(live)

    expect(api.editor.value!.state.selection.from, '同内容回流不得重置选区').toBe(before)
    wrapper.unmount()
  })
})

describe('NotebookTipTapEditor · 保存回流不打断输入（组件级回归）', () => {
  let pinia: Pinia

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('props 换引用（同 id 保存回流）不重载、选区保持；切换笔记仍正常重载', async () => {
    const es = useEntityStore(pinia)
    const A = makeNote('nb-C1', '<p>甲一</p>')
    await es.add(A, 'user')

    const wrapper = mount(NotebookTipTapEditor, {
      props: { note: A },
      global: {
        plugins: [pinia],
        stubs: { WsIcon: true, MentionPopover: true, SlashCommandMenu: true },
      },
    })
    await nextTick()
    await drain()

    const ed = wrapper.findComponent(EditorContent).props('editor') as Editor
    expect(ed, '编辑器实例应已就绪').toBeTruthy()
    expect(ed.getHTML()).toContain('甲一')

    // 模拟回流：store 更新（按引用替换）→ 外部把新引用对象传入 props
    ed.commands.setTextSelection(2)
    const before = ed.state.selection.from
    const liveProps = es.entities.find((e) => e.id === 'nb-C1')!.properties ?? {}
    await es.update('nb-C1', { properties: { ...liveProps, content: ed.getHTML() } }, 'user', { skipUndo: true })
    const liveA = es.entities.find((e) => e.id === 'nb-C1')!
    await wrapper.setProps({ note: liveA })
    await drain()

    expect(ed.state.selection.from, '回流（props 换引用）不得重置选区').toBe(before)

    // 切换笔记 → 仍正常重载（防「改按 id 后切换失效」的回退）
    const B = makeNote('nb-C2', '<p>乙二</p>')
    await es.add(B, 'user')
    const liveB = es.entities.find((e) => e.id === 'nb-C2')!
    await wrapper.setProps({ note: liveB })
    await drain()
    expect(ed.getHTML()).toContain('乙二')

    wrapper.unmount()
  })
})

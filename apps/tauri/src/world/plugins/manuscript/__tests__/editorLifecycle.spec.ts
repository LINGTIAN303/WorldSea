/**
 * 编辑器生命周期回归测试（「正文写作芽编辑态后切换视图失败」修复）
 *
 * 历史缺陷：useEditor 内部 onBeforeUnmount 先 destroy，且注册早于组合函数自己的卸载钩子
 * → 卸载钩子里对已销毁编辑器调 getHTML() 抛
 * `TypeError: Cannot read properties of null (reading 'cached')`（dev 下 Vue 对生命周期
 * 错误 throw → 视图切换 patch 中断）；且「卸载落盘」每次都抛错、从未真正执行过。
 *
 * 修复（方案 A）：两处组合函数自管生命周期（onMounted 创建 + onBeforeUnmount 先落盘后销毁）。
 * 本测试锁定两条契约：
 * ① 卸载（含脏态）不抛错 —— 视图切换不再被中断；
 * ② 卸载落盘真的发生（es.update 被调用）—— 丢稿缺陷不得回退；非脏态不写。
 *
 * 直驱真实组合函数（useChapterEditor / useNoteEditor）：若有人改回 useEditor 或挪动
 * 落盘时机，这里会立刻红。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { defineComponent, h, ref, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { EditorContent } from '@tiptap/vue-3'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { useChapterEditor } from '../composables/useChapterEditor'
import { useNoteEditor } from '../../notebook/composables/useNoteEditor'
import { clearWorldServiceTable, registerWorldServiceTable } from '../../../service-registry'

function makeEntity(id: string, content: string): Entity {
  const now = new Date().toISOString()
  return {
    id,
    type: 'manuscript',
    name: '测试章节',
    description: '',
    properties: { content },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function drain(): Promise<void> {
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

describe('编辑器生命周期 · 卸载先落盘后销毁（方案 A 回归）', () => {
  let pinia: Pinia
  let es: ReturnType<typeof useEntityStore>
  type UpdateSpy = MockInstance<
    (id: string, changes: Partial<Entity>, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }) => Promise<void>
  >
  let updateSpy: UpdateSpy | undefined

  beforeEach(() => {
    pinia = createPinia()
    es = useEntityStore(pinia)
    updateSpy = vi.spyOn(es, 'update').mockResolvedValue(undefined)
    // 第二个用例复用 notebook 的 useNoteEditor，它现在经 world.entities 服务取数；
    // 本 spec 不起树，故登记转发到同一 store 的服务表（保持 spy 仍能捕获转发调用）。
    registerWorldServiceTable({
      'world.entities': {
        list: () => es.entities,
        get: (id: string) => es.entityMap.get(id),
        byType: (type: string) => es.entities.filter(e => e.type === type),
        add: (...args: Parameters<typeof es.add>) => es.add(...args),
        update: (...args: Parameters<typeof es.update>) => es.update(...args),
        remove: (...args: Parameters<typeof es.remove>) => es.remove(...args),
        reload: () => es.loadAll(),
        loadByType: (type: string) => es.loadByType(type),
      },
    })
  })

  afterEach(() => {
    clearWorldServiceTable()
    vi.restoreAllMocks()
  })

  it('useChapterEditor：脏态卸载不抛错且落盘发生（原缺陷即在此抛错）', async () => {
    const current: Ref<Entity | null> = ref(null)
    let api: ReturnType<typeof useChapterEditor> | null = null

    const Host = defineComponent({
      setup() {
        api = useChapterEditor(current)
        return () =>
          h('div', api!.editor.value ? [h(EditorContent, { editor: api!.editor.value })] : [])
      },
    })

    const wrapper = mount(Host, { global: { plugins: [pinia] } })
    expect(updateSpy, '未选章节：任何写入都不应发生').not.toHaveBeenCalled()

    // 进入编辑态：选中章节 → 编辑器载入内容 → 输入（脏态）
    // 实体须在 store：persistContent 以 entityMap 的实时值作为基线（2026-10-11 起），
    // 实体不在内存索引时跳过落盘（防「删后回写幽灵」）——故直驱前先 add。
    const chapter = makeEntity('ms-lifecycle-test', '<p>初稿内容</p>')
    await es.add(chapter, 'user')
    current.value = chapter
    api!.loadChapter(chapter)
    expect(api!.editor.value?.getHTML()).toContain('初稿内容')

    // 切换视图 = 卸载本组件（ViewContainer :is 语义）；卸载链中任何抛错都从这里冒出
    let unmountError: unknown = null
    try {
      api!.editor.value?.commands.insertContent('·追加')
      wrapper.unmount()
    } catch (e) {
      unmountError = e
    }
    expect(unmountError, `卸载抛错: ${String(unmountError)}`).toBeNull()

    // 卸载落盘真的发生（丢稿缺陷不回退）
    await drain()
    expect(updateSpy).toHaveBeenCalled()
    const call = updateSpy!.mock.calls.at(-1)
    expect(call, '卸载落盘应写入章节实体').toBeTruthy()
    const [id, patch] = call as [string, { properties: { content: string } }]
    expect(id).toBe('ms-lifecycle-test')
    expect(patch.properties.content).toContain('追加')
  })

  it('useNoteEditor：脏态卸载不抛错且落盘发生；非脏态卸载不写', async () => {
    const currentNote: Ref<Entity | null> = ref(null)
    let api: ReturnType<typeof useNoteEditor> | null = null

    const Host = defineComponent({
      setup() {
        api = useNoteEditor(currentNote)
        return () =>
          h('div', api!.editor.value ? [h(EditorContent, { editor: api!.editor.value })] : [])
      },
    })

    const wrapper = mount(Host, { global: { plugins: [pinia] } })
    // 实体须在 store：persistContent 以 entityMap 里的实时值作为 properties 基线（2026-10-11 起），
    // 实体不在内存索引时跳过落盘（防「删后回写幽灵」）——故直驱前先 add。
    const note = makeEntity('nb-lifecycle-test', '<p>笔记内容</p>')
    await es.add(note, 'user')
    currentNote.value = note
    api!.loadNote(note)

    // 脏态卸载 → 落盘
    let unmountError: unknown = null
    try {
      api!.editor.value?.commands.insertContent('·草稿')
      wrapper.unmount()
    } catch (e) {
      unmountError = e
    }
    expect(unmountError, `卸载抛错: ${String(unmountError)}`).toBeNull()
    await drain()
    expect(updateSpy).toHaveBeenCalled()

    // 非脏卸载 → 不写（loadNote 后未编辑即卸载）
    updateSpy!.mockClear()
    const wrapper2 = mount(Host, { global: { plugins: [pinia] } })
    const note2 = makeEntity('nb-lifecycle-test-2', '<p>干净笔记</p>')
    await es.add(note2, 'user')
    currentNote.value = note2
    api!.loadNote(note2)
    wrapper2.unmount()
    await drain()
    expect(updateSpy, '非脏卸载不应产生写入').not.toHaveBeenCalled()
  })
})

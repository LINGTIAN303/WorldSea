/**
 * backlinkWiring · 三时机接线集成（块 2 阶段 2，2026-10-15）
 *
 * 覆盖（批计划 §三阶段 2 验收）：
 * ① 保存后派生（persistContent 收口——flushSave 内含 await recomputeNoteLinks，
 *    resolve 即关系收敛）：「插入弹层产物（noteLink mark）→ 保存 → 关系出现」+
 *    「清除内容 → 保存 → 关系消失」（「删 mark 不清理关系」挂账消除回归）；
 * ② 装载时重算（loadNote fire-and-forget）——外部改动后打开笔记修正陈旧关系；
 * ③ 已知边界锁定：手敲纯文本 `[[B]]`（未经弹层）保存为转义形态 `\[\[B\]\]`——
 *    不建关系（「所见即所存」：编辑态非链接 → 落库非链接 → 重开非链接）。
 *
 * 基座同 editorPersistence.spec（真实 store + fake-indexeddb + mountHost 直驱 useNoteEditor）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, computed, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { EditorContent } from '@tiptap/vue-3'
import { useEntityStore, useRelationStore, type Entity } from '@worldsea/entity-core'
import { useNoteEditor } from '../composables/useNoteEditor'
import { clearWorldServiceTable } from '../../../service-registry'
import { installStoreServices } from './storeServices'

function makeNote(id: string, name: string, content = ''): Entity {
  const now = new Date().toISOString()
  return {
    id,
    type: 'notebook',
    name,
    description: '',
    properties: { content, noteType: 'markdown' },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** 直驱宿主：复刻 NotebookTipTapEditor 的传参形态（computed 包裹 props）——同 editorPersistence.spec */
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

/** 弹层产物形态：带 noteLink mark 的文本节点（insertNoteLink 的输出同构） */
function noteLinkMarkContent(noteId: string, noteName: string) {
  return [{ type: 'text', text: noteName, marks: [{ type: 'noteLink', attrs: { noteId, noteName } }] }]
}

describe('backlinkWiring · 保存后派生（persistContent 收口）', () => {
  let pinia: Pinia

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
    installStoreServices()
  })

  afterEach(() => {
    clearWorldServiceTable()
    vi.restoreAllMocks()
  })

  it('插入 noteLink（弹层产物）→ flushSave → 关系出现；多条引用一次收口', async () => {
    const es = useEntityStore(pinia)
    const rs = useRelationStore(pinia)
    await es.add(makeNote('nb-A', '笔记A', ''), 'user')
    await es.add(makeNote('nb-B', '笔记B', ''), 'user')
    await es.add(makeNote('nb-C', '笔记C', ''), 'user')

    const currentRef = ref<Entity | null>(null)
    const { api, wrapper } = mountHost(pinia, currentRef)
    currentRef.value = es.entityMap.get('nb-A')!
    api.loadNote(currentRef.value)

    api.editor.value!.commands.insertContent(noteLinkMarkContent('nb-B', '笔记B'))
    api.editor.value!.commands.insertContent(' 与 ')
    api.editor.value!.commands.insertContent(noteLinkMarkContent('nb-C', '笔记C'))
    await api.flushSave() // flushSave 内含 await 重算——resolve 即关系收敛（测试确定性锚点）

    expect(rs.relations.filter((r) => r.type === 'note_link' && r.sourceId === 'nb-A').map((r) => r.targetId).sort())
      .toEqual(['nb-B', 'nb-C'])
    const md = String(es.entityMap.get('nb-A')!.properties.content)
    expect(md).toContain('[[笔记B]]')
    expect(md).toContain('[[笔记C]]')
    wrapper.unmount()
  })

  it('清除内容 → flushSave → 关系消失（挂账「删 mark 不清理关系」消除回归）', async () => {
    const es = useEntityStore(pinia)
    const rs = useRelationStore(pinia)
    await es.add(makeNote('nb-A', '笔记A', ''), 'user')
    await es.add(makeNote('nb-B', '笔记B', ''), 'user')

    const currentRef = ref<Entity | null>(null)
    const { api, wrapper } = mountHost(pinia, currentRef)
    currentRef.value = es.entityMap.get('nb-A')!
    api.loadNote(currentRef.value)

    api.editor.value!.commands.insertContent(noteLinkMarkContent('nb-B', '笔记B'))
    await api.flushSave()
    expect(rs.relations.filter((r) => r.sourceId === 'nb-A')).toHaveLength(1)

    api.editor.value!.commands.clearContent()
    await api.flushSave()
    expect(rs.relations.filter((r) => r.sourceId === 'nb-A' || r.targetId === 'nb-A')).toHaveLength(0)
    wrapper.unmount()
  })

  it('已知边界：手敲纯文本 [[B]]（未经弹层）保存为转义形态——不建关系（所见即所存）', async () => {
    const es = useEntityStore(pinia)
    const rs = useRelationStore(pinia)
    await es.add(makeNote('nb-A', '笔记A', ''), 'user')
    await es.add(makeNote('nb-B', '笔记B', ''), 'user')

    const currentRef = ref<Entity | null>(null)
    const { api, wrapper } = mountHost(pinia, currentRef)
    currentRef.value = es.entityMap.get('nb-A')!
    api.loadNote(currentRef.value)

    api.editor.value!.commands.insertContent('前 [[笔记B]] 后')
    await api.flushSave()

    // 转义落库（引擎防 re-parse：编辑态非链接 → 落库非链接 → 重开仍字面；建链走弹层）
    const md = String(es.entityMap.get('nb-A')!.properties.content)
    expect(md).toContain('\\[\\[笔记B\\]\\]')
    expect(rs.relations.filter((r) => r.sourceId === 'nb-A')).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('backlinkWiring · 装载时重算（loadNote）', () => {
  let pinia: Pinia

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
    installStoreServices()
  })

  afterEach(() => {
    clearWorldServiceTable()
    vi.restoreAllMocks()
  })

  it('外部改动（存储态含引用但关系缺失）→ loadNote → 关系补齐', async () => {
    const es = useEntityStore(pinia)
    const rs = useRelationStore(pinia)
    // 模拟「装载前被外部改过」：content 直接含引用、关系表为空
    await es.add(makeNote('nb-A', '笔记A', '引用 [[笔记B]] 与 [[笔记C]]'), 'user')
    await es.add(makeNote('nb-B', '笔记B', ''), 'user')
    await es.add(makeNote('nb-C', '笔记C', ''), 'user')

    const currentRef = ref<Entity | null>(null)
    const { api, wrapper } = mountHost(pinia, currentRef)
    currentRef.value = es.entityMap.get('nb-A')!
    api.loadNote(currentRef.value) // 装载 → fire-and-forget 重算

    await vi.waitFor(() => {
      expect(rs.relations.filter((r) => r.type === 'note_link' && r.sourceId === 'nb-A').map((r) => r.targetId).sort())
        .toEqual(['nb-B', 'nb-C'])
    })
    wrapper.unmount()
  })
})

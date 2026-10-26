/**
 * 自动快照定时触发测试（批1）：fake timers 推进 10 分钟间隔，
 * 锁定触发门槛——有章节+编辑器+落盘完成(saved)+非空文档；卸载即停表。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, shallowRef, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { Editor } from '@tiptap/vue-3'
import type { Entity } from '@worldsea/entity-core'
import { useAutoSnapshot, AUTO_SNAPSHOT_INTERVAL_MS } from '../composables/useAutoSnapshot'
import type { SaveStatus } from '../composables/useChapterEditor'

type Deps = Parameters<typeof useAutoSnapshot>[0]

function makeFakeEditor(html: string, text: string): Editor {
  return { getHTML: () => html, getText: () => text } as unknown as Editor
}

function mountAutoSnapshot(deps: Deps) {
  const Host = defineComponent({
    setup() {
      useAutoSnapshot(deps)
      return () => h('div')
    },
  })
  return mount(Host)
}

describe('自动快照定时触发', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function makeDeps(overrides?: {
    currentChapter?: Ref<Entity | null>
    editor?: Ref<Editor | undefined>
    saveStatus?: Ref<SaveStatus>
  }) {
    const createAutoSnapshot = vi.fn().mockResolvedValue(undefined)
    // Editor 接口经 Vue ref 深解包会损形，用 shallowRef 保持引用语义
    const fakeEditor = shallowRef(makeFakeEditor('<p>内容</p>', '内容'))
    const deps: Deps = {
      currentChapter: overrides?.currentChapter ?? ref<Entity | null>({ id: 'c1' } as Entity),
      editor: overrides?.editor ?? fakeEditor,
      saveStatus: overrides?.saveStatus ?? ref<SaveStatus>('saved'),
      createAutoSnapshot,
    }
    return { deps, createAutoSnapshot }
  }

  it('满 10 分钟且条件满足时触发', async () => {
    const { deps, createAutoSnapshot } = makeDeps()
    mountAutoSnapshot(deps)
    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_INTERVAL_MS)
    expect(createAutoSnapshot).toHaveBeenCalledTimes(1)
    expect(createAutoSnapshot).toHaveBeenCalledWith('<p>内容</p>', 2)
  })

  it('落盘未完成（unsaved/saving）不拍，防落盘竞态', async () => {
    const { deps, createAutoSnapshot } = makeDeps({ saveStatus: ref<SaveStatus>('unsaved') })
    mountAutoSnapshot(deps)
    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_INTERVAL_MS * 2)
    expect(createAutoSnapshot).not.toHaveBeenCalled()
  })

  it('无当前章节/无编辑器/空文档不拍', async () => {
    const { deps, createAutoSnapshot } = makeDeps({
      currentChapter: ref<Entity | null>(null),
      editor: shallowRef<Editor | undefined>(undefined),
    })
    const { deps: deps2, createAutoSnapshot: snap2 } = makeDeps({
      editor: shallowRef(makeFakeEditor('<p></p>', '')),
    })
    mountAutoSnapshot(deps)
    mountAutoSnapshot(deps2)
    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_INTERVAL_MS * 2)
    expect(createAutoSnapshot).not.toHaveBeenCalled()
    expect(snap2).not.toHaveBeenCalled()
  })

  it('卸载后停表', async () => {
    const { deps, createAutoSnapshot } = makeDeps()
    const wrapper = mountAutoSnapshot(deps)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_INTERVAL_MS * 2)
    expect(createAutoSnapshot).not.toHaveBeenCalled()
  })
})

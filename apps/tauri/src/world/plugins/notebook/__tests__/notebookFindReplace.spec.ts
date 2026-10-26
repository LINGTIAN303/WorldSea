/**
 * 笔记本查找替换接线冒烟（批2 平移）：jsdom 真 Editor 直驱 useNoteEditor（同
 * backlinkWiring 基座），锁定「共享 FindReplaceExtension 在 notebook 扩展栈
 * （Markdown 真相源 + CodeBlockEnhanced）下命令可用、替换经既有 300ms 保存链落 md」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, computed, ref, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { EditorContent } from '@tiptap/vue-3'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { useNoteEditor } from '../composables/useNoteEditor'
import { getFindState } from '@/composables/findReplaceExtension'

function makeNote(content: string): Entity {
  const now = new Date().toISOString()
  return {
    id: 'nb-find-test',
    type: 'notebook',
    name: '查找测试笔记',
    description: '',
    properties: { content, noteType: 'markdown' },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function drain(): Promise<void> {
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

describe('notebook 查找替换接线', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setupEditor(content: string) {
    const es = useEntityStore(pinia)
    vi.spyOn(es, 'update').mockResolvedValue(undefined)
    const current: Ref<Entity | null> = ref(null)
    let api!: ReturnType<typeof useNoteEditor>
    const Host = defineComponent({
      setup() {
        api = useNoteEditor(computed(() => current.value))
        return () => h('div', api.editor.value ? [h(EditorContent, { editor: api.editor.value })] : [])
      },
    })
    const wrapper = mount(Host, { global: { plugins: [pinia] } })
    const note = makeNote(content)
    await es.add(note, 'user')
    current.value = note
    api.loadNote(note)
    await drain()
    return { api, wrapper }
  }

  it('setSearch 在 notebook 扩展栈下扫描匹配并循环跳转', async () => {
    const { api, wrapper } = await setupEditor('# 标题\n\n深海传说，深海之外。')
    api.editor.value!.commands.setSearch('深海')
    const st = getFindState(api.editor.value!.state)
    expect(st?.matches.length).toBe(2)
    api.editor.value!.commands.findNext()
    expect(st && getFindState(api.editor.value!.state)?.currentIdx).toBe(1)
    wrapper.unmount()
  })

  it('replaceAll 替换后经保存链落 md（真相源形态）', async () => {
    const { api, wrapper } = await setupEditor('海风海雨，海浪。')
    api.editor.value!.commands.setSearch('海')
    api.editor.value!.commands.replaceAll('山')
    expect(api.getMarkdown()).toContain('山风山雨，山浪。')
    expect(getFindState(api.editor.value!.state)?.matches.length).toBe(0)
    wrapper.unmount()
  })

  it('代码块内容不受排版影响（CodeBlockEnhanced 与官方 codeBlock 同名，跳过判定直接适用）', async () => {
    const { api, wrapper } = await setupEditor('正文你好,世界\n\n```\ncode, here\n```')
    const { applyTypographyToEditor } = await import('@/composables/typographyRules')
    const n = applyTypographyToEditor(api.editor.value!, 'off')
    expect(n).toBeGreaterThan(0)
    expect(api.getMarkdown()).toContain('正文你好，世界')
    expect(api.getMarkdown()).toContain('code, here')
    wrapper.unmount()
  })
})

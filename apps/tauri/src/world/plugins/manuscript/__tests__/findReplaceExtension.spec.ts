/**
 * 章内查找替换扩展测试（批1）：jsdom 真 Editor（同 editorLifecycle 范式），
 * 锁定装饰状态机的核心契约——扫描/循环跳转/单处替换/全部替换（倒序防位移）/清空。
 * 快捷键（Mod-f/H/Esc）依赖真实按键路由，不在单测覆盖（真机走查项）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { EditorContent } from '@tiptap/vue-3'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { useChapterEditor } from '../composables/useChapterEditor'
import { installStoreServices } from './storeServices'
import { clearWorldServiceTable } from '../../../service-registry'
import { getFindState } from '@/composables/findReplaceExtension'

function makeChapter(content: string): Entity {
  const now = new Date().toISOString()
  return {
    id: 'ms-find-test',
    type: 'manuscript',
    name: '查找测试章节',
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

describe('查找替换扩展', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    // useChapterEditor 已改经树服务取数（批次 H），不起树时必须登记转发服务表
    installStoreServices()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearWorldServiceTable()
  })

  /** 建一个挂载了真实 useChapterEditor 编辑器的宿主，载入内容后返回编辑器 */
  async function setupEditor(content: string) {
    const es = useEntityStore(pinia)
    vi.spyOn(es, 'update').mockResolvedValue(undefined)
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
    const chapter = makeChapter(content)
    await es.add(chapter, 'user')
    current.value = chapter
    api!.loadChapter(chapter)
    await drain()
    const editor = api!.editor.value!
    return { editor, wrapper }
  }

  it('setSearch 扫描全部匹配并高亮当前位置', async () => {
    const { editor, wrapper } = await setupEditor('<p>深海之中，深海之外。</p>')
    editor.commands.setSearch('深海')
    const st = getFindState(editor.state)
    expect(st?.matches.length).toBe(2)
    expect(st?.currentIdx).toBe(0)
    expect(st?.searchTerm).toBe('深海')
    wrapper.unmount()
  })

  it('findNext/findPrev 循环跳转不越界', async () => {
    const { editor, wrapper } = await setupEditor('<p>甲乙甲乙甲</p>')
    editor.commands.setSearch('甲')
    editor.commands.findNext()
    expect(getFindState(editor.state)?.currentIdx).toBe(1)
    editor.commands.findNext()
    expect(getFindState(editor.state)?.currentIdx).toBe(2)
    editor.commands.findNext() // 末尾回卷
    expect(getFindState(editor.state)?.currentIdx).toBe(0)
    editor.commands.findPrev() // 起点回卷
    expect(getFindState(editor.state)?.currentIdx).toBe(2)
    wrapper.unmount()
  })

  it('replaceCurrent 替换当前处并自动重扫', async () => {
    const { editor, wrapper } = await setupEditor('<p>邪魔传说，邪魔再临。</p>')
    editor.commands.setSearch('邪魔')
    editor.commands.replaceCurrent('神灵')
    expect(editor.getHTML()).toContain('神灵传说，邪魔再临')
    const st = getFindState(editor.state)
    expect(st?.matches.length).toBe(1)
    expect(st?.matches[0]).toMatchObject({ from: 6, to: 8 }) // 重扫后指向剩余处
    wrapper.unmount()
  })

  it('replaceAll 倒序全量替换（含跨段）', async () => {
    const { editor, wrapper } = await setupEditor('<p>海风海雨</p><p>海浪</p>')
    editor.commands.setSearch('海')
    editor.commands.replaceAll('山')
    expect(editor.getHTML()).toContain('<p>山风山雨</p>')
    expect(editor.getHTML()).toContain('<p>山浪</p>')
    expect(getFindState(editor.state)?.matches.length).toBe(0)
    wrapper.unmount()
  })

  it('替换为空串 = 删除匹配', async () => {
    const { editor, wrapper } = await setupEditor('<p>邪魔传说</p>')
    editor.commands.setSearch('邪魔')
    editor.commands.replaceAll('')
    expect(editor.getHTML()).toContain('传说')
    wrapper.unmount()
  })

  it('文档编辑后匹配自动重扫（输入期间计数不漂移）', async () => {
    const { editor, wrapper } = await setupEditor('<p>深海传说</p>')
    editor.commands.setSearch('深海')
    expect(getFindState(editor.state)?.matches.length).toBe(1)
    editor.commands.insertContentAt(1, '深海') // docChanged → apply 重扫
    expect(getFindState(editor.state)?.matches.length).toBe(2)
    wrapper.unmount()
  })

  it('clearSearch 清空匹配与装饰', async () => {
    const { editor, wrapper } = await setupEditor('<p>深海</p>')
    editor.commands.setSearch('深海')
    editor.commands.clearSearch()
    const st = getFindState(editor.state)
    expect(st?.searchTerm).toBe('')
    expect(st?.matches.length).toBe(0)
    wrapper.unmount()
  })
})

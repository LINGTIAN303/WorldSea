import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import type { Entity } from '@worldsmith/entity-core'

const createMockEditor = () => ({
  getHTML: vi.fn(() => '<p>hello</p>'),
  getText: vi.fn(() => 'hello'),
  commands: { setContent: vi.fn() },
  chain: vi.fn(() => ({
    focus: vi.fn(() => ({
      insertContent: vi.fn(() => ({ run: vi.fn() })),
      deleteRange: vi.fn(() => ({ run: vi.fn() })),
    })),
  })),
  destroy: vi.fn(),
})

const mockEditorRef: { value: ReturnType<typeof createMockEditor> } = { value: createMockEditor() }
const editorConfigRef: { value: any } = { value: null }
const mockUpdate = vi.fn()

vi.mock('@tiptap/vue-3', () => ({
  useEditor: (config: any) => {
    editorConfigRef.value = config
    return mockEditorRef
  },
}))

vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-mention', () => ({
  default: { configure: () => ({}) },
}))
vi.mock('@tiptap/suggestion', () => ({
  default: () => ({}),
}))
vi.mock('../slashCommandExtension', () => ({
  default: { configure: () => ({}) },
  SLASH_COMMANDS: [],
}))

vi.mock('@worldsmith/entity-core', () => ({
  useEntityStore: () => ({
    entities: [],
    update: mockUpdate,
  }),
  entitySchemaRegistry: {
    getLabel: () => '实体',
    getIcon: () => 'clipboard-list',
  },
}))

function makeEntity(id: string, content = ''): Entity {
  return { id, name: id, type: 'notebook', description: '', properties: { content }, tags: [], createdAt: '', updatedAt: '' }
}

import { useNoteEditor } from '../composables/useNoteEditor'

describe('useNoteEditor', () => {
  beforeEach(() => {
    mockEditorRef.value = createMockEditor()
    mockUpdate.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('loadNote', () => {
    it('设置编辑器内容为实体 properties.content', () => {
      const note = ref<Entity | null>(makeEntity('n1', '<p>content</p>'))
      const { loadNote } = useNoteEditor(note)
      loadNote(note.value)
      expect(mockEditorRef.value.commands.setContent).toHaveBeenCalledWith('<p>content</p>', { emitUpdate: false })
    })

    it('entity 为 null 时清空编辑器', () => {
      const note = ref<Entity | null>(null)
      const { loadNote } = useNoteEditor(note)
      loadNote(null)
      expect(mockEditorRef.value.commands.setContent).toHaveBeenCalledWith('', { emitUpdate: false })
    })

    it('加载后将 saveStatus 重置为 saved', () => {
      const note = ref<Entity | null>(makeEntity('n1', '<p>test</p>'))
      const { loadNote, saveStatus } = useNoteEditor(note)
      loadNote(note.value)
      expect(saveStatus.value).toBe('saved')
    })

    it('切换笔记前保存未保存的内容', async () => {
      const oldNote = makeEntity('old', '<p>old</p>')
      const note = ref<Entity | null>(oldNote)
      const { loadNote, saveStatus } = useNoteEditor(note)
      loadNote(oldNote)
      mockEditorRef.value.getHTML.mockReturnValue('<p>modified</p>')
      saveStatus.value = 'unsaved'
      loadNote(makeEntity('new', '<p>new</p>'))
      expect(mockUpdate).toHaveBeenCalledWith('old', {
        properties: { content: '<p>modified</p>' },
      })
    })
  })

  describe('flushSave', () => {
    it('使用 editor.getHTML() 保存到实体', async () => {
      const note = ref<Entity | null>(makeEntity('n1', ''))
      mockEditorRef.value.getHTML.mockReturnValue('<p>saved content</p>')
      const { flushSave } = useNoteEditor(note)
      await flushSave()
      expect(mockUpdate).toHaveBeenCalledWith('n1', {
        properties: { content: '<p>saved content</p>' },
      })
    })

    it('没有 note 时跳过保存', async () => {
      const note = ref<Entity | null>(null)
      const { flushSave } = useNoteEditor(note)
      await flushSave()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('成功后 saveStatus 变为 saved', async () => {
      const note = ref<Entity | null>(makeEntity('n1'))
      const { flushSave, saveStatus } = useNoteEditor(note)
      await flushSave()
      expect(saveStatus.value).toBe('saved')
    })

    it('保存失败时 saveStatus 变为 unsaved', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('fail'))
      const note = ref<Entity | null>(makeEntity('n1'))
      const { flushSave, saveStatus } = useNoteEditor(note)
      await flushSave()
      expect(saveStatus.value).toBe('unsaved')
    })
  })

  describe('getHTML / getText', () => {
    it('getHTML 返回 editor.getHTML()', () => {
      const note = ref<Entity | null>(null)
      mockEditorRef.value.getHTML.mockReturnValue('<p>abc</p>')
      const { getHTML } = useNoteEditor(note)
      expect(getHTML()).toBe('<p>abc</p>')
    })

    it('getText 返回 editor.getText()', () => {
      const note = ref<Entity | null>(null)
      mockEditorRef.value.getText.mockReturnValue('abc')
      const { getText } = useNoteEditor(note)
      expect(getText()).toBe('abc')
    })
  })

  describe('autosave', () => {
    it('输入后 300ms 自动保存', async () => {
      vi.useFakeTimers()
      const note = ref<Entity | null>(makeEntity('n1'))
      useNoteEditor(note)
      editorConfigRef.value.onUpdate({ editor: mockEditorRef.value })
      mockEditorRef.value.getHTML.mockReturnValue('<p>auto</p>')
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      expect(mockUpdate).toHaveBeenCalledWith('n1', {
        properties: { content: '<p>auto</p>' },
      })
      vi.useRealTimers()
    })

    it('自动保存后 saveStatus 变为 saved', async () => {
      vi.useFakeTimers()
      const note = ref<Entity | null>(makeEntity('n1'))
      const { saveStatus } = useNoteEditor(note)
      editorConfigRef.value.onUpdate({ editor: mockEditorRef.value })
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      expect(saveStatus.value).toBe('saved')
      vi.useRealTimers()
    })
  })

  describe('mention / slash command', () => {
    it('setMentionPopover 保存引用', () => {
      const note = ref<Entity | null>(null)
      const { setMentionPopover, onMentionSelect } = useNoteEditor(note)
      const mockOpen = vi.fn()
      const mockClose = vi.fn()
      setMentionPopover({ open: mockOpen, close: mockClose })
      expect(() => onMentionSelect({ id: 'e1', name: 'E1', type: 'character', typeLabel: '角色', icon: 'user' })).not.toThrow()
    })

    it('setSlashCommandPopover 保存引用', () => {
      const note = ref<Entity | null>(null)
      const { setSlashCommandPopover, onSlashCommandSelect } = useNoteEditor(note)
      const mockOpen = vi.fn()
      const mockClose = vi.fn()
      setSlashCommandPopover({ open: mockOpen, close: mockClose, updateItems: vi.fn(), onKeyDown: vi.fn(() => false) })
      expect(() => onSlashCommandSelect({ id: 'continue', label: '续写', icon: '✍️', description: 'AI 续写' })).not.toThrow()
    })
  })

  describe('wordCount', () => {
    it('加载笔记后 wordCount 更新', () => {
      const note = ref<Entity | null>(makeEntity('n1', '<p>hello world</p>'))
      mockEditorRef.value.getText.mockReturnValue('hello world')
      const { loadNote, wordCount } = useNoteEditor(note)
      loadNote(note.value)
      expect(wordCount.value).toBe(11)
    })
  })
})

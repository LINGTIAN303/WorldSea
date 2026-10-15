/**
 * noteLinkExt — `[[ ]]` 笔记双链（批 3 I4，2026-10-12）。
 *
 * 组成：
 * ① NoteLink mark：正文内笔记引用（`<a data-note-id data-note-name class="nb-nolink">`），
 *    与 @ 实体提及语义分离（提及=实体徽标；双链=笔记间引用，参与 note_link 反链图谱）；
 * ② NoteLinkSuggestion：输入 `[[` 弹笔记选择器（弹层复用 MentionPopover，条目=notebook
 *    实体的 MentionItem 形状），选中 → 插入带 mark 的文本 + 回调建 note_link 关系。
 *
 * 跳转：编辑态 Ctrl/Cmd+点击（handleClick 在 useNoteEditor 的 editorProps）；预览态直接点击
 * （容器 click 委托，见 NotebookTipTapEditor 的 onPreviewClick）。删除 mark 不清理关系（挂账）。
 */
import { Mark, Extension } from '@tiptap/core'
import suggestion from '@tiptap/suggestion'
import type { SuggestionOptions } from '@tiptap/suggestion'
import type { Editor } from '@tiptap/core'
import { useEntityStore } from '@worldsea/entity-core'

/** `[[ ]]` 选择器条目（MentionItem 形状——弹层复用 MentionPopover） */
export interface NoteLinkCandidate {
  id: string
  name: string
  type: string
  typeLabel: string
  icon: string
}

export interface NoteLinkOptions {
  /** 当前笔记 id（选择器排除自身；null = 未打开笔记，选择器不出） */
  currentNoteId: () => string | null
  /** 弹层接线（useNoteEditor 转发到 MentionPopover 实例） */
  openPopover: (rect: (() => DOMRect | null) | null, items: NoteLinkCandidate[]) => void
  updatePopover: (items: NoteLinkCandidate[]) => void
  closePopover: () => void
  onKeyDown: (event: KeyboardEvent) => boolean
  /** 选中条目后的关系落库回调（useNoteEditor 内做幂等 note_link） */
  onInsert: (targetId: string) => void
}

/** mark：正文内笔记引用 */
export const NoteLink = Mark.create({
  name: 'noteLink',
  inclusive: false,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: element => element.getAttribute('data-note-id'),
        renderHTML: attributes => ({ 'data-note-id': attributes.noteId }),
      },
      noteName: {
        default: null,
        parseHTML: element => element.getAttribute('data-note-name'),
        renderHTML: attributes => ({ 'data-note-name': attributes.noteName }),
      },
    }
  },

  parseHTML() {
    // priority 1100 > StarterKit Link(1000)：a[data-note-id] 必须归 noteLink——
    // 否则被 Link 扩展抢走，装载退化为普通链接（[名](#)，丢双链语义）。
    // 实证：2026-10-15 块 1 转换器单测暴露（HTML→md 产出 [某笔记](#) 而非 [[某笔记]]）；
    // 同一条 parseDOM 是旧链路「重开笔记」的装载路径，故此修复同时消除既有退化风险。
    return [{ tag: 'a[data-note-id]', priority: 1100 }]
  },

  renderHTML({ HTMLAttributes }) {
    // href='#' 保证预览态可点（点击由容器委托处理并 preventDefault）
    return ['a', { ...HTMLAttributes, class: 'nb-nolink', href: '#' }, 0]
  },

  // ── Markdown 往返（块 1，2026-10-15；协议 D-1：`[[笔记名]]`）──
  // 序列化：mark 开/闭标记 = `[[` / `]]`（manager 以「合成节点 + 占位符桩」调用 renderMarkdown
  //   并切分——覆盖文本即笔记名，与 insertNoteLink 的插入形态一致）；
  // 解析：tokenizer 识别 `[[名]]` → 查库唯一命中 → noteLink mark；未命中 / 多匹配（歧义，
  //   协议裁决 E 归块 2）→ 字面文本回退（引擎转义 `\[\[` 防 re-parse 歧义——渲染显示不变，
  //   恢复链接经编辑态 `[[` 弹层重建；引擎转义实证见 markdownSmoke.spec）。
  markdownTokenName: 'noteLink',
  markdownTokenizer: {
    name: 'noteLink',
    level: 'inline',
    // 显式 start：省略 start 时 manager 以「全串 tokenize 探测」定位，锚定正则必然落空
    start: (src: string) => src.indexOf('[['),
    tokenize(src: string) {
      const m = /^\[\[([^\[\]\n]+)\]\]/.exec(src)
      if (!m) return undefined
      return { type: 'noteLink', raw: m[0] }
    },
  },
  parseMarkdown(token, helpers) {
    const raw = String((token as { raw?: string }).raw ?? '')
    const m = /^\[\[([^\[\]\n]+)\]\]/.exec(raw)
    const name = m ? m[1].trim() : ''
    const hit = name ? resolveNoteByName(name) : null
    if (!hit) return { type: 'text', text: raw || `[[${name}]]` }
    return helpers.applyMark('noteLink', [helpers.createTextNode(name)], {
      noteId: hit.id,
      noteName: name,
    })
  },
  renderMarkdown(node, helpers) {
    return `[[${helpers.renderChildren(node.content ?? [])}]]`
  },
})

export interface NoteLinkSuggestionOptions {
  suggestion: Partial<SuggestionOptions<NoteLinkCandidate, NoteLinkCandidate>>
}

export const NoteLinkSuggestion = Extension.create<NoteLinkSuggestionOptions>({
  name: 'noteLinkSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '[[',
        items: () => [], // 由 configure 处注入（依赖实体 store 与当前笔记 id）
        command: () => {}, // 由 configure 处注入（需要 insertContent + 关系落库）
        render: () => ({}),
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})

/** 选中条目后的插入动作（configure 的 command 调用；editorExtensions 组装） */
export function insertNoteLink(
  editor: Editor,
  range: { from: number; to: number },
  target: NoteLinkCandidate,
): void {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([{
      type: 'text',
      text: target.name,
      marks: [{ type: 'noteLink', attrs: { noteId: target.id, noteName: target.name } }],
    }])
    .run()
}

/** 导航用：从事件目标找笔记链接（编辑态 Ctrl+点击 / 预览态委托共用） */
export function findNoteLinkAnchor(target: EventTarget | null): HTMLElement | null {
  const el = target as HTMLElement | null
  return el?.closest?.('a[data-note-id]') ?? null
}

/**
 * 名称 → 唯一笔记实体（md 解析用；块 1，2026-10-15）。
 * 未命中 / 多匹配（歧义，协议裁决 E 归块 2）/ 异常（store 未就绪）→ null → 字面文本回退。
 */
function resolveNoteByName(name: string): { id: string } | null {
  try {
    const es = useEntityStore()
    const matches = (es.entities ?? []).filter((e) => e.type === 'notebook' && e.name === name)
    return matches.length === 1 ? { id: matches[0].id } : null
  } catch {
    return null
  }
}

/**
 * editorExtensions — 笔记本编辑器扩展集组装（批 1，2026-10-12）。
 *
 * 从 useNoteEditor 的内联扩展清单收敛至此，职责：
 * ① 组装全部扩展（StarterKit 减 codeBlock 让位给增强版；任务列表；表格；图片；mention；斜杠命令；
 *    Markdown —— md 往返底座，块 1 接线）；
 * ② **marked GFM 任务列表兼容**：装载网关把 Agent 写的 `- [ ] 待办` 渲染成
 *    `<li><input disabled type="checkbox"> 文本</li>`（marked 18 实证形态，无 class 无 data-*），
 *    官方 TaskItem 只认 `li[data-type="taskItem"]` —— 此处 extend parseHTML 兼容：匹配普通 li
 *    中的 checkbox 标记并读出勾选态（勾选框元素本身不在 schema，解析时自然丢弃，无需删除）。
 *
 * hooks = mention/斜杠命令弹层的接线回调组（useNoteEditor 实现并转发到弹层组件实例）：
 * 弹层组件暴露 open(rect)/close() 方法；**锚点 rect 由本模块自建**
 * （makeCharAnchorRect，以「指令符」自身坐标为锚）——suggestion 传入的 props.clientRect
 * 在真机退化为「光标锚」（弹层横向偏移到光标侧，2026-10-12 走查实锤），故不再采用。
 */
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { Markdown } from '@tiptap/markdown'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import type { Editor } from '@tiptap/core'
import type { Entity } from '@worldsea/entity-core'
import { entitySchemaRegistry, useEntityStore } from '@worldsea/entity-core'

import CodeBlockEnhanced from './codeBlockExt'
import { NotebookImage } from './notebookImage'
import SlashCommandExtension, { SLASH_COMMANDS, type SlashCommandItem } from './slashCommandExtension'
import { tableInputRuleExtension, tablePasteExtension } from './tableInputRule'
import { NoteLink, NoteLinkSuggestion, insertNoteLink, type NoteLinkCandidate } from './noteLinkExt'
import { PluginKey } from '@tiptap/pm/state'

/** 双链 suggestion 的独立插件键（与斜杠/mention 的 suggestion 并存） */
const noteLinkPluginKey = new PluginKey('notebookNoteLinkSuggestion')

/**
 * 弹层锚点 rect —— 以「指令符」自身位置为锚（走查修复轮 4，2026-10-12）。
 *
 * 背景：suggestion v3 传给 render 回调的 `props.clientRect` 在真机上退化为
 * 「光标 anchor 坐标」（其内部 getAnchorClientRect 路径）——弹层横向锚到**光标**
 * 而非指令符，症状 = 弹层出现在「光标行的右侧、偏移一段距离」。此处改用
 * `props.range.from`（= 指令符字符的文档位置）自取坐标：
 * - x 对齐指令符左缘（不再随过滤输入的光标漂移）；
 * - 返回「实时函数」——每次调用重新取当前坐标（滚动/布局变化自然跟随）；
 * - 文档位置失效（如字符被删）时返回 null —— 调用方保持原位不乱跳。
 */
export function makeCharAnchorRect(editor: Editor, pos: number): () => DOMRect | null {
  return () => {
    try {
      const coords = editor.view.coordsAtPos(pos)
      return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
    } catch {
      return null
    }
  }
}

export interface MentionItem {
  id: string
  name: string
  type: string
  typeLabel: string
  icon: string
}

/** mention/斜杠/双链弹层接线回调组（useNoteEditor 实现；rect = suggestion 的 clientRect 位置函数） */
export interface EditorExtensionHooks {
  openMentionPopover: (rect: (() => DOMRect | null) | null) => void
  closeMentionPopover: () => void
  openSlashPopover: (rect: (() => DOMRect | null) | null, items: SlashCommandItem[]) => void
  updateSlashPopover: (items: SlashCommandItem[]) => void
  closeSlashPopover: () => void
  onSlashKeyDown: (event: KeyboardEvent) => boolean
  /** 双链弹层（复用 MentionPopover 实例；useNoteEditor 以弹层 kind 分派 select） */
  openNoteLinkPopover: (rect: (() => DOMRect | null) | null, items: NoteLinkCandidate[]) => void
  updateNoteLinkPopover: (items: NoteLinkCandidate[]) => void
  closeNoteLinkPopover: () => void
  onNoteLinkKeyDown: (event: KeyboardEvent) => boolean
  /** 双链插入后的关系落库回调（useNoteEditor 内做幂等 note_link） */
  onNoteLinkInsert: (targetId: string) => void
  /** 当前笔记 id（双链选择器排除自身；null = 未打开笔记不出弹层） */
  currentNoteId: () => string | null
}

/**
 * 组装笔记本编辑器扩展集。
 */
export function buildNotebookExtensions(hooks: EditorExtensionHooks): any[] {
  return [
    StarterKit.configure({
      // codeBlock 由增强版（NodeView：语言下拉/复制/高亮）接管
      codeBlock: false,
      // 编辑态链接不可点开（打断编辑流）；外链走预览态
      link: { openOnClick: false },
    }),
    // md 往返底座（块 1，2026-10-15）：解析/序列化用官方 marked 内核，与渲染链同源；
    // 缩进 2 空格与协议一致。自定义节点 handler 见各自扩展（notebookImage / noteLinkExt / Mention）。
    Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    CodeBlockEnhanced,
    // 任务列表：官方结构（li[data-type=taskItem]）+ marked GFM 兼容（实证形态：
    // `<ul><li><input disabled type="checkbox"> 文本</li></ul>`，无 class 无 data-*）。
    // 用 getAttrs 函数式匹配（jsdom 不支持 :has()；getAttrs 返回 false 则回落 bulletList 规则）。
    // 内外层必须同时兼容——否则 ProseMirror 解析器对「taskItem 塞进 bulletList」整体回退。
    TaskList.extend({
      parseHTML() {
        return [
          { tag: 'ul[data-type="taskList"]' },
          {
            tag: 'ul',
            priority: 60,
            getAttrs: (el: HTMLElement) =>
              el.querySelector('li input[type="checkbox"]') ? {} : false,
          },
        ]
      },
    }),
    TaskItem.extend({
      addAttributes() {
        return {
          checked: {
            default: false,
            keepOnSplit: false,
            // 官方读 data-checked；marked 形态读 li 内 checkbox 的 checked 属性
            parseHTML: (element: HTMLElement) => {
              const dataChecked = element.getAttribute('data-checked')
              if (dataChecked !== null) return dataChecked === '' || dataChecked === 'true'
              const box = element.querySelector('input[type="checkbox"]')
              return box?.hasAttribute('checked') ?? false
            },
          },
        }
      },
      parseHTML() {
        return [
          { tag: `li[data-type="${this.name}"]`, priority: 51 },
          {
            tag: 'li',
            priority: 60,
            getAttrs: (el: HTMLElement) =>
              el.querySelector('input[type="checkbox"]') ? {} : false,
          },
        ]
      },
    }).configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    // 图片（批 5 I7）：官方 Image + resize 引擎（四角手柄拖宽/等比，onCommit 落库 width/height）
    // + 对齐（align 属性，编辑端 data-align[prose.css] / 落库 style 合成[notebookImage]）。
    // 手柄样式见 prose.css 的 [data-resize-handle] 段。工具栏「图片组」在 NotebookTipTapEditor。
    NotebookImage.configure({
      inline: false,
      allowBase64: true,
      resize: { enabled: true, minWidth: 60, minHeight: 40, alwaysPreserveAspectRatio: true },
    }),
    tableInputRuleExtension,
    tablePasteExtension,
    NoteLink,
    NoteLinkSuggestion.configure({
      suggestion: {
        // 独立 pluginKey：与斜杠命令/mention 的 suggestion 插件并存（默认同 key 会崩）
        pluginKey: noteLinkPluginKey,
        char: '[[',
        items: ({ query }: { query: string }) => {
          const es = useEntityStore()
          const selfId = hooks.currentNoteId()
          const all = (es.entities ?? [])
            .filter((e: Entity) => e.type === 'notebook' && e.id !== selfId)
            .map((e: Entity) => ({
              id: e.id,
              name: e.name,
              type: 'notebook',
              typeLabel: '笔记',
              icon: 'notebook',
            }))
          if (!query) return all.slice(0, 20)
          const q = query.toLowerCase()
          return all.filter(i => i.name.toLowerCase().includes(q)).slice(0, 20)
        },
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: NoteLinkCandidate }) => {
          insertNoteLink(editor, range, props)
          hooks.onNoteLinkInsert(props.id)
        },
        render: () => ({
          onStart: (props) => {
            noteLinkCommandRef = props.command
            // 锚点 = 指令符 `[[` 自身坐标（见 makeCharAnchorRect 头注释）
            hooks.openNoteLinkPopover(makeCharAnchorRect(props.editor, props.range.from), props.items)
          },
          onUpdate: (props) => {
            hooks.updateNoteLinkPopover(props.items)
          },
          onExit: () => {
            hooks.closeNoteLinkPopover()
          },
          onKeyDown: (props) => {
            return hooks.onNoteLinkKeyDown(props.event)
          },
        }),
      },
    }),
    Mention.extend({
      // ── Markdown 往返（块 1，2026-10-15；协议裁决 A：`@实体名` 文本直写 + 解析匹配）──
      // 序列化：节点 → `@label`（inline 文本）；解析：tokenizer 识别 `@词形` → 查库唯一命中
      // → mention 节点；未命中 / 多匹配（歧义归块 2）→ 字面文本回退（email 等误形态同理，
      // 「实体唯一命中」为最终防线）。
      markdownTokenName: 'mention',
      markdownTokenizer: {
        name: 'mention',
        level: 'inline',
        // 显式 start：省略时 manager 以「全串 tokenize 探测」定位，锚定正则必然落空
        start: (src: string) => src.indexOf('@'),
        tokenize(src: string) {
          const m = /^@([\u4e00-\u9fa5A-Za-z0-9_]{1,30})/.exec(src)
          if (!m) return undefined
          return { type: 'mention', raw: m[0] }
        },
      },
      parseMarkdown(token, helpers) {
        const raw = String((token as { raw?: string }).raw ?? '')
        const m = /^@([\u4e00-\u9fa5A-Za-z0-9_]{1,30})/.exec(raw)
        const label = m ? m[1] : ''
        const hit = label ? resolveEntityByName(label) : null
        if (!hit) return { type: 'text', text: raw || `@${label}` }
        return helpers.createNode('mention', { id: hit.id, label })
      },
      renderMarkdown(node) {
        return `@${node.attrs?.label ?? ''}`
      },
    }).configure({
      HTMLAttributes: { class: 'nb-mention' },
      suggestion: {
        char: '@',
        items: ({ query }: { query: string }) => {
          const es = useEntityStore()
          const all = (es.entities ?? []).map((e: Entity) => ({
            id: e.id,
            name: e.name,
            type: e.type,
            typeLabel: entitySchemaRegistry.getLabel(e.type),
            icon: entitySchemaRegistry.getIconName(e.type) || 'clipboard-list',
          }))
          if (!query) return all.slice(0, 20)
          const q = query.toLowerCase()
          return all.filter(i =>
            i.name.toLowerCase().includes(q) || i.typeLabel.toLowerCase().includes(q),
          ).slice(0, 20)
        },
        render: () => ({
          onStart: (props) => {
            // 锚点 = 指令符 `@` 自身坐标（见 makeCharAnchorRect 头注释）
            hooks.openMentionPopover(makeCharAnchorRect(props.editor, props.range.from))
            mentionCommand = props.command
          },
          onUpdate: (props) => {
            mentionCommand = props.command
          },
          onExit: () => {
            hooks.closeMentionPopover()
            mentionCommand = null
          },
          onKeyDown: (props) => {
            if (props.event.key === 'Escape') {
              hooks.closeMentionPopover()
              return true
            }
            return false
          },
        }),
      },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    }),
    SlashCommandExtension.configure({
      suggestion: {
        char: '/',
        items: ({ query }: { query: string }) => {
          if (!query) return SLASH_COMMANDS
          const q = query.toLowerCase()
          return SLASH_COMMANDS.filter(item =>
            item.label.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q),
          )
        },
        command: ({ editor, range }: { editor: Editor; range: { from: number; to: number } }) => {
          editor.chain().focus().deleteRange(range).run()
        },
        render: () => ({
          onStart: (props) => {
            slashCommandRef = props.command
            // 锚点 = 指令符 `/` 自身坐标（见 makeCharAnchorRect 头注释）
            hooks.openSlashPopover(makeCharAnchorRect(props.editor, props.range.from), props.items)
          },
          onUpdate: (props) => {
            slashCommandRef = props.command
            hooks.updateSlashPopover(props.items)
          },
          onExit: () => {
            hooks.closeSlashPopover()
            slashCommandRef = null
          },
          onKeyDown: (props) => {
            return hooks.onSlashKeyDown(props.event)
          },
        }),
      },
    }),
  ]
}

/** mention/斜杠/双链的 suggestion 命令句柄（弹层 select 时由 useNoteEditor 分派调用） */
let mentionCommand: ((props: { id: string; label?: string }) => void) | null = null
let slashCommandRef: ((props: { id: string; label?: string }) => void) | null = null
let noteLinkCommandRef: ((props: any) => void) | null = null

export function fireMentionCommand(item: MentionItem): void {
  mentionCommand?.({ id: item.id, label: item.name })
}

export function fireSlashCommand(item: SlashCommandItem): void {
  slashCommandRef?.({ id: item.id, label: item.label })
}

/** 双链：弹层选中的条目回灌给 suggestion 命令句柄 → 框架执行 insertNoteLink + 关系落库 */
export function fireNoteLinkCommand(item: { id: string; name: string }): void {
  noteLinkCommandRef?.({ ...item })
}

/**
 * 名称 → 唯一实体（md 解析用；块 1，2026-10-15）。
 * 未命中 / 多匹配（歧义归块 2）/ 异常（store 未就绪）→ null → 字面文本回退。
 */
function resolveEntityByName(name: string): { id: string } | null {
  try {
    const es = useEntityStore()
    const matches = (es.entities ?? []).filter((e: Entity) => e.name === name)
    return matches.length === 1 ? { id: matches[0].id } : null
  } catch {
    return null
  }
}

/**
 * md 往返测试工具（块 1）：noop 接线 + 全量编辑器构造（markdownSmoke / markdownRoundtrip 共用）。
 * 非 spec 文件（不被 vitest 当测试收集）。
 */
import { Editor } from '@tiptap/core'
import { buildNotebookExtensions, type EditorExtensionHooks } from '../composables/editorExtensions'

/** 空接线（popover/suggestion 回调——测试不驱动交互层） */
export const noopHooks: EditorExtensionHooks = {
  openMentionPopover: () => {},
  closeMentionPopover: () => {},
  openSlashPopover: () => {},
  updateSlashPopover: () => {},
  closeSlashPopover: () => {},
  onSlashKeyDown: () => false,
  openNoteLinkPopover: () => {},
  updateNoteLinkPopover: () => {},
  closeNoteLinkPopover: () => {},
  onNoteLinkKeyDown: () => false,
  currentNoteId: () => null,
}

/** 全量编辑器（buildNotebookExtensions + md 直装） */
export function makeFullEditor(md: string): Editor {
  return new Editor({
    extensions: buildNotebookExtensions(noopHooks),
    content: md,
    contentType: 'markdown',
  })
}

/** md → 编辑器解析 → 序列化（一次往返；用完即销毁） */
export function roundtrip(md: string): string {
  const ed = makeFullEditor(md)
  const out = ed.getMarkdown()
  ed.destroy()
  return out
}

/**
 * 存量迁移：notebook 正文 HTML → md（块 1 阶段 2，2026-10-15）
 *
 * 用**运行时同款**编辑器（buildNotebookExtensions + @tiptap/markdown）做转换——
 * 保真度与阶段 3 切换后的链路一致（同一套 handler/schema，不另造转换器）。
 * 批量场景复用单实例（createConverter）；仅供迁移脚本 / 单测使用，
 * 应用运行时代码不 import 本模块。
 */
import { Editor } from '@tiptap/core'
import { buildNotebookExtensions, type EditorExtensionHooks } from '../composables/editorExtensions'

/** 迁移用空接线（不驱动交互层——popover/suggestion 回调不会被触发） */
const MIGRATION_HOOKS: EditorExtensionHooks = {
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
  onNoteLinkInsert: () => {},
  currentNoteId: () => null,
}

export interface NotebookHtmlConverter {
  /** HTML 正文 → md（复用内部编辑器实例） */
  convert(html: string): string
  /** 释放编辑器实例 */
  dispose(): void
}

export function createConverter(): NotebookHtmlConverter {
  const editor = new Editor({
    extensions: buildNotebookExtensions(MIGRATION_HOOKS),
    content: '',
  })
  return {
    convert(html: string): string {
      editor.commands.setContent(html)
      return editor.getMarkdown()
    },
    dispose(): void {
      editor.destroy()
    },
  }
}

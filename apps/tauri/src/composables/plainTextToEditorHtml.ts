/**
 * plainTextToEditorHtml — TipTap 编辑器加载侧的纯文本归一（2026-10-02）。
 *
 * 背景：编辑器保存侧写回 getHTML()（`<p>…</p>`），加载侧 setContent 把字符串按 HTML 解析。
 * 从 JSON 文件等外部来源写入的**纯文本**（含 `\n`）在 HTML 语义里只是普通空白，
 * 换行会被折叠成空格。本工具在加载边界归一：
 *
 * - 不含 `<`（完全非 HTML）→ 按纯文本处理：HTML 转义后按换行拆成 `<p>` 段；
 *   纯文本一旦在编辑器内保存即归化为标准 HTML，与正常写作内容合流。
 * - 含 `<` → 原样返回，维持既有 HTML 解析行为（当前能正常显示的内容零变化）。
 */

/** 判定是否为「看起来像 HTML 标签」的保守阈值：出现 `<` 即按 HTML 走（避免把含 `<` 的内容误转义） */
function looksLikeHtml(content: string): boolean {
  return content.includes('<')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function plainTextToEditorHtml(content: string): string {
  if (!content) return ''
  if (looksLikeHtml(content)) return content
  return content
    .split(/\r\n|\r|\n/)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

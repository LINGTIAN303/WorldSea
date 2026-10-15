/**
 * markdownText — md 文本 → 纯文本（块 1 阶段 3 单源，2026-10-15）。
 * 消费方：笔记本检索（NotebookView，调用侧压平）/ 导出 txt（useManuscriptExport，保留段落结构）。
 * 剥除标记符号、保留全部文字内容（含代码块内文本与图片 alt/双链名）。
 */
export function markdownToPlainText(md?: string): string {
  return (md || '')
    .replace(/```([\s\S]*?)```/g, '$1')        // 围栏：去围栏、保留内部文本
    .replace(/`([^`]*)`/g, '$1')               // 行内码：去反引号
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')  // 图片：留 alt 文字
    .replace(/\[\[([^\]]+)\]\]/g, '$1')        // 双链：留笔记名
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // 链接：留文字
    .replace(/^[ \t]*[-*+] /gm, '')            // 行首列表符
    .replace(/^[ \t]*#{1,6} /gm, '')           // 行首标题符
    .replace(/^[ \t]*> /gm, '')                // 行首引用符
    .replace(/^[ \t]*---+[ \t]*$/gm, '')       // 分隔线行
    .replace(/^[ \t]*\|[\s|:-]+\|[ \t]*$/gm, '') // 表格分隔行（| --- | --- |）
    .replace(/[*_~]/g, '')                     // 强调符号
    .replace(/\|/g, ' ')                       // 表格竖线
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

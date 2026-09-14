import type { Entity } from '@worldsea/entity-core'
import { useFontStore } from '@/stores/fontStore'

function stripHTML(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

function htmlToText(html: string, includeTitle: boolean, title: string): string {
  const text = stripHTML(html)
  const paragraphs = text.split(/\n+/).filter(Boolean).join('\n\n')
  if (includeTitle && title) {
    return `${title}\n\n${paragraphs}`
  }
  return paragraphs
}

async function htmlToMarkdown(html: string, includeFrontmatter: boolean, entity: Entity): Promise<string> {
  const { default: TurndownService } = await import('turndown')
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
  })
  let md = turndown.turndown(html)
  if (includeFrontmatter) {
    const fm = [
      '---',
      `title: "${entity.name}"`,
      `status: ${entity.properties.status || '草稿'}`,
      `wordCount: ${entity.properties.wordCount || 0}`,
      `createdAt: ${entity.createdAt}`,
      '---',
      '',
    ].join('\n')
    md = fm + md
  }
  return md
}

/**
 * HTML → docx（富内容保真版，2026-09-14）。
 * 旧实现是 `stripHTML` 后逐行成段，丢失标题层级/列表/加粗/引用/代码/表格；
 * 现拆为「HTML → IR（htmlToDocxBlocks）→ docx 对象（blocksToDocx）」两层，
 * 解析层可被 jsdom 单测，映射层做 ZIP 冒烟 —— 架构同 `xlsxToTables.ts` 先例。
 *
 * docx 库（约 600KB+）保持动态加载：只有真正导出 docx 时才拉取。
 *
 * `includeTitle`：此前 docx 分支**忽略**该选项（标题恒插入，与 txt/md 分支及
 * ExportDialog 的勾选框不一致）—— 本版修正为与其它格式同语义。
 */
async function htmlToDocx(html: string, title: string, includeTitle = true): Promise<Blob> {
  const [{ htmlToBlocks }, { buildDocxBlob }] = await Promise.all([
    import('./htmlToDocxBlocks'),
    import('./blocksToDocx'),
  ])
  const fontStore = useFontStore()
  const exportFont = fontStore.prefs.preview.family || fontStore.prefs.content.family || 'Microsoft YaHei'
  const blocks = htmlToBlocks(html)
  return buildDocxBlob(blocks, { title: includeTitle ? title : '', defaultFont: exportFont })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadText(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  downloadBlob(blob, filename)
}

export function useManuscriptExport() {
  async function exportChapter(
    entity: Entity,
    format: 'txt' | 'md' | 'docx',
    options: { includeTitle?: boolean; includeFrontmatter?: boolean } = {}
  ) {
    const html = (entity.properties.content as string) || ''
    const title = entity.name
    const safeName = title.replace(/[/\\?%*:|"<>]/g, '_')

    switch (format) {
      case 'txt': {
        const text = htmlToText(html, options.includeTitle !== false, title)
        downloadText(text, `${safeName}.txt`)
        break
      }
      case 'md': {
        const md = await htmlToMarkdown(html, options.includeFrontmatter !== false, entity)
        downloadText(md, `${safeName}.md`, 'text/markdown')
        break
      }
      case 'docx': {
        const blob = await htmlToDocx(html, title, options.includeTitle !== false)
        downloadBlob(blob, `${safeName}.docx`)
        break
      }
    }
  }

  async function exportMultiple(
    entities: Entity[],
    format: 'txt' | 'md' | 'docx',
    options: { includeTitle?: boolean; includeFrontmatter?: boolean } = {}
  ) {
    if (format === 'docx') {
      const allHtml = entities.map(e => `<h1>${e.name}</h1>${(e.properties.content as string) || ''}`).join('<hr/>')
      const blob = await htmlToDocx(allHtml, '全部章节')
      downloadBlob(blob, '全部章节.docx')
    } else if (format === 'md') {
      const parts: string[] = []
      for (const e of entities) {
        parts.push(await htmlToMarkdown((e.properties.content as string) || '', options.includeFrontmatter !== false, e))
        parts.push('\n---\n')
      }
      downloadText(parts.join('\n'), '全部章节.md', 'text/markdown')
    } else {
      const parts: string[] = []
      for (const e of entities) {
        parts.push(htmlToText((e.properties.content as string) || '', true, e.name))
        parts.push('---')
      }
      downloadText(parts.join('\n\n'), '全部章节.txt')
    }
  }

  return { exportChapter, exportMultiple }
}

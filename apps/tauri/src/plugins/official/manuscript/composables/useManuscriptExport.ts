import type { Entity } from '@worldsmith/entity-core'
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

async function htmlToDocx(html: string, title: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
  const text = stripHTML(html)
  const lines = text.split('\n').filter(Boolean)
  const children: InstanceType<typeof Paragraph>[] = []

  children.push(new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
  }))

  const fontStore = useFontStore()
  const exportFont = fontStore.prefs.preview.family || fontStore.prefs.content.family || 'Microsoft YaHei'

  for (const line of lines) {
    children.push(new Paragraph({
      children: [new TextRun({ text: line, size: 24, font: exportFont })],
      spacing: { after: 120 },
    }))
  }

  const doc = new Document({
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
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
        const blob = await htmlToDocx(html, title)
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

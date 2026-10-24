import type { Entity } from '@worldsea/entity-core'
import { useFontStore } from '@/stores/fontStore'
import { renderMarkdownForEditor } from '@worldsea/shared-ui/markdown'
import { markdownToPlainText } from '@/composables/markdownText'

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

/**
 * 正文双形态解析（块 1 过渡期，2026-10-15）：
 * - notebook：content 为 md（真相源）——html 由渲染链（marked）按需生成；
 * - 其它类型（manuscript 等）：content 仍为 HTML（自身转型后续批——届时本分支退役）。
 */
function resolveContent(entity: Entity): { md: string; html: string } {
  const raw = (entity.properties.content as string) || ''
  if (entity.type === 'notebook') {
    return { md: raw, html: renderMarkdownForEditor(raw) }
  }
  return { md: '', html: raw }
}

/** 章节级 frontmatter（md 导出；原 htmlToMarkdown 内联逻辑抽出，notebook 直出路径复用） */
function chapterFrontmatter(entity: Entity): string {
  return [
    '---',
    `title: "${entity.name}"`,
    `status: ${entity.properties.status || '草稿'}`,
    `wordCount: ${entity.properties.wordCount || 0}`,
    `createdAt: ${entity.createdAt}`,
    '---',
    '',
  ].join('\n')
}

/** notebook md 导出正文（原文直出，零转换；含 frontmatter 时前置） */
function notebookMarkdownBody(entity: Entity, includeFrontmatter: boolean): string {
  const raw = (entity.properties.content as string) || ''
  return includeFrontmatter ? chapterFrontmatter(entity) + raw : raw
}

async function htmlToMarkdown(html: string, includeFrontmatter: boolean, entity: Entity): Promise<string> {
  // manuscript 路径（HTML→md，Turndown）；notebook 走 md 原文直出（见 exportChapter）
  const { default: TurndownService } = await import('turndown')
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
  })
  const md = turndown.turndown(html)
  return includeFrontmatter ? chapterFrontmatter(entity) + md : md
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
    // 2026-10-24（13-A）：docx 链已下沉到应用级共享目录，manuscript 与 outline 共用
    import('@/composables/docx/htmlToDocxBlocks'),
    import('@/composables/docx/blocksToDocx'),
  ])
  // 资产图片预处理（2026-09-14 目录化）：正文里 convertFileSrc 绝对 URL 换回
  // data URL 再进纯函数链（IR/映射层仍只认 data URL，零改动）；读取失败的
  // src 原样保留 → 映射层显式占位降级。
  const { resolveAssetImagesInHtml } = await import('@/composables/imageAssets')
  const resolved = await resolveAssetImagesInHtml(html)
  const fontStore = useFontStore()
  const exportFont = fontStore.prefs.preview.family || fontStore.prefs.content.family || 'Microsoft YaHei'
  const blocks = htmlToBlocks(resolved)
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
    const { md: mdSource, html } = resolveContent(entity)
    const isNotebook = entity.type === 'notebook'
    const title = entity.name
    const safeName = title.replace(/[/\\?%*:|"<>]/g, '_')

    switch (format) {
      case 'txt': {
        // notebook：md 剥标记 → 纯文本；manuscript：HTML 剥标签（现状）
        const body = isNotebook ? markdownToPlainText(mdSource) : htmlToText(html, false, '')
        const text = (options.includeTitle !== false && title) ? `${title}\n\n${body}` : body
        downloadText(text, `${safeName}.txt`)
        break
      }
      case 'md': {
        // notebook：md 原文直出（零转换）；manuscript：Turndown（现状）
        const md = isNotebook
          ? notebookMarkdownBody(entity, options.includeFrontmatter !== false)
          : await htmlToMarkdown(html, options.includeFrontmatter !== false, entity)
        downloadText(md, `${safeName}.md`, 'text/markdown')
        break
      }
      case 'docx': {
        // html 已由 resolveContent 分流备好（notebook：md→HTML 渲染链；manuscript：原 HTML）
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
      // html 由 resolveContent 分流（notebook：md→HTML；manuscript：原 HTML）
      const allHtml = entities.map(e => `<h1>${e.name}</h1>${resolveContent(e).html}`).join('<hr/>')
      const blob = await htmlToDocx(allHtml, '全部章节')
      downloadBlob(blob, '全部章节.docx')
    } else if (format === 'md') {
      const parts: string[] = []
      for (const e of entities) {
        const body = e.type === 'notebook'
          ? notebookMarkdownBody(e, options.includeFrontmatter !== false)
          : await htmlToMarkdown(resolveContent(e).html, options.includeFrontmatter !== false, e)
        parts.push(body)
        parts.push('\n---\n')
      }
      downloadText(parts.join('\n'), '全部章节.md', 'text/markdown')
    } else {
      const parts: string[] = []
      for (const e of entities) {
        const body = e.type === 'notebook'
          ? markdownToPlainText((e.properties.content as string) || '')
          : htmlToText(resolveContent(e).html, false, '')
        parts.push((e.name ? `${e.name}\n\n` : '') + body)
        parts.push('---')
      }
      downloadText(parts.join('\n\n'), '全部章节.txt')
    }
  }

  /**
   * 整书合并导出（2026-09-14 书籍实体迭代）：与 exportMultiple 的区别——
   * 文件名与文档标题 = 书名（非固定「全部章节」）；md 为**书级** frontmatter
   * （书名/简介/章节数/总字数），章节只留一级标题，不再逐章塞 frontmatter。
   * docx 复用 htmlToDocx（title=书名 → buildDocxBlob 文档标题），章节结构同
   * exportMultiple（h1 + hr 分隔）。图片资产预处理在 htmlToDocx 内统一做。
   */
  async function exportBook(
    book: Entity,
    chapters: Entity[],
    format: 'txt' | 'md' | 'docx',
    options: { includeTitle?: boolean; includeFrontmatter?: boolean } = {}
  ) {
    const bookName = book.name
    const safeName = bookName.replace(/[/\\?%*:|"<>]/g, '_')
    const totalWords = chapters.reduce((s, e) => s + ((e.properties.wordCount as number) || 0), 0)

    switch (format) {
      case 'docx': {
        // html 由 resolveContent 分流（notebook：md→HTML；manuscript：原 HTML）
        const allHtml = chapters.map(e => `<h1>${e.name}</h1>${resolveContent(e).html}`).join('<hr/>')
        const blob = await htmlToDocx(allHtml, bookName, options.includeTitle !== false)
        downloadBlob(blob, `${safeName}.docx`)
        break
      }
      case 'md': {
        const parts: string[] = []
        if (options.includeFrontmatter !== false) {
          parts.push([
            '---',
            `title: "${bookName}"`,
            `description: "${(book.description || '').replace(/"/g, '\\"')}"`,
            `chapters: ${chapters.length}`,
            `totalWords: ${totalWords}`,
            `exportedAt: ${new Date().toISOString()}`,
            '---',
            '',
          ].join('\n'))
        }
        for (const e of chapters) {
          const body = e.type === 'notebook'
            ? (e.properties.content as string) || ''
            : await htmlToMarkdown(resolveContent(e).html, false, e)
          parts.push(`# ${e.name}\n\n${body}`)
        }
        downloadText(parts.join('\n\n'), `${safeName}.md`, 'text/markdown')
        break
      }
      default: {
        const parts: string[] = [bookName, '']
        for (const e of chapters) {
          const body = e.type === 'notebook'
            ? markdownToPlainText((e.properties.content as string) || '')
            : htmlToText(resolveContent(e).html, false, '')
          parts.push(`${e.name}\n\n${body}`)
          parts.push('---')
        }
        downloadText(parts.join('\n\n'), `${safeName}.txt`)
      }
    }
  }

  return { exportChapter, exportMultiple, exportBook }
}

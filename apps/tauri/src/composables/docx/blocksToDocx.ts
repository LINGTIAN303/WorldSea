/**
 * blocksToDocx —— docx 导出映射层：块级 IR（见 `htmlToDocxBlocks.ts`）→ docx 库对象 → Blob
 *
 * 拆层理由：docx 库对象是带私有字段的类实例，构造后**无法断言其内容** ——
 * 所以测试策略是「IR 层逐条断言 + 本层只做一次端到端冒烟（Packer.toBuffer 验 ZIP 签名）」。
 * 本文件静态 import docx（由 manuscript / outline 导出侧动态 import 本模块触发，保持 docx 懒加载）。
 *
 * docx API 版本：9.7.1（d.ts 逐一核对过：Paragraph.heading/bullet/numbering/thematicBreak、
 * TextRun.break=换行数、TableCell.columnSpan/rowSpan、LevelFormat.DECIMAL 等）。
 *
 * 排版决策（Word 文档是独立产物，不继承应用主题令牌，故用中性灰硬编码）：
 * - 引用块：左缩进 720 twip + 文字 #595959
 * - 行内/块级代码：Consolas + #F2F2F2 底纹
 * - 表头：加粗 + #EFEFEF 底纹；表格边框统一 #999999 0.5pt
 * - 有序列表：每个 `<ol>` 一个 numbering reference（独立从 1 续号）；嵌套层级封顶 3 级
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
  type INumberingOptions,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx'
import type { DocxBlock, DocxRun } from './htmlToDocxBlocks'
import { parseDataUrl, decodeBase64, mimeToDocxType, readImageSize } from './imageData'

export interface DocxBuildOptions {
  /** 文档标题（一级标题置顶；传空串则不生成标题段） */
  title: string
  /** 正文/标题统一字体（来自字体偏好），如 'Microsoft YaHei' */
  defaultFont?: string
  /** 正文字号，half-point（docx 惯例），默认 24 = 12pt */
  bodySize?: number
}

const MAX_BULLET_LEVEL = 8
const MAX_ORDERED_LEVEL = 2

/** 代码/底纹用灰（Word 独立产物，硬编码中性色） */
const CODE_FILL = 'F2F2F2'
const HEADER_FILL = 'EFEFEF'
const QUOTE_COLOR = '595959'
const BORDER_COLOR = '999999'

function tableBorder(): IBorderOptions {
  return { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR }
}

interface RunBase {
  font?: string
  /** half-point；undefined = 不指定（交给 Word 内建样式，如标题） */
  size?: number
  color?: string
  /** 表头单元格整格加粗 */
  bold?: boolean
}

/** IR run → docx TextRun（处理 '\n' 拆分为换行） */
function toRuns(runs: DocxRun[], base: RunBase): TextRun[] {
  const out: TextRun[] = []
  for (const run of runs) {
    const props: Omit<IRunOptions, 'text' | 'break'> = {
      ...(run.bold || base.bold ? { bold: true } : {}),
      ...(run.italics ? { italics: true } : {}),
      ...(run.underline ? { underline: {} } : {}),
      ...(run.strike ? { strike: true } : {}),
      font: run.code ? 'Consolas' : base.font,
      ...(base.size !== undefined ? { size: base.size } : {}),
      ...(base.color ? { color: base.color } : {}),
      ...(run.code ? { shading: { fill: CODE_FILL, type: ShadingType.CLEAR } } : {}),
    }
    const segments = run.text.split('\n')
    segments.forEach((seg, i) => {
      out.push(new TextRun({ ...props, ...(i > 0 ? { break: 1 } : {}), text: seg }))
    })
  }
  return out
}

/** 有序列表的 numbering reference（每个 ol 实例独立） */
function orderedRef(listId: number): string {
  return `ws-ol-${listId}`
}

// ── 图片块（三期前置：编辑器已接 Image 扩展，正文可含 data URL 图片）──

/** Word 正文可用宽度约 600px（A4 + 1in 边距 @96dpi），超高图（长截图）限 820 */
const IMAGE_MAX_WIDTH = 600
const IMAGE_MAX_HEIGHT = 820

/** 等比 clamp 到页面可用范围；退化保底 ≥1px（0 尺寸图片 Word 会拒开） */
function clampImageDims(dims: { width: number; height: number }): { width: number; height: number } {
  let { width, height } = dims
  if (!Number.isFinite(width) || width < 1) width = 1
  if (!Number.isFinite(height) || height < 1) height = 1
  const scale = Math.min(1, IMAGE_MAX_WIDTH / width, IMAGE_MAX_HEIGHT / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function placeholderParagraph(text: string, base: RunBase): Paragraph {
  return new Paragraph({
    children: [new TextRun({
      text,
      italics: true,
      color: '808080',
      font: base.font,
      ...(base.size !== undefined ? { size: base.size } : {}),
    })],
    spacing: { after: 120 },
  })
}

/**
 * image 块 → 图片段落 / 占位段落。
 * 三类降级（全部**显式占位**，不留静默丢失）：
 * - 非 data URL（外部 http 图）→ 导出器不做网络 IO，占位注明来源
 * - webp / svg 等 Word 不支持的格式 → 占位注明
 * - base64 损坏 → 占位注明
 */
function imageBlockToDocx(block: Extract<DocxBlock, { kind: 'image' }>, base: RunBase): (Paragraph | Table)[] {
  const parsed = parseDataUrl(block.src)
  if (!parsed) {
    return [placeholderParagraph(`（外部图片未嵌入导出：${block.src.slice(0, 80)}${block.src.length > 80 ? '…' : ''}）`, base)]
  }
  const type = mimeToDocxType(parsed.mime)
  if (!type) {
    return [placeholderParagraph(`（图片格式 ${parsed.mime} 不被 Word 支持，未嵌入）`, base)]
  }
  try {
    const bytes = decodeBase64(parsed.base64)
    // 尺寸优先级（块 1 阶段 3 起）：① IR 透传（编辑器拖拽落库的 width/height——用户意图）；
    // ② 图片头读数（无变形）；③ 默认 480×320（exotic 编码/损坏——比例可能不准，但比
    // 「整个图片因缺 transformation 而无法生成」可取）
    const fromIr = block.width && block.height ? { width: block.width, height: block.height } : null
    const dims = fromIr ?? readImageSize(bytes, parsed.mime) ?? { width: 480, height: 320 }
    const { width, height } = clampImageDims(dims)
    return [new Paragraph({
      children: [new ImageRun({ type, data: bytes, transformation: { width, height } })],
      spacing: { after: 120 },
    })]
  } catch {
    return [placeholderParagraph('（图片数据损坏，未能嵌入）', base)]
  }
}

/** 收集全部有序列表 listId → Document.numbering 配置 */
function numberingConfig(blocks: DocxBlock[]): INumberingOptions | undefined {
  const ids = new Set<number>()
  for (const b of blocks) {
    if (b.kind === 'listItem' && b.ordered) ids.add(b.listId)
  }
  if (ids.size === 0) return undefined
  return {
    config: Array.from(ids).map(listId => ({
      reference: orderedRef(listId),
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.START },
        { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.START },
      ],
    })),
  }
}

function blockToDocx(block: DocxBlock, base: RunBase): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'heading':
      return [new Paragraph({
        heading: (HeadingLevel as Record<string, string>)[`HEADING_${block.level}`] as IParagraphOptions['heading'],
        children: toRuns(block.runs, base),
      })]
    case 'paragraph':
      return [new Paragraph({
        children: toRuns(block.runs, block.quote ? { ...base, color: QUOTE_COLOR } : base),
        ...(block.quote ? { indent: { left: 720 } } : {}),
        spacing: { after: 120 },
      })]
    case 'listItem':
      return [new Paragraph({
        children: toRuns(block.runs, base),
        ...(block.ordered
          ? { numbering: { reference: orderedRef(block.listId), level: Math.min(block.level, MAX_ORDERED_LEVEL) } }
          : { bullet: { level: Math.min(block.level, MAX_BULLET_LEVEL) } }),
        spacing: { after: 60 },
        contextualSpacing: true,
      })]
    case 'code':
      return block.lines.map(line => new Paragraph({
        children: [new TextRun({ text: line.length ? line : ' ', font: 'Consolas', ...(base.size !== undefined ? { size: base.size } : {}) })],
        shading: { fill: CODE_FILL, type: ShadingType.CLEAR },
        spacing: { after: 0 },
      }))
    case 'hr':
      return [new Paragraph({ thematicBreak: true })]
    case 'image':
      return imageBlockToDocx(block, base)
    case 'table': {
      const border = tableBorder()
      const borders = {
        top: border, bottom: border, left: border, right: border,
        insideHorizontal: border, insideVertical: border,
      }
      const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders,
        rows: block.rows.map(row => new TableRow({
          children: row.cells.map(cell => new TableCell({
            children: [new Paragraph({ children: toRuns(cell.runs, { ...base, bold: cell.header }) })],
            ...(cell.header ? { shading: { fill: HEADER_FILL, type: ShadingType.CLEAR } } : {}),
            ...(cell.columnSpan ? { columnSpan: cell.columnSpan } : {}),
            ...(cell.rowSpan ? { rowSpan: cell.rowSpan } : {}),
          })),
        })),
      })
      return [table]
    }
  }
}

/** IR → docx Document（不落盘；测试用它走 Packer.toBuffer 做冒烟） */
export function buildDocument(blocks: DocxBlock[], opts: DocxBuildOptions): Document {
  const base: RunBase = {
    font: opts.defaultFont,
    size: opts.bodySize ?? 24,
  }
  const children: (Paragraph | Table)[] = []
  if (opts.title) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
      children: toRuns([{ text: opts.title }], { font: opts.defaultFont }),
    }))
  }
  for (const block of blocks) children.push(...blockToDocx(block, base))
  const numbering = numberingConfig(blocks)
  return new Document({
    sections: [{ children }],
    ...(numbering ? { numbering } : {}),
  })
}

/** 装配并打包为 .docx Blob（浏览器下载用） */
export async function buildDocxBlob(blocks: DocxBlock[], opts: DocxBuildOptions): Promise<Blob> {
  const doc = buildDocument(blocks, opts)
  return Packer.toBlob(doc)
}

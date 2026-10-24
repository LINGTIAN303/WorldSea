/**
 * docx 导出转换链路测试
 *
 * 两层分别验证：
 * 1. `htmlToDocxBlocks`（HTML → IR）：jsdom DOMParser 逐条断言块/行内/列表/表格语义
 * 2. `blocksToDocx`（IR → docx）：docx 类实例无法内省，故走**真实打包** ——
 *    Packer.toBuffer 拿到产物后用 jszip 解包，直接断言 document.xml / numbering.xml 内容
 */
import { describe, it, expect } from 'vitest'
import { htmlToBlocks, normalizeRuns, type DocxBlock, type DocxRun } from '../htmlToDocxBlocks'
import { parseDataUrl, decodeBase64, mimeToDocxType, readImageSize } from '../imageData'

function texts(runs: DocxRun[]): string[] {
  return runs.map(r => r.text)
}

describe('htmlToDocxBlocks · HTML → IR', () => {
  it('空串 / 纯空白 → []', () => {
    expect(htmlToBlocks('')).toEqual([])
    expect(htmlToBlocks('   \n\t ')).toEqual([])
  })

  it('h1~h3 → heading 层级正确', () => {
    const blocks = htmlToBlocks('<h1>大标题</h1><h2>节</h2><h3>小节</h3>')
    expect(blocks.map(b => (b as { kind: string }).kind)).toEqual(['heading', 'heading', 'heading'])
    expect(blocks.map(b => (b as { level: number }).level)).toEqual([1, 2, 3])
    expect(texts((blocks[0] as { runs: DocxRun[] }).runs)).toEqual(['大标题'])
  })

  it('行内标记：strong/em/u/s/code', () => {
    const blocks = htmlToBlocks('<p><strong>粗</strong><em>斜</em><u>下</u><s>删</s><code>码</code>常</p>')
    const runs = (blocks[0] as { runs: DocxRun[] }).runs
    expect(runs).toEqual([
      { text: '粗', bold: true },
      { text: '斜', italics: true },
      { text: '下', underline: true },
      { text: '删', strike: true },
      { text: '码', code: true },
      { text: '常' },
    ])
  })

  it('空白折叠与首尾修剪', () => {
    const blocks = htmlToBlocks('<p>  Hello   world  </p>')
    expect((blocks[0] as { runs: DocxRun[] }).runs).toEqual([{ text: 'Hello world' }])
  })

  it('跨元素的同格式文本合并为一段（b+b）', () => {
    const blocks = htmlToBlocks('<p><b>a</b><b>b</b></p>')
    expect((blocks[0] as { runs: DocxRun[] }).runs).toEqual([{ text: 'ab', bold: true }])
  })

  it('br → 换行标记', () => {
    const blocks = htmlToBlocks('<p>第一行<br>第二行</p>')
    expect(texts((blocks[0] as { runs: DocxRun[] }).runs)).toEqual(['第一行', '\n', '第二行'])
  })

  it('嵌套无序列表：层级 0/1，内外层各自成列表', () => {
    const blocks = htmlToBlocks('<ul><li>顶级<ul><li>次级</li></ul></li><li>第二项</li></ul>')
    const items = blocks.filter((b): b is Extract<DocxBlock, { kind: 'listItem' }> => b.kind === 'listItem')
    expect(items).toHaveLength(3)
    expect(items.map(i => i.level)).toEqual([0, 1, 0])
    expect(items.every(i => !i.ordered)).toBe(true)
    // 顶层两项同属外层 ul（同 listId）；嵌套项属于内层 ul（不同 listId）——
    // 无序场景 listId 不影响编号，但这是「每个列表元素一个实例」语义的直接断言
    expect(items[0].listId).toBe(items[2].listId)
    expect(items[1].listId).not.toBe(items[0].listId)
    expect(texts(items[0].runs)).toEqual(['顶级'])
    expect(texts(items[1].runs)).toEqual(['次级'])
  })

  it('两个有序列表 → 不同 listId（docx 独立续号的前提）', () => {
    const blocks = htmlToBlocks('<ol><li>甲</li></ol><p>间隔</p><ol><li>乙</li></ol>')
    const items = blocks.filter((b): b is Extract<DocxBlock, { kind: 'listItem' }> => b.kind === 'listItem')
    expect(items).toHaveLength(2)
    expect(items[0].ordered).toBe(true)
    expect(items[0].listId).not.toBe(items[1].listId)
  })

  it('blockquote 内的 p → quote 标记', () => {
    const blocks = htmlToBlocks('<blockquote><p>引一</p><p>引二</p></blockquote>')
    expect(blocks).toHaveLength(2)
    expect(blocks.every(b => b.kind === 'paragraph' && (b as { quote?: boolean }).quote === true)).toBe(true)
  })

  it('pre → code 块，保留换行', () => {
    const blocks = htmlToBlocks('<pre><code>line1\nline2</code></pre>')
    expect(blocks).toEqual([{ kind: 'code', lines: ['line1', 'line2'] }])
  })

  it('hr → { kind: hr }', () => {
    expect(htmlToBlocks('<p>a</p><hr><p>b</p>')).toContainEqual({ kind: 'hr' })
  })

  it('表格：thead/th 表头 + colspan + 行内标记不被吞', () => {
    const blocks = htmlToBlocks(
      '<table><thead><tr><th colspan="2">表头</th></tr></thead>' +
      '<tbody><tr><td><strong>甲</strong></td><td>乙</td></tr></tbody></table>',
    )
    const table = blocks[0] as Extract<DocxBlock, { kind: 'table' }>
    expect(table.kind).toBe('table')
    expect(table.rows).toHaveLength(2)
    const [header, dataRow] = table.rows
    expect(header.cells[0]).toMatchObject({ header: true, columnSpan: 2 })
    expect(texts(header.cells[0].runs)).toEqual(['表头'])
    expect(dataRow.cells[0]).toMatchObject({ header: false })
    expect((dataRow.cells[0].runs[0] as DocxRun).bold).toBe(true)
  })

  it('嵌套表的行不会被外层表吞走（:scope 限定）', () => {
    const blocks = htmlToBlocks(
      '<table><tbody><tr><td>外<a-table></a-table>格</td></tr></tbody></table>'
        .replace('<a-table></a-table>', '<table><tbody><tr><td>内</td></tr></tbody></table>'),
    )
    const outer = blocks[0] as Extract<DocxBlock, { kind: 'table' }>
    expect(outer.rows).toHaveLength(1)
    // 外层单元格里的嵌套表作为其内容被行内收集为空（table 非 inline），文字保留
    expect(texts(outer.rows[0].cells[0].runs).join('')).toContain('外')
    expect(texts(outer.rows[0].cells[0].runs).join('')).toContain('格')
  })

  it('mention span（nb-mention / ms-mention）按普通行内文本保留', () => {
    const blocks = htmlToBlocks('<p>提及 <span class="nb-mention" data-id="e1">@灰烬之刃</span> 一下</p>')
    expect(texts((blocks[0] as { runs: DocxRun[] }).runs).join('')).toContain('@灰烬之刃')
  })

  it('exportMultiple 拼接形态（h1 + hr + p）完整解析', () => {
    const html = '<h1>第一章</h1><p>内容一</p><hr><h1>第二章</h1><p>内容二</p>'
    const blocks = htmlToBlocks(html)
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'paragraph', 'hr', 'heading', 'paragraph'])
  })

  it('行内 img（p 内，非 Image 扩展产物）丢弃，不影响前后文本', () => {
    const blocks = htmlToBlocks('<p>前<img src="x.png" alt="图">后</p>')
    expect(texts((blocks[0] as { runs: DocxRun[] }).runs).join('')).toBe('前后')
  })

  it('块级 img（Image 扩展产物）→ image 块，保留 src/alt', () => {
    const blocks = htmlToBlocks('<p>前</p><img src="data:image/png;base64,AAAA" alt="截图"><p>后</p>')
    expect(blocks).toHaveLength(3)
    expect(blocks[1]).toEqual({ kind: 'image', src: 'data:image/png;base64,AAAA', alt: '截图' })
  })

  it('img 尺寸透传（块 1 阶段 3）：width/height 数字属性进 IR；非法值不产字段', () => {
    const withSize = htmlToBlocks('<img src="data:image/png;base64,AAAA" width="300" height="200">')
    expect(withSize[0]).toEqual({
      kind: 'image', src: 'data:image/png;base64,AAAA', width: 300, height: 200,
    })
    const badSize = htmlToBlocks('<img src="data:image/png;base64,AAAA" width="abc">')
    expect(badSize[0]).toEqual({ kind: 'image', src: 'data:image/png;base64,AAAA' })
  })

  it('无 src 的 img 不产块', () => {
    expect(htmlToBlocks('<img alt="空">')).toEqual([])
  })

  it('块级散落文本 → 段落兜底', () => {
    const blocks = htmlToBlocks('裸文本')
    expect(blocks).toEqual([{ kind: 'paragraph', runs: [{ text: '裸文本' }] }])
  })

  it('normalizeRuns：丢弃空片段但保留换行标记', () => {
    expect(normalizeRuns([{ text: ' ' }, { text: 'a', bold: true }, { text: '' }])).toEqual([{ text: 'a', bold: true }])
    expect(normalizeRuns([{ text: 'a' }, { text: '\n' }, { text: 'b' }])).toEqual([
      { text: 'a' }, { text: '\n' }, { text: 'b' },
    ])
  })
})

describe('imageData · data URL 解析与图片头尺寸', () => {
  it('parseDataUrl：合法解析；http URL / 非 base64 → null', () => {
    expect(parseDataUrl('data:image/png;base64,QUJD')).toEqual({ mime: 'image/png', base64: 'QUJD' })
    expect(parseDataUrl('https://example.com/a.png')).toBeNull()
    expect(parseDataUrl('data:image/svg+xml,%3Csvg%3E')).toBeNull()
  })

  it('mimeToDocxType：png/jpeg/gif/bmp 映射，webp/svg 拒绝', () => {
    expect(mimeToDocxType('image/png')).toBe('png')
    expect(mimeToDocxType('image/jpeg')).toBe('jpg')
    expect(mimeToDocxType('image/gif')).toBe('gif')
    expect(mimeToDocxType('image/bmp')).toBe('bmp')
    expect(mimeToDocxType('image/webp')).toBeNull()
    expect(mimeToDocxType('image/svg+xml')).toBeNull()
  })

  it('decodeBase64：标准 base64 → 字节', () => {
    // 'QUJD' = 'ABC'
    expect(Array.from(decodeBase64('QUJD'))).toEqual([0x41, 0x42, 0x43])
  })

  /** 构造带 IHDR 宽高的最小 PNG 头（33 字节，足以读尺寸；docx 不校验图片完整性） */
  function makePngBytes(width: number, height: number): Uint8Array {
    const b = new Uint8Array(33)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    b.set([0, 0, 0, 13], 8)
    b.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
    const be32 = (v: number, o: number) => { b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff; b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff }
    be32(width, 16)
    be32(height, 20)
    return b
  }

  it('PNG 头：IHDR 大端宽高', () => {
    const dims = readImageSize(makePngBytes(1280, 720), 'image/png')
    expect(dims).toEqual({ width: 1280, height: 720 })
  })

  it('GIF 头：小端宽高', () => {
    const b = new Uint8Array(24)
    b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0) // 'GIF89a'
    b.set([0x40, 0x01, 0xf0, 0x00], 6) // 320 x 240 (LE)
    expect(readImageSize(b, 'image/gif')).toEqual({ width: 320, height: 240 })
  })

  it('BMP 头：DIB 偏移 18/22，负高取绝对值', () => {
    const b = new Uint8Array(40)
    b.set([0x42, 0x4d], 0) // 'BM'
    const le32 = (v: number, o: number) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff }
    le32(100, 18)
    le32(-50, 22) // top-down 行序
    expect(readImageSize(b, 'image/bmp')).toEqual({ width: 100, height: 50 })
  })

  it('JPEG：SOF0 前有 APP0 段，逐段跳过后命中', () => {
    const b = new Uint8Array(48)
    b.set([0xff, 0xd8], 0) // SOI
    b.set([0xff, 0xe0, 0x00, 0x10], 2) // APP0，段长 16（含自身 2 字节）
    b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20) // SOF0：len 17、精度 8
    b.set([0x02, 0xd0], 25) // height 720
    b.set([0x05, 0x00], 27) // width 1280
    expect(readImageSize(b, 'image/jpeg')).toEqual({ width: 1280, height: 720 })
  })

  it('未知 mime / 短字节流 → null（调用方走 fallback）', () => {
    expect(readImageSize(makePngBytes(10, 10), 'image/webp')).toBeNull()
    expect(readImageSize(new Uint8Array(8), 'image/png')).toBeNull()
  })
})

describe('blocksToDocx · 真实打包冒烟（jszip 解包断言）', () => {
  it('标题/样式/字体/表格/有序列表 numbering 全部落进产物', async () => {
    const { buildDocument } = await import('../blocksToDocx')
    const { Packer } = await import('docx')
    const JSZip = (await import('jszip')).default

    const blocks = htmlToBlocks(
      '<h2>章标题</h2><p><strong>粗体</strong>正文</p>' +
      '<blockquote><p>引言</p></blockquote>' +
      '<ol><li>第一</li><li>第二</li></ol>' +
      '<table><tbody><tr><th>列甲</th><th>列乙</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>' +
      '<hr>',
    )
    const doc = buildDocument(blocks, { title: '导出冒烟', defaultFont: 'Microsoft YaHei' })
    const buffer = await Packer.toBuffer(doc)

    // ZIP 签名（Packer.toBuffer 成功的最基本判据）
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer[0]).toBe(0x50) // 'P'
    expect(buffer[1]).toBe(0x4b) // 'K'

    const zip = await JSZip.loadAsync(buffer)
    const docXml = await zip.file('word/document.xml')!.async('string')
    expect(docXml).toContain('Heading1') // 文档标题
    expect(docXml).toContain('Heading2') // 章标题
    expect(docXml).toContain('Microsoft YaHei') // 字体偏好生效
    expect(docXml).toContain('595959') // 引用块灰色
    expect(docXml).toContain('<w:tbl>') // 表格真实存在
    // OOXML 的编号引用是数字 numId 间接映射，reference 字符串不进 document.xml ——
    // 断言段落级编号标记 + numbering.xml 里的十进制格式定义
    expect(docXml).toContain('<w:numPr>')
    const numberingXml = await zip.file('word/numbering.xml')!.async('string')
    expect(numberingXml).toContain('w:val="decimal"')
  })

  it('无有序列表时 numbering.xml 只含内建定义、正文无编号引用', async () => {
    const { buildDocument } = await import('../blocksToDocx')
    const { Packer } = await import('docx')
    const JSZip = (await import('jszip')).default

    const doc = buildDocument(htmlToBlocks('<p>无列表</p>'), { title: 'T' })
    const buffer = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buffer)
    // docx v9 恒产出 numbering.xml（内建 bullet 定义），判据改为「无自定义十进制格式」
    const docXml = await zip.file('word/document.xml')!.async('string')
    expect(docXml).not.toContain('<w:numPr>')
    const numberingXml = await zip.file('word/numbering.xml')!.async('string')
    expect(numberingXml).not.toContain('w:val="decimal"')
  })

  it('image 块：PNG data URL 嵌入为 drawing；webp / 外部 URL 走显式占位', async () => {
    const { buildDocument } = await import('../blocksToDocx')
    const { Packer } = await import('docx')
    const JSZip = (await import('jszip')).default

    // 最小 PNG 头（8 签名 + IHDR + 1280x720 大端宽高）—— docx 只打包不校验图片完整性
    const bytes = new Uint8Array(33)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0, 0, 0, 13], 8)
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    const be32 = (v: number, o: number) => { bytes[o] = (v >>> 24) & 0xff; bytes[o + 1] = (v >>> 16) & 0xff; bytes[o + 2] = (v >>> 8) & 0xff; bytes[o + 3] = v & 0xff }
    be32(1280, 16)
    be32(720, 20)
    let bin = ''
    bytes.forEach(x => { bin += String.fromCharCode(x) })
    const pngSrc = 'data:image/png;base64,' + btoa(bin)

    const doc = buildDocument(
      htmlToBlocks(`<p>图前</p><img src="${pngSrc}" alt="截图"><img src="data:image/webp;base64,QUJD"><img src="https://example.com/a.png"><p>图后</p>`),
      { title: '' },
    )
    const buffer = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buffer)
    const docXml = await zip.file('word/document.xml')!.async('string')
    expect(docXml).toContain('<w:drawing>') // PNG 真实嵌入
    expect(docXml).toContain('image/webp 不被 Word 支持') // webp 显式占位
    expect(docXml).toContain('外部图片未嵌入导出') // http 图显式占位
    // PNG 数据进了 media（排除 `word/media/` 目录条目本身 —— zip.files 含目录项）
    const media = Object.keys(zip.files).filter(n => n.startsWith('word/media/') && !n.endsWith('/'))
    expect(media.length).toBe(1)
    expect(media[0]).toMatch(/\.png$/)
  })
})

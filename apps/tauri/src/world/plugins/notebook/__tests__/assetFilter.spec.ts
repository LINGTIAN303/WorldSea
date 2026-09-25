import { describe, it, expect } from 'vitest'
import { isSupportedAsset, fileExt } from '../assetFilter'

describe('fileExt', () => {
  it('取小写扩展名（多段文件名取最后一段）', () => {
    expect(fileExt('a.PNG')).toBe('png')
    expect(fileExt('设定.灰烬之刃.docx')).toBe('docx')
  })

  it('点前缀名 / 无扩展名返回空串', () => {
    expect(fileExt('.gitignore')).toBe('')
    expect(fileExt('README')).toBe('')
    expect(fileExt('')).toBe('')
  })
})

describe('isSupportedAsset', () => {
  it('图片扩展名命中（与 FilePreview IMAGE_EXT 对齐）', () => {
    for (const n of ['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.svg']) {
      expect(isSupportedAsset(n), n).toBe(true)
    }
  })

  it('四渲染器文档命中（ppt 走 LibreOffice 转换链，与 PPTX_EXT 对齐）', () => {
    for (const n of ['a.docx', 'b.xlsx', 'c.pdf', 'd.pptx', 'e.ppt']) {
      expect(isSupportedAsset(n), n).toBe(true)
    }
  })

  it('大小写不敏感（中文名同样适用）', () => {
    expect(isSupportedAsset('IMG.PNG')).toBe(true)
    expect(isSupportedAsset('设定.DOCX')).toBe(true)
    expect(isSupportedAsset('地图.Pdf')).toBe(true)
  })

  it('不支持格式被过滤（文本 / 旧 office / 二进制 / 无扩展名）', () => {
    for (const n of ['a.md', 'b.txt', 'c.js', 'd.doc', 'e.xls', 'f.html', 'g.exe', 'h.zip', 'README']) {
      expect(isSupportedAsset(n), n).toBe(false)
    }
  })
})

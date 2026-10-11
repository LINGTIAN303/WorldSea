/**
 * imageAssets 单测（2026-09-14 图片资产目录化）
 *
 * 纯函数：isAssetSrc（asset URL 两平台形态 / data URL / 外链 / 相对路径的
 * 判定边界）· assetSrcToDiskPath（URL 解码还原）· mimeFromExt。
 * IO 编排：resolveAssetImagesInHtml（mock @tauri-apps/api/core 的 invoke ——
 * 资产 src 读盘换 data URL / 读取失败保留原样 / data URL 不动 / 无 img 直通）。
 * 孤儿清理 + rebase（2026-09-14 挂账落地）：collectAssetDiskPaths（JSON 文本
 * 扫描）/ findOrphanAssets（宽限期边界、反斜杠归一、mtime 未知不删）/
 * rebaseAssetSrcs（旧根重写、前缀边界、无关 src 直通）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  // convertFileSrc 真实形态：Windows = http://asset.localhost/<encodeURI(path)>
  convertFileSrc: (path: string) => `http://asset.localhost/${encodeURI(path).replace(/%5C/g, '/').replace(/%3A/g, ':')}`,
}))

import {
  isAssetSrc,
  assetSrcToDiskPath,
  mimeFromExt,
  resolveAssetImagesInHtml,
  collectAssetDiskPaths,
  findOrphanAssets,
  rebaseAssetSrcs,
} from '../imageAssets'

describe('isAssetSrc', () => {
  it('Windows 形态（http://asset.localhost/）命中', () => {
    expect(isAssetSrc('http://asset.localhost/D:/world/assets/img_1.png')).toBe(true)
  })
  it('macOS/Linux 形态（asset://localhost/）命中', () => {
    expect(isAssetSrc('asset://localhost/Users/x/assets/img_1.png')).toBe(true)
  })
  it('data URL / 外部 http / 相对路径 / 空串均不命中', () => {
    expect(isAssetSrc('data:image/png;base64,QUJD')).toBe(false)
    expect(isAssetSrc('https://example.com/a.png')).toBe(false)
    expect(isAssetSrc('assets/img_1.png')).toBe(false)
    expect(isAssetSrc('')).toBe(false)
  })
})

describe('assetSrcToDiskPath', () => {
  it('URL 解码还原（Windows 编码路径）', () => {
    // convertFileSrc 对 D:\world\assets\x.png 的编码产物（%5C 反斜杠保留编码）
    const src = 'http://asset.localhost/D%3A%5Cworld%5Cassets%5Cx.png'
    expect(assetSrcToDiskPath(src)).toBe('D:\\world\\assets\\x.png')
  })
  it('非资产 URL 返回 null', () => {
    expect(assetSrcToDiskPath('data:image/png;base64,QUJD')).toBeNull()
    expect(assetSrcToDiskPath('https://example.com/a.png')).toBeNull()
  })
})

describe('mimeFromExt', () => {
  it('六类图片扩展名 + 大小写不敏感', () => {
    expect(mimeFromExt('a.PNG')).toBe('image/png')
    expect(mimeFromExt('b.JpG')).toBe('image/jpeg')
    expect(mimeFromExt('c.gif')).toBe('image/gif')
    expect(mimeFromExt('d.webp')).toBe('image/webp')
    expect(mimeFromExt('e.bmp')).toBe('image/bmp')
    expect(mimeFromExt('f.svg')).toBe('image/svg+xml')
  })
  it('无扩展名 / 未知扩展名返回空串', () => {
    expect(mimeFromExt('noext')).toBe('')
    expect(mimeFromExt('a.exe')).toBe('')
  })
})

describe('resolveAssetImagesInHtml', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('资产 src 读盘后替换为 data URL（mime 按扩展名）', async () => {
    invokeMock.mockResolvedValue('QUJD')
    const src = 'http://asset.localhost/D%3A%5Cworld%5Cassets%5Cx.png'
    const html = `<p>前</p><img src="${src}" alt="图"><p>后</p>`

    const out = await resolveAssetImagesInHtml(html)

    expect(invokeMock).toHaveBeenCalledWith('cmd_fs_read', { path: 'D:\\world\\assets\\x.png', encoding: 'base64' })
    expect(out).toContain('data:image/png;base64,QUJD')
    expect(out).not.toContain('asset.localhost')
  })

  it('读取失败的资产 src 原样保留（导出层占位降级接管）', async () => {
    invokeMock.mockRejectedValue(new Error('No such file'))
    const src = 'http://asset.localhost/D%3A%5Cworld%5Cmissing.png'
    const html = `<img src="${src}" alt="丢">`

    const out = await resolveAssetImagesInHtml(html)

    expect(out).toBe(html)
  })

  it('data URL 与外部 http 图不动，只处理资产 src', async () => {
    const html = '<img src="data:image/gif;base64,R0lGOD" alt="a"><img src="https://x.com/b.png" alt="b">'
    const out = await resolveAssetImagesInHtml(html)
    expect(out).toBe(html)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('无 img / 空串直通', async () => {
    expect(await resolveAssetImagesInHtml('')).toBe('')
    expect(await resolveAssetImagesInHtml('<p>纯文本</p>')).toBe('<p>纯文本</p>')
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('collectAssetDiskPaths', () => {
  it('从 JSON 序列化文本提取资产磁盘路径（两平台形态、去重）', () => {
    const texts = [
      JSON.stringify({ content: '<img src="http://asset.localhost/D%3A%5Cworld%5Cassets%5Ca.png"><img src="http://asset.localhost/D%3A%5Cworld%5Cassets%5Ca.png">' }),
      // macOS 真实 convertFileSrc 产物：前导 / 也编码为 %2F（手写未编码形态会被前缀切片吃掉首斜杠）
      JSON.stringify({ content: '<img src="asset://localhost/%2FUsers%2Fx%2Fassets%2Fb.png">' }),
    ]
    const refs = collectAssetDiskPaths(texts)
    expect(refs.has('D:\\world\\assets\\a.png')).toBe(true)
    expect(refs.has('/Users/x/assets/b.png')).toBe(true)
    expect(refs.size).toBe(2)
  })

  it('data URL / 外链 / 纯文本 / 空串不产生引用', () => {
    const refs = collectAssetDiskPaths([
      '<img src="data:image/png;base64,QUJD">',
      '<img src="https://example.com/a.png">',
      '纯文本没有图',
      '',
    ])
    expect(refs.size).toBe(0)
  })
})

describe('findOrphanAssets', () => {
  const HOUR = 3600_000
  const NOW = 1_800_000_000_000
  const files = [
    { path: 'D:/world/assets/a.png', name: 'a.png', size: 10, modified: NOW - 25 * HOUR }, // 未引用 + 过宽限期 → 孤儿
    { path: 'D:/world/assets/b.png', name: 'b.png', size: 20, modified: NOW - 1 * HOUR },  // 未引用 + 宽限期内 → 保留
    { path: 'D:/world/assets/c.png', name: 'c.png', size: 30, modified: NOW - 48 * HOUR }, // 被引用 → 保留
    { path: 'D:/world/assets/d.png', name: 'd.png', size: 40 },                            // mtime 未知 → 保留
  ]

  it('未被引用且超过宽限期的文件判孤儿；其余保留', () => {
    const refs = collectAssetDiskPaths(['http://asset.localhost/D%3A%5Cworld%5Cassets%5Cc.png'])
    const orphans = findOrphanAssets(files, refs, NOW)
    expect(orphans.map((f) => f.name)).toEqual(['a.png'])
  })

  it('反斜杠 / 正斜杠混写不影响引用比对（统一归一）', () => {
    const orphans = findOrphanAssets(
      [{ path: 'D:/world/assets/a.png', name: 'a.png', size: 1, modified: NOW - 25 * HOUR }],
      ['D:\\world\\assets\\a.png'],
      NOW,
      24 * HOUR,
    )
    expect(orphans).toEqual([])
  })

  it('宽限期边界：mtime 恰等于 cutoff 判孤儿（<=）', () => {
    const orphans = findOrphanAssets(
      [{ path: 'D:/world/assets/e.png', name: 'e.png', size: 1, modified: NOW - 24 * HOUR }],
      [],
      NOW,
      24 * HOUR,
    )
    expect(orphans.map((f) => f.name)).toEqual(['e.png'])
  })
})

describe('rebaseAssetSrcs', () => {
  it('旧根下的资产 URL 重写到新根（保留平台前缀、新路径统一正斜杠）', () => {
    const html = '<p>x</p><img src="http://asset.localhost/D%3A%5Cworld%5Cassets%5Ca.png" alt="a">'
    const out = rebaseAssetSrcs(html, 'D:\\world', 'E:\\newworld')
    expect(out).toContain('http://asset.localhost/')
    const src = /src="([^"]+)"/.exec(out)![1]
    expect(isAssetSrc(src)).toBe(true)
    expect(assetSrcToDiskPath(src)).toBe('E:/newworld/assets/a.png')
  })

  it('macOS 前缀形态同样重写', () => {
    const html = '<img src="asset://localhost/%2FUsers%2Fold%2Fassets%2Fb.png">'
    const out = rebaseAssetSrcs(html, '/Users/old', '/Users/new')
    expect(out).toContain('asset://localhost/')
    const src = /src="([^"]+)"/.exec(out)![1]
    expect(assetSrcToDiskPath(src)).toBe('/Users/new/assets/b.png')
  })

  it('非旧根资产 / data URL / 外链不动；无 img 与新旧相同直通', () => {
    const otherRoot = '<img src="http://asset.localhost/D%3A%5Cother%5Ca.png">'
    expect(rebaseAssetSrcs(otherRoot, 'D:\\world', 'E:\\newworld')).toBe(otherRoot)
    const mixed = '<img src="data:image/png;base64,QQ=="><img src="https://x.com/b.png">'
    expect(rebaseAssetSrcs(mixed, 'D:\\world', 'E:\\x')).toBe(mixed)
    expect(rebaseAssetSrcs('<p>纯文本</p>', 'D:\\world', 'E:\\x')).toBe('<p>纯文本</p>')
    const same = '<img src="http://asset.localhost/D%3A%5Cworld%5Ca.png">'
    expect(rebaseAssetSrcs(same, 'D:/world', 'D:/world')).toBe(same)
  })

  it('前缀边界：worldfoo 不误判为 world 的子路径', () => {
    const html = '<img src="http://asset.localhost/D%3A%5Cworldfoo%5Ca.png">'
    expect(rebaseAssetSrcs(html, 'D:\\world', 'E:\\x')).toBe(html)
  })
})

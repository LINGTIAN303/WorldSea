/**
 * imageAssets 单测（2026-09-14 图片资产目录化）
 *
 * 纯函数：isAssetSrc（asset URL 两平台形态 / data URL / 外链 / 相对路径的
 * 判定边界）· assetSrcToDiskPath（URL 解码还原）· mimeFromExt。
 * IO 编排：resolveAssetImagesInHtml（mock @tauri-apps/api/core 的 invoke ——
 * 资产 src 读盘换 data URL / 读取失败保留原样 / data URL 不动 / 无 img 直通）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  // convertFileSrc 真实形态：Windows = http://asset.localhost/<encodeURI(path)>
  convertFileSrc: (path: string) => `http://asset.localhost/${encodeURI(path).replace(/%5C/g, '/').replace(/%3A/g, ':')}`,
}))

import { isAssetSrc, assetSrcToDiskPath, mimeFromExt, resolveAssetImagesInHtml } from '../imageAssets'

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

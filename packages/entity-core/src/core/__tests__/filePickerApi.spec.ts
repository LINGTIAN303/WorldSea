/**
 * FilePickerApi + pathToFile 单测：注册契约、未注册兜底、路径解析、MIME、上限拦截。
 * IO 走 mock 的 @tauri-apps/api/core（与 fileStorageBackendPaths.spec.ts 同法）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const files = new Map<string, { base64: string; size: number }>()
const reads: string[] = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    const path = String(args?.path ?? '')
    switch (cmd) {
      case 'cmd_fs_stat': {
        const entry = files.get(path.replace(/\\/g, '/'))
        if (!entry) throw new Error('not found')
        return { path, isDir: false, size: entry.size, mtime: null }
      }
      case 'cmd_fs_read': {
        const entry = files.get(path.replace(/\\/g, '/'))
        if (!entry) throw new Error('not found')
        reads.push(path)
        return entry.base64
      }
      default:
        throw new Error(`unexpected cmd ${cmd}`)
    }
  },
}))

const { registerFilePickerApi, getFilePickerApi, hasFilePicker } = await import('../FilePickerApi')
const { pathToFile, pathsToFiles, baseNameOf, mimeOf } = await import('../pathToFile')

/** 把字节登记到内存盘（key 归一正斜杠） */
function seed(path: string, bytes: number[], size = bytes.length): void {
  files.set(path.replace(/\\/g, '/'), {
    base64: btoa(String.fromCharCode(...bytes)),
    size,
  })
}

beforeEach(() => {
  files.clear()
  reads.length = 0
})

describe('FilePickerApi 注册契约', () => {
  it('未注册时 hasFilePicker 为 false，pick 静默返回 null', async () => {
    expect(hasFilePicker()).toBe(false)
    await expect(getFilePickerApi().pick({ mode: 'file' })).resolves.toBeNull()
  })

  it('注册后返回实现并原样转发请求', async () => {
    const seen: unknown[] = []
    registerFilePickerApi({
      async pick(req) {
        seen.push(req)
        return ['D:/picked/a.png']
      },
    })
    expect(hasFilePicker()).toBe(true)
    const req = { mode: 'file' as const, multiple: true, maxBytes: 1024 }
    await expect(getFilePickerApi().pick(req)).resolves.toEqual(['D:/picked/a.png'])
    expect(seen).toEqual([req])
  })

  it('用户取消（实现返回 null）不被吞成空数组', async () => {
    registerFilePickerApi({ async pick() { return null } })
    await expect(getFilePickerApi().pick({ mode: 'directory' })).resolves.toBeNull()
  })
})

describe('pathToFile 路径与 MIME', () => {
  it('baseNameOf 同时认正反斜杠且忽略尾分隔符', () => {
    expect(baseNameOf('D:/a/b/c.png')).toBe('c.png')
    expect(baseNameOf('D:\\a\\b\\c.png')).toBe('c.png')
    expect(baseNameOf('D:/a/b/')).toBe('b')
    expect(baseNameOf('c.png')).toBe('c.png')
  })

  it('mimeOf 按扩展名映射且未知归 octet-stream', () => {
    expect(mimeOf('x.PNG')).toBe('image/png')
    expect(mimeOf('x.svg')).toBe('image/svg+xml')
    expect(mimeOf('x.woff2')).toBe('font/woff2')
    expect(mimeOf('x.bin')).toBe('application/octet-stream')
    expect(mimeOf('noext')).toBe('application/octet-stream')
  })
})

describe('pathToFile 读盘', () => {
  it('成功时返回 File，名称取末段、类型按扩展名', async () => {
    seed('D:/tmp/pic.jpg', [1, 2, 3])
    const file = await pathToFile('D:/tmp/pic.jpg')
    expect(file).not.toBeNull()
    expect(file!.name).toBe('pic.jpg')
    expect(file!.type).toBe('image/jpeg')
    expect(file!.size).toBe(3)
  })

  it('超过 30MB base64 通道上限时返回 null 且不读盘', async () => {
    seed('D:/tmp/big.zip', [1], 31 * 1024 * 1024)
    const file = await pathToFile('D:/tmp/big.zip')
    expect(file).toBeNull()
    expect(reads).toEqual([])
  })

  it('文件不存在时返回 null 不抛错', async () => {
    await expect(pathToFile('D:/tmp/missing.png')).resolves.toBeNull()
  })
})

describe('pathsToFiles 批量', () => {
  it('成功的进 files、失败的进 skipped 并保持顺序', async () => {
    seed('D:/t/a.png', [1])
    seed('D:/t/c.png', [3])
    const { files, skipped } = await pathsToFiles(['D:/t/a.png', 'D:/t/b.png', 'D:/t/c.png'])
    expect(files.map(f => f.name)).toEqual(['a.png', 'c.png'])
    expect(skipped).toEqual(['D:/t/b.png'])
  })
})

describe('调用点接入契约（批 1）', () => {
  it('选择器返回空数组与 null 都按取消处理（不回退成空字符串路径）', async () => {
    registerFilePickerApi({ async pick() { return [] } })
    await expect(getFilePickerApi().pick({ mode: 'file' })).resolves.toEqual([])
    // 调用方取 [0] 得到 undefined，配合 `?? null` 归一为取消
    const paths = await getFilePickerApi().pick({ mode: 'file' })
    expect(paths?.[0] ?? null).toBeNull()
  })

  it('请求参数原样透传（filters / maxBytes 用于选择阶段拦截超限）', async () => {
    let captured: unknown = null
    registerFilePickerApi({ async pick(req) { captured = req; return ['D:/a.png'] } })
    const req = {
      mode: 'file' as const,
      multiple: false,
      title: '选择静态图片',
      filters: [{ name: '静态图片', extensions: ['png', 'jpg'] }],
      maxBytes: 10 * 1024 * 1024,
    }
    await getFilePickerApi().pick(req)
    expect(captured).toEqual(req)
  })
})

// FileStorageBackend 路径与就绪竞态守卫（2026-10-25 走查返工，形象图批 A 触发的两个存量 bug）：
// ① 写删自删：调用方 setProjectDir 传 Windows 反斜杠 → entityFilePath 拼出混合斜杠 newPath，
//    与 loadIndex 索引存的 Rust 反斜杠 path 字符串不等但物理同文件 → updateEntity「写新删旧」
//    删掉刚写的文件（真机实测：实体文件自删、靠后续写偶然救回）。修复 = 两侧归一正斜杠。
// ② boot 竞态分裂：isReady=false 窗口内写操作立即落 fallback（SQLite），与文件库分裂——
//    真机实测：portrait 进了 fallback、portraitKind/coverSource 落了文件，切换视图后字段消失。
//    修复 = 写路径先等 setProjectDir（ensureFileReady），超时才降级。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 内存文件系统：key 一律归一正斜杠；cmd_fs_list 返回 path 用反斜杠（模拟 Rust std::fs 真实形态——
// Bug ① 的复现前提）
const disk = new Map<string, string>()
const writes: string[] = []
const deletes: string[] = []
let fallbackUpdate: ReturnType<typeof vi.fn>

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => invokeImpl(cmd, args),
}))

const norm = (p: string) => p.replace(/\\/g, '/')

async function invokeImpl(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case 'cmd_fs_write':
      disk.set(norm(args.path as string), String(args.content))
      writes.push(norm(args.path as string))
      return null
    case 'cmd_fs_read': {
      const c = disk.get(norm(args.path as string))
      if (c === undefined) throw new Error('not found')
      return c
    }
    case 'cmd_fs_delete':
      disk.delete(norm(args.path as string))
      deletes.push(norm(args.path as string))
      return null
    case 'cmd_fs_list': {
      const dir = norm(args.path as string)
      const names = new Set<string>()
      for (const k of disk.keys()) {
        if (!k.startsWith(dir + '/')) continue
        names.add(k.slice(dir.length + 1).split('/')[0])
      }
      return [...names].map((n) => ({
        name: n,
        // 反斜杠形态：复刻 Rust 在 Windows 的输出（Bug ① 的老行为由此触发）
        path: `${dir.replace(/\//g, '\\')}\\${n}`,
        isDir: !n.includes('.'),
        size: 10,
      }))
    }
    default:
      throw new Error(`unexpected cmd ${cmd}`)
  }
}

const { FileStorageBackend } = await import('../FileStorageBackend')

const ENTITY = {
  id: '0a9cc6fe-95d5-4b07-a517-f92ea8b2ad07',
  type: 'character',
  name: '剑',
  description: '',
  properties: {},
  tags: [],
  createdAt: '2026-09-29T09:41:27.175Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
}
const JIAN_PATH = 'D:/proj/worlddata/entities/character/剑_0a9cc6fe.json'

beforeEach(() => {
  disk.clear()
  writes.length = 0
  deletes.length = 0
  fallbackUpdate = vi.fn()
})

describe('Bug① 写删自删 —— 路径形态归一', () => {
  it('反斜杠 dir 绑定后 update 不得删除同一物理文件', async () => {
    disk.set(JIAN_PATH, JSON.stringify(ENTITY))
    const fb = new FileStorageBackend({ updateEntity: fallbackUpdate } as never)
    // 调用方真实形态：Windows 反斜杠（useProjectSwitcher.entityDirOf 拼接产物）
    await fb.setProjectDir('D:\\proj\\worlddata')

    await fb.updateEntity(ENTITY.id, { portrait: 'http://asset.localhost/p.png' })
    await new Promise((r) => setTimeout(r, 50)) // 写队列 flush

    // 修复前：oldPath(反斜杠) !== newPath(混合) → delete 同一物理文件 → 文件消失
    expect(disk.has(JIAN_PATH)).toBe(true)
    expect(deletes).toEqual([])
    expect(JSON.parse(disk.get(JIAN_PATH)!).portrait).toBe('http://asset.localhost/p.png')
  })
})

describe('Bug③ 背靠背 update 读改写竞态 —— 后发者不得覆盖先发者的 changes', () => {
  it('连续两次 update（AssetField 一次上传连发 value+kind 的时序）双字段都落盘', async () => {
    disk.set(JIAN_PATH, JSON.stringify(ENTITY))
    const fb = new FileStorageBackend({ updateEntity: fallbackUpdate } as never)
    await fb.setProjectDir('D:\\proj\\worlddata')

    // 背靠背（不 await 第一个再发第二个——复刻组件链连发 emit 的真实时序）
    const p1 = fb.updateEntity(ENTITY.id, { portrait: 'http://asset.localhost/race.png' })
    const p2 = fb.updateEntity(ENTITY.id, { portraitKind: 'animated' })
    await Promise.all([p1, p2])
    await new Promise((r) => setTimeout(r, 50))

    // 修复前：p2 在 await getEntity 的 microtask 窗口读到旧缓存 → 覆盖掉 p1 的 portrait
    const final = JSON.parse(disk.get(JIAN_PATH)!)
    expect(final.portrait).toBe('http://asset.localhost/race.png')
    expect(final.portraitKind).toBe('animated')
  })
})

describe('Bug② boot 竞态 —— 未就绪写等待而非落 fallback', () => {
  it('isReady=false 时 updateEntity 等待 setProjectDir，走文件库且不碰 fallback', async () => {
    disk.set(JIAN_PATH, JSON.stringify(ENTITY))
    const fb = new FileStorageBackend({ updateEntity: fallbackUpdate } as never)

    const pending = fb.updateEntity(ENTITY.id, { portrait: 'http://asset.localhost/q.png' })
    // boot 竞态：100ms 后项目才绑定
    setTimeout(() => void fb.setProjectDir('D:/proj/worlddata'), 100)
    await pending
    await new Promise((r) => setTimeout(r, 50))

    expect(fallbackUpdate).not.toHaveBeenCalled()
    expect(writes).toContain(JIAN_PATH)
    expect(JSON.parse(disk.get(JIAN_PATH)!).portrait).toBe('http://asset.localhost/q.png')
  })
})

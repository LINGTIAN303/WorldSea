import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const invokeMock = vi.fn()
/** 可变的「当前项目目录」，用于模拟切项目（vi.hoisted：mock 工厂先于顶部 const 求值） */
const backend = vi.hoisted(() => ({ dir: 'D:/proj/worlddata' as string | null }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@worldsea/entity-core/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@worldsea/entity-core/core')>()
  return {
    ...actual,
    isTauri: () => true,
    getFileStorageBackend: () => (backend.dir ? { projectDir: backend.dir } as never : null),
  }
})

import {
  defaultHomeProfile,
  homeProfilePath,
  normalizeHomeProfile,
  useHomeProfileStore,
} from '../homeProfileStore'

beforeEach(() => {
  setActivePinia(createPinia())
  invokeMock.mockReset()
  backend.dir = 'D:/proj/worlddata'
})

describe('homeProfile 纯函数', () => {
  it('缺失/损坏形状回落默认值', () => {
    expect(normalizeHomeProfile(null)).toEqual(defaultHomeProfile())
    expect(normalizeHomeProfile({ version: 'x', tagline: 1 })).toEqual(defaultHomeProfile())
  })

  it('trim 与长度上限', () => {
    const p = normalizeHomeProfile({
      tagline: '  一句话  ',
      about: 'y'.repeat(300),
      coverImage: '  asset://x  ',
      updatedAt: '2026-10-23T00:00:00.000Z',
    })
    expect(p.tagline).toBe('一句话')
    expect(p.about).toHaveLength(240)
    expect(p.coverImage).toBe('asset://x')
  })

  it('路径归一为正斜杠', () => {
    expect(homeProfilePath('D:\\proj\\worlddata')).toBe('D:/proj/worlddata/.worldsea/home.json')
  })
})

describe('homeProfileStore IO', () => {
  it('读取 JSON；缺失时回落默认值', async () => {
    const store = useHomeProfileStore()
    invokeMock.mockResolvedValueOnce(JSON.stringify({ version: 1, tagline: 'hi' }))
    await store.load()
    expect(store.profile.tagline).toBe('hi')
    expect(store.loadedProjectDir).toBe('D:/proj/worlddata')

    invokeMock.mockRejectedValueOnce(new Error('ENOENT'))
    await store.load()
    expect(store.profile).toEqual(defaultHomeProfile())
  })

  it('保存写 cmd_fs_write，更新 updatedAt 与内存态', async () => {
    const store = useHomeProfileStore()
    invokeMock.mockResolvedValueOnce(JSON.stringify({ version: 1 }))
    await store.load()
    invokeMock.mockResolvedValueOnce(undefined)
    expect(await store.save({ tagline: ' 新简介 ', about: '短文' })).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('cmd_fs_write', expect.objectContaining({
      path: 'D:/proj/worlddata/.worldsea/home.json',
      createDirs: true,
    }))
    const body = JSON.parse(invokeMock.mock.calls[1][1].content)
    expect(body.tagline).toBe('新简介')
    expect(body.about).toBe('短文')
    expect(typeof body.updatedAt).toBe('string')
    expect(store.profile.tagline).toBe('新简介')
  })

  it('保存失败返回 false 并留 error', async () => {
    const store = useHomeProfileStore()
    invokeMock.mockResolvedValueOnce(JSON.stringify({ version: 1 }))
    await store.load()
    invokeMock.mockRejectedValueOnce(new Error('磁盘只读'))
    expect(await store.save({ tagline: 'x' })).toBe(false)
    expect(store.error).toContain('磁盘只读')
  })

  it('未 load 前保存被拒（内存态尚未对应任何项目）', async () => {
    const store = useHomeProfileStore()
    expect(await store.save({ tagline: '空写' })).toBe(false)
    expect(store.error).toContain('尚未同步')
    expect(invokeMock).not.toHaveBeenCalledWith('cmd_fs_write', expect.anything())
  })

  it('跨项目守卫：载入 A 后切到 B，save 返回 false 且不写盘', async () => {
    const store = useHomeProfileStore()
    invokeMock.mockResolvedValueOnce(JSON.stringify({ version: 1, tagline: 'A 的简介' }))
    await store.load()
    expect(store.profile.tagline).toBe('A 的简介')

    backend.dir = 'D:/proj/other/worlddata'
    invokeMock.mockClear()
    expect(await store.save({ tagline: 'A 的草稿' })).toBe(false)
    expect(store.error).toContain('尚未同步')
    expect(invokeMock).not.toHaveBeenCalled()
    // 内存态仍是 A 的内容，没被草稿污染
    expect(store.profile.tagline).toBe('A 的简介')
  })

  it('并发保存串行落盘：后一次必须等前一次完成', async () => {
    const store = useHomeProfileStore()
    invokeMock.mockResolvedValueOnce(JSON.stringify({ version: 1 }))
    await store.load()

    const writes: string[] = []
    let releaseFirst!: () => void
    invokeMock.mockImplementation((cmd: string, args: Record<string, any>) => {
      if (cmd !== 'cmd_fs_write') return Promise.resolve(undefined)
      const tagline = JSON.parse(args.content).tagline
      writes.push(tagline)
      if (tagline === 'first') return new Promise<void>(resolve => { releaseFirst = resolve })
      return Promise.resolve(undefined)
    })

    const first = store.save({ tagline: 'first', about: '', coverImage: '' })
    const second = store.save({ tagline: 'second', about: '', coverImage: '' })
    await vi.waitFor(() => expect(writes).toEqual(['first']))
    releaseFirst()
    await Promise.all([first, second])

    expect(writes).toEqual(['first', 'second'])
    expect(store.profile.tagline).toBe('second')
  })

  it('过期 load 被无目录 load 取代时复位 loading', async () => {
    const store = useHomeProfileStore()
    let resolveA!: (value: string) => void
    invokeMock.mockImplementationOnce(() => new Promise<string>(resolve => { resolveA = resolve }))
    const first = store.load()
    expect(store.loading).toBe(true)

    backend.dir = null
    await store.load()
    expect(store.loading).toBe(false)

    resolveA(JSON.stringify({ version: 1, tagline: 'A 的简介' }))
    await first
    expect(store.loading).toBe(false)
    expect(store.profile.tagline).toBe('')
  })

  it('过期 load 结果不回填（切项目竞态）', async () => {
    const store = useHomeProfileStore()
    let resolveA!: (value: string) => void
    invokeMock.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveA = resolve }))
    const first = store.load() // 目录 A，读盘悬挂
    backend.dir = 'D:/proj/other/worlddata'
    invokeMock.mockResolvedValueOnce(JSON.stringify({ version: 1, tagline: 'B 的简介' }))
    await store.load() // 目录 B，先返回
    resolveA(JSON.stringify({ version: 1, tagline: 'A 的简介' }))
    await first

    expect(store.profile.tagline).toBe('B 的简介')
    expect(store.loadedProjectDir).toBe('D:/proj/other/worlddata')
  })
})

/** 首页资料打包分区：collect/import/merge 与注册（不依赖 app 侧 store） */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
const backend = vi.hoisted(() => ({ dir: 'D:/proj/worlddata' as string | null }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, any>) => {
    const path = String(args?.path ?? '').replace(/\\/g, '/')
    if (cmd === 'cmd_fs_read') {
      const content = files.get(path)
      if (content === undefined) throw new Error(`ENOENT ${path}`)
      return content
    }
    if (cmd === 'cmd_fs_write') {
      files.set(path, String(args.content))
      return undefined
    }
    throw new Error(`未预期的命令 ${cmd}`)
  },
}))
vi.mock('../StorageBackend', () => ({
  getFileStorageBackend: () => (backend.dir ? { projectDir: backend.dir } as never : null),
}))

import { homeProfileSerializer } from '../serializers/HomeProfileSerializer'
import { getExportController } from '../io/io_export'
import { serializerRegistry } from '../io/WorldSeaPack'

const PATH = 'D:/proj/worlddata/.worldsea/home.json'
const PROFILE = {
  version: 1,
  tagline: '一句话',
  about: '短文',
  coverImage: 'asset://x',
  updatedAt: '2026-10-23T00:00:00Z',
}

beforeEach(() => {
  files.clear()
  backend.dir = 'D:/proj/worlddata'
})

describe('homeProfileSerializer', () => {
  it('collect 读取 home.json；缺失返回空分区', async () => {
    files.set(PATH, JSON.stringify(PROFILE))
    expect(await homeProfileSerializer.collect()).toMatchObject({ total: 1, profile: PROFILE })

    files.clear()
    expect(await homeProfileSerializer.collect()).toMatchObject({ total: 0, profile: null })
  })

  it('overwrite 写入包内资料并广播刷新', async () => {
    const changed = vi.fn()
    window.addEventListener('ws-home-profile-changed', changed, { once: true })
    files.set(PATH, JSON.stringify({ ...PROFILE, tagline: '旧', about: '旧短文' }))

    await homeProfileSerializer.import({ profile: { ...PROFILE, tagline: '新' } }, 'overwrite')

    expect(JSON.parse(files.get(PATH)!)).toMatchObject({ tagline: '新', about: '短文' })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('merge 不覆盖已有非空字段', async () => {
    files.set(PATH, JSON.stringify(PROFILE))
    await homeProfileSerializer.import(
      { profile: { version: 1, tagline: '', about: '新短文', coverImage: '' } },
      'merge',
    )
    expect(JSON.parse(files.get(PATH)!)).toMatchObject({
      tagline: '一句话',
      about: '新短文',
      coverImage: 'asset://x',
    })
  })

  it('无项目目录时 collect 为空、import no-op', async () => {
    backend.dir = null
    expect(await homeProfileSerializer.collect()).toMatchObject({ total: 0, profile: null })
    await homeProfileSerializer.import({ profile: PROFILE }, 'overwrite')
    expect(files.size).toBe(0)
  })

  it('已注册到打包序列化器', () => {
    getExportController()
    expect(serializerRegistry.get('home-profile')).toBe(homeProfileSerializer)
  })
})

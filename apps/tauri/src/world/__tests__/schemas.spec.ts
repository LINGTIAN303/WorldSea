/** 批7：项目级 schema 覆盖收集/校验（注入式 IO 纯核心；reload 编排走门禁+真机走查） */
import { describe, expect, it } from 'vitest'
import { collectProjectSchemas, projectSchemasDir, SCHEMA_DIR } from '../schemas'
import type { ExternalIo } from '../external'

const DIR = `/wd/${SCHEMA_DIR}`

function ioWith(files: Record<string, string>): ExternalIo {
  return {
    async list(dir) {
      if (dir !== DIR) return null
      return Object.keys(files).map(name => ({ name, isDir: false }))
    },
    async read(path) {
      const name = path.split('/').pop()!
      if (!(name in files)) throw new Error('not found')
      return files[name]!
    },
  }
}

describe('collectProjectSchemas', () => {
  it('合法文件进 overlays（type 取文件名一致守卫通过）', async () => {
    const r = await collectProjectSchemas(ioWith({
      'species.json': JSON.stringify({ type: 'species', label: '物种 v2', ownFields: [{ key: 'language', label: '语言' }] }),
    }), DIR)
    expect(r.rejected).toHaveLength(0)
    expect(r.overlays.get('species')?.label).toBe('物种 v2')
  })

  it('坏 JSON 进 rejected，不中断其余文件', async () => {
    const r = await collectProjectSchemas(ioWith({
      'bad.json': '{ not json',
      'species.json': JSON.stringify({ type: 'species' }),
    }), DIR)
    expect(r.overlays.has('species')).toBe(true)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0]!.type).toBe('bad')
    expect(r.rejected[0]!.reason).toContain('JSON 解析失败')
  })

  it('校验拒绝进 rejected（type 不一致 / 未知顶层键）', async () => {
    const r = await collectProjectSchemas(ioWith({
      'species.json': JSON.stringify({ type: 'character' }),
      'items.json': JSON.stringify({ type: 'items', unknownKey: 1 }),
    }), DIR)
    expect(r.overlays.size).toBe(0)
    expect(r.rejected).toHaveLength(2)
    expect(r.rejected.map(x => x.reason).join()).toContain('不一致')
    expect(r.rejected.map(x => x.reason).join()).toContain('未知顶层键')
  })

  it('目录不存在 = 空报告（不报错）', async () => {
    const r = await collectProjectSchemas(ioWith({}), `${DIR}/nope`)
    expect(r.overlays.size).toBe(0)
    expect(r.rejected).toHaveLength(0)
  })

  it('非 .json 与子目录跳过', async () => {
    const io: ExternalIo = {
      async list() {
        return [
          { name: 'readme.md', isDir: false },
          { name: 'sub', isDir: true },
          { name: 'species.json', isDir: false },
        ]
      },
      async read() {
        return JSON.stringify({ type: 'species' })
      },
    }
    const r = await collectProjectSchemas(io, DIR)
    expect(r.overlays.size).toBe(1)
    expect(r.rejected).toHaveLength(0)
  })
})

describe('projectSchemasDir', () => {
  it('拼接 worlddata 根并归一尾斜杠', () => {
    expect(projectSchemasDir('D:/ws/worlddata/')).toBe(`D:/ws/worlddata/${SCHEMA_DIR}`)
  })

  it('空 projectDir = null', () => {
    expect(projectSchemasDir(null)).toBeNull()
    expect(projectSchemasDir(undefined)).toBeNull()
  })
})

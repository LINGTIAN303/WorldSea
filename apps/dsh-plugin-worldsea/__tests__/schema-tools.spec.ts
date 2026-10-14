// @vitest-environment node
/**
 * 实体 schema 覆盖四件工具（批7，2026-10-14）。
 *
 * 钉行为：write（JSON 解析 + 轻校验 + 原子写）/ list / read / delete（回落内置默认语义）；
 * 错误码：WORLDSEA_SCHEMA_BAD_JSON（解析失败）/ WORLDSEA_SCHEMA_INVALID（type 不一致/未知键/字段缺 key）/
 * WORLDSEA_SCHEMA_UNKNOWN（文件不存在）/ BAD_ARGS（type 非安全标识符——防路径穿越）。
 * 驱动方式与 plugin-tools.spec 同：真实 apply + 伪造 ctx + dataRoot 指临时目录。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import * as plugin from '../lib/index.js'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
}

function loadTools(config: Record<string, unknown> = {}): Map<string, RegisteredTool> {
  const registered = new Map<string, RegisteredTool>()
  ;(plugin.apply as (ctx: unknown, config?: Record<string, unknown>) => void)(
    { tools: { register: (tool: RegisteredTool) => registered.set(tool.name, tool) } },
    config,
  )
  return registered
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeRoot(): { root: string; schemasDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'ws-schema-tools-'))
  dirs.push(root)
  return { root, schemasDir: join(root, 'worlddata', '.worldsea', 'schemas') }
}

const VALID_OVERLAY = JSON.stringify({ type: 'species', label: '物种 v2', ownFields: [{ key: 'language', label: '语言' }] })

describe('world_schema_* 四件工具', () => {
  it('write → list → read roundtrip：落盘为格式化 JSON 原文', async () => {
    const { root, schemasDir } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    const result = (await tools.get('world_schema_write')!.execute({ type: 'species', json: VALID_OVERLAY }, {})) as Record<string, unknown>
    expect(result.type).toBe('species')

    const list = (await tools.get('world_schema_list')!.execute({}, {})) as { items: Array<{ type: string }> }
    expect(list.items.map((i) => i.type)).toEqual(['species'])

    const read = (await tools.get('world_schema_read')!.execute({ type: 'species' }, {})) as { json: string }
    expect(JSON.parse(read.json)).toEqual(JSON.parse(VALID_OVERLAY))
    expect(existsSync(join(schemasDir, 'species.json'))).toBe(true)
  })

  it('write 坏 JSON → WORLDSEA_SCHEMA_BAD_JSON', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(tools.get('world_schema_write')!.execute({ type: 'species', json: '{ nope' }, {})).rejects.toThrow(
      'WORLDSEA_SCHEMA_BAD_JSON',
    )
  })

  it('write type 与文件名不一致 / 未知顶层键 → WORLDSEA_SCHEMA_INVALID', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(
      tools.get('world_schema_write')!.execute({ type: 'species', json: JSON.stringify({ type: 'character' }) }, {}),
    ).rejects.toThrow('WORLDSEA_SCHEMA_INVALID')
    await expect(
      tools.get('world_schema_write')!.execute({ type: 'species', json: JSON.stringify({ type: 'species', hack: 1 }) }, {}),
    ).rejects.toThrow('未知顶层键')
  })

  it('write ownFields 缺 key → WORLDSEA_SCHEMA_INVALID', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(
      tools.get('world_schema_write')!.execute({ type: 'species', json: JSON.stringify({ type: 'species', ownFields: [{ label: '无键' }] }) }, {}),
    ).rejects.toThrow('ownFields[0].key')
  })

  it('write type 非安全标识符（路径穿越）→ BAD_ARGS', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(tools.get('world_schema_write')!.execute({ type: '../evil', json: '{}' }, {})).rejects.toThrow('BAD_ARGS')
  })

  it('delete 回落内置默认语义（文件消失）+ 重复删除 → WORLDSEA_SCHEMA_UNKNOWN', async () => {
    const { root, schemasDir } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await tools.get('world_schema_write')!.execute({ type: 'species', json: VALID_OVERLAY }, {})
    const result = (await tools.get('world_schema_delete')!.execute({ type: 'species' }, {})) as Record<string, unknown>
    expect(result.note).toContain('回落内置默认')
    expect(existsSync(join(schemasDir, 'species.json'))).toBe(false)
    await expect(tools.get('world_schema_delete')!.execute({ type: 'species' }, {})).rejects.toThrow('WORLDSEA_SCHEMA_UNKNOWN')
  })

  it('read 不存在 → WORLDSEA_SCHEMA_UNKNOWN', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(tools.get('world_schema_read')!.execute({ type: 'species' }, {})).rejects.toThrow('WORLDSEA_SCHEMA_UNKNOWN')
  })
})

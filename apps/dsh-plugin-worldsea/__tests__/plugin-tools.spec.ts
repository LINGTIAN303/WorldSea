// @vitest-environment node
/**
 * 外部插件管理五件工具（批1，2026-10-13）。
 *
 * 钉行为：write（校验 + 原子写 + 落盘形状）/ list（清单）/ read / delete / template；
 * 错误码：WORLDSEA_PLUGIN_ID_INVALID（ws. 前缀）/ WORLDSEA_PLUGIN_BAD_CODE（缺 manifest/apply）/
 * WORLDSEA_PLUGIN_UNKNOWN（不存在）。驱动方式与 config.spec 同：真实 apply + 伪造 ctx。
 * 服务桥回归（2026-10-13 走查）：ctx 无 worldseaDataFace 时 faceValue 必须回落而非抛
 * `without inject`（写工具的 requireWorkspaceRoot → readDshWorkspaces 链最先踩到）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

const originalDshHome = process.env.DSH_HOME

/** 造一个独立数据根（dataRoot 兜底口径：无会话 cwd）。 */
function makeRoot(): { root: string; pluginsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'ws-plugin-tools-'))
  dirs.push(root)
  return { root, pluginsDir: join(root, 'worlddata', '.worldsea', 'plugins') }
}

/** 造一个含 `storages/workspace.json` 的假 DSH_HOME（cwd=工作区根的正链路用）。 */
function fakeHome(workspacePath: string): string {
  const home = mkdtempSync(join(tmpdir(), 'ws-dsh-home-'))
  dirs.push(home)
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    global: { workspaceIds: ['w1'] },
    tables: { workspaces: { w1: { title: 'proj', path: workspacePath } } },
  }))
  return home
}

const VALID_CODE = `(require) => ({ manifest: { id: 'ws.counter', name: '计数', version: '0.1.0', description: 'x' }, apply() {} })`

describe('world_plugin_* 五件工具', () => {
  it('template 返回可写形态的模板（含 manifest 与 apply，id 为 ws. 前缀）', async () => {
    const tools = loadTools()
    const { code } = (await tools.get('world_plugin_template')!.execute({}, {})) as { code: string }
    expect(code).toContain('manifest')
    expect(code).toContain('apply')
    expect(code).toContain('ws.counter')
  })

  it('write → list → read roundtrip：文件落盘为源码原文（非 JSON 包装）', async () => {
    const { root, pluginsDir } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    const result = (await tools.get('world_plugin_write')!.execute({ id: 'ws.counter', code: VALID_CODE }, {})) as Record<string, unknown>
    expect(result.id).toBe('ws.counter')

    const list = (await tools.get('world_plugin_list')!.execute({}, {})) as { items: Array<{ id: string }> }
    expect(list.items.map(item => item.id)).toEqual(['ws.counter'])

    const read = (await tools.get('world_plugin_read')!.execute({ id: 'ws.counter' }, {})) as { code: string }
    expect(read.code).toBe(VALID_CODE)
    // 落盘内容 = 源码原文（装载器按函数表达式求值，JSON 包装会坏）
    expect(readFileSync(join(pluginsDir, 'ws.counter.js'), 'utf-8')).toBe(VALID_CODE)
  })

  it('write 覆盖已有插件（同 id 原子替换，不残留 .tmp）', async () => {
    const { root, pluginsDir } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await tools.get('world_plugin_write')!.execute({ id: 'ws.counter', code: VALID_CODE }, {})
    const v2 = VALID_CODE.replace("'0.1.0'", "'0.2.0'")
    await tools.get('world_plugin_write')!.execute({ id: 'ws.counter', code: v2 }, {})
    expect(readFileSync(join(pluginsDir, 'ws.counter.js'), 'utf-8')).toBe(v2)
    expect(existsSync(join(pluginsDir, 'ws.counter.js.tmp'))).toBe(false)
  })

  it('write 拒绝非 ws. 前缀 id（WORLDSEA_PLUGIN_ID_INVALID）', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(tools.get('world_plugin_write')!.execute({ id: 'official.characters', code: VALID_CODE }, {}))
      .rejects.toThrow(/WORLDSEA_PLUGIN_ID_INVALID/)
    await expect(tools.get('world_plugin_write')!.execute({ id: 'counter', code: VALID_CODE }, {}))
      .rejects.toThrow(/WORLDSEA_PLUGIN_ID_INVALID/)
  })

  it('write 拒绝缺 manifest / 缺 apply 的 code（WORLDSEA_PLUGIN_BAD_CODE）', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(tools.get('world_plugin_write')!.execute({ id: 'ws.x', code: '(require) => ({})' }, {}))
      .rejects.toThrow(/WORLDSEA_PLUGIN_BAD_CODE/)
    await expect(tools.get('world_plugin_write')!.execute({ id: 'ws.x', code: '({ manifest: {} })' }, {}))
      .rejects.toThrow(/WORLDSEA_PLUGIN_BAD_CODE/)
  })

  it('read/delete 不存在的插件 → WORLDSEA_PLUGIN_UNKNOWN；delete 后 list 归零', async () => {
    const { root } = makeRoot()
    const tools = loadTools({ dataRoot: root })
    await expect(tools.get('world_plugin_read')!.execute({ id: 'ws.nope' }, {}))
      .rejects.toThrow(/WORLDSEA_PLUGIN_UNKNOWN/)

    await tools.get('world_plugin_write')!.execute({ id: 'ws.counter', code: VALID_CODE }, {})
    await tools.get('world_plugin_delete')!.execute({ id: 'ws.counter' }, {})
    const list = (await tools.get('world_plugin_list')!.execute({}, {})) as { items: unknown[] }
    expect(list.items).toEqual([])
  })

  it('服务桥回归：ctx 无 worldseaDataFace + 有 cwd → 回落链生效（结构化错误码，非 without inject）', async () => {
    const { root } = makeRoot()
    delete process.env.DSH_HOME
    const tools = loadTools({ dataRoot: root })
    const exec = { agent: { session: { header: { cwd: 'C:/not-a-workspace' } } } }
    // console 服务桥缺席 → faceValue 回落 → 无 DSH_HOME 时 fail loud NO_DSH_HOME（既有三段式语义）
    const err = await tools.get('world_plugin_write')!.execute({ id: 'ws.x', code: VALID_CODE }, exec).then(
      () => null,
      (e: Error) => e,
    )
    expect(String(err)).toMatch(/WORLDSEA_NO_DSH_HOME|WORLDSEA_NOT_A_WORKSPACE/)
    expect(String(err)).not.toContain('without inject')
  })

  it('服务桥回归：ctx 无服务桥 + cwd = 已登记工作区根 → write 正常落 cwd/worlddata（走查正链路）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-plugin-cwd-'))
    dirs.push(root)
    process.env.DSH_HOME = fakeHome(root)
    const tools = loadTools({})
    const exec = { agent: { session: { header: { cwd: root } } } }
    const result = (await tools.get('world_plugin_write')!.execute({ id: 'ws.counter', code: VALID_CODE }, exec)) as Record<string, unknown>
    expect(result.id).toBe('ws.counter')
    expect(readFileSync(join(root, 'worlddata', '.worldsea', 'plugins', 'ws.counter.js'), 'utf-8')).toBe(VALID_CODE)
  })
})

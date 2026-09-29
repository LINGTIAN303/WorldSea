// @vitest-environment node
/**
 * 宿主半插件的 config 面（D3-c2，2026-09-30）。
 *
 * 钉两件事：
 * ① **声明**：`Config` 是「可被 dsh 设置面编辑」的前提——settings 服务的写入门槛要求条目有
 *    schema 且**含 volatile 字段**（`dsh/packages/settings/settings/src/index.ts:383-385`
 *    分别抛 `No configurable plugin entry` / `has no volatile fields`），缺任一即写不进去。
 * ② **解析语义**（既有行为；新增 schema 的缺省值不得把它改坏）：`config.dshHome` 覆盖 >
 *    `process.env.DSH_HOME`；空值回落 env；`config.dataRoot` 是无会话 cwd 的兜底，未配则 fail loud。
 *
 * 驱动方式：调真实 `apply(ctx, config)`（只伪造 cordis 边界的 `tools.register`），再从注册结果里
 * 取工具跑真实 execute——测的是插件真行为，不是桩。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import * as plugin from '../lib/index.js'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
}

/** 假 cordis 上下文：只提供 apply 用到的 `tools.register`（`systemPrompt?.section?` 是可选的）。 */
function loadTools(config: Record<string, unknown> = {}): Map<string, RegisteredTool> {
  const registered = new Map<string, RegisteredTool>()
  ;(plugin.apply as (ctx: unknown, config?: Record<string, unknown>) => void)(
    { tools: { register: (tool: RegisteredTool) => registered.set(tool.name, tool) } },
    config,
  )
  return registered
}

/** 造一个含 `storages/workspace.json` 的假 DSH_HOME。 */
function fakeHome(title: string): string {
  const home = mkdtempSync(join(tmpdir(), 'ws-dsh-home-'))
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    global: { workspaceIds: ['w1'] },
    tables: { workspaces: { w1: { title, path: `C:\\proj\\${title}` } } },
  }))
  return home
}

const originalDshHome = process.env.DSH_HOME
afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

/** 序列化 schema 的字段表（`settings/types.ts` 把 `schema.toJSON()` 当 wire 格式）。 */
function serializedFields(schema: { toJSON: () => unknown }): Record<string, { type?: string, meta?: { volatile?: boolean, default?: unknown } }> {
  const json = schema.toJSON() as {
    uid: number | string
    refs: Record<string, { type?: string, meta?: { volatile?: boolean, default?: unknown }, dict?: Record<string, number | string> }>
  }
  const root = json.refs[String(json.uid)]
  return Object.fromEntries(
    Object.entries(root.dict ?? {}).map(([key, ref]) => [key, json.refs[String(ref)]]),
  )
}

describe('worldsea 插件 config 声明（D3-c2）', () => {
  it('Config 导出存在且两字段都是 volatile（设置面写入门槛的前提）', () => {
    const Config = (plugin as { Config?: { toJSON: () => unknown } }).Config
    expect(Config, '缺少 Config 导出 —— settings 写入会抛 No configurable plugin entry').toBeTruthy()
    const fields = serializedFields(Config as { toJSON: () => unknown })
    expect(Object.keys(fields).sort()).toEqual(['dataRoot', 'dshHome'])
    for (const key of ['dataRoot', 'dshHome']) {
      expect(fields[key]?.meta?.volatile, `${key} 未声明 volatile —— 写入会抛 has no volatile fields`).toBe(true)
    }
  })
})

describe('worldsea 插件 config 解析语义（既有行为，schema 缺省不得改坏）', () => {
  it('config.dshHome 覆盖优先于 env：项目清单读的是覆盖那个 home', async () => {
    const override = fakeHome('覆盖项目')
    const fromEnv = fakeHome('环境项目')
    process.env.DSH_HOME = fromEnv
    const tool = loadTools({ dshHome: override }).get('world_project_list')
    expect(tool).toBeTruthy()
    const result = await tool!.execute({}, {})
    expect(JSON.stringify(result)).toContain('覆盖项目')
    expect(JSON.stringify(result)).not.toContain('环境项目')
  })

  it('dshHome 为空值（schema 缺省 ""）时回落 env', async () => {
    const fromEnv = fakeHome('环境项目')
    process.env.DSH_HOME = fromEnv
    const tool = loadTools({ dshHome: '' }).get('world_project_list')
    const result = await tool!.execute({}, {})
    expect(JSON.stringify(result)).toContain('环境项目')
  })

  it('走真物化链：schema 缺省经 Config({}) 物化后喂给解析器，仍回落 env', async () => {
    // 上面那条是「用户清空字段」的形态（显式 ''）；这条是「从未设过」的形态——由 Loader 用 schema
    // 物化出 config（cordis 的真实路径）。它同时钉住一个实测踩到过的坑：**volatile 字段物化后是
    // cosmokit 的 `Volatile<T>` 句柄而非原值**，插件必须经 configText() 取值——少了那层适配，
    // 这里会拿句柄当路径用，env 的项目就出不来了。
    const fromEnv = fakeHome('环境项目')
    process.env.DSH_HOME = fromEnv
    const materialize = (plugin as { Config: (input: object) => Record<string, unknown> }).Config
    const materialized = materialize({})
    const tool = loadTools(materialized).get('world_project_list')
    const result = await tool!.execute({}, {})
    expect(JSON.stringify(result)).toContain('环境项目')
    // 同一份物化 config 的 dataRoot 也必须保持「未设」——否则无会话 cwd 的调用会去读一个默认目录
    // 而不是 fail loud（schema 缺省被改成真路径即在此报红）。
    const entityTool = loadTools(materialized).get('world_entity_list')
    await expect(entityTool!.execute({ type: 'lang' }, {})).rejects.toThrow(/WORLDSEA_NO_SESSION/)
  })

  it('config.dataRoot 是无会话 cwd 时的实体目录兜底；未配则 fail loud', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-data-root-'))
    mkdirSync(join(root, 'worlddata', 'entities', 'lang'), { recursive: true })
    writeFileSync(join(root, 'worlddata', 'entities', 'lang', 'a.json'), JSON.stringify({ id: 'e1', type: 'lang', name: '兜底实体' }))

    const withFallback = loadTools({ dataRoot: root }).get('world_entity_list')
    const listed = await withFallback!.execute({ type: 'lang' }, {})
    expect(JSON.stringify(listed)).toContain('兜底实体')

    const withoutFallback = loadTools({}).get('world_entity_list')
    await expect(withoutFallback!.execute({ type: 'lang' }, {})).rejects.toThrow(/WORLDSEA_NO_SESSION/)
  })
})

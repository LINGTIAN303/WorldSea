// @vitest-environment node
/**
 * 预设化 patch 的跨文件契约（2026-10-07）。
 *
 * worldsea 从「profile 顶层全局挂载」改为「产品域模式预设的能力组成」（升级信号触发，见
 * docs/plans/2026-09-27-D2 §候选5-1 的形态备案）。本 spec 钉住四件事，任一漂移即测试红：
 * ① patch 只插 `preset-worldsea` 一个顶层行——全局 worldsea 行已撤销（能力互斥的本体）；
 * ② 预设身份/展示元数据：config.id `worldsea`、order 5、name/description 非空；
 * ③ worldsea 插件以**预设子行**出现且全文档仅此一处（防止顶层行回潮）；
 * ④ ★ 追版纪律：花名册（除 worldsea 子行外）与 dsh 标准预设（`dsh/packages/bundle/web-app/
 *    presets/standard.patch.yml`）**结构全量一致**——dsh 预设无继承机制，产品域模式的能力
 *    组成靠这份复制维持；dsh 追版若动了标准花名册而未同步本 patch，这里直接报警。
 *
 * 解析用 js-yaml + `tag:yaml.org,2002:js` 占位类型（cordis 的 `!!js` 表达式，测试只关心
 * patch 结构，表达式体不必求值）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const OURS = readFileSync(join(process.cwd(), 'apps/dsh-plugin-worldsea/cordis.patch.yml'), 'utf8')
const STANDARD = readFileSync(join(process.cwd(), 'dsh/packages/bundle/web-app/presets/standard.patch.yml'), 'utf8')

interface PatchRow {
  id: string
  name: string
  config?: {
    id?: string
    order?: number
    name?: string
    description?: string
    plugins?: Array<Record<string, unknown>>
  }
}
/** patch 文件顶层 = YAML 数组，元素 = Loader patch 条目（含 insert 列表）。 */
interface PatchFile extends Array<{ insert?: PatchRow[] }> {}

const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: () => true,
  construct: (data: string) => ({ __jsExpr: data }),
})
const load = (text: string): PatchFile =>
  yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend({ explicit: [jsTag] }) }) as PatchFile

describe('worldsea 预设化 patch：结构与跨文件契约（2026-10-07）', () => {
  const rows = load(OURS).flatMap(entry => entry.insert ?? [])

  it('patch 只插一个顶层行：preset-worldsea（全局 worldsea 行已撤销——能力互斥的本体）', () => {
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.id).toBe('preset-worldsea')
    expect(row.name).toBe('@deepseek-ai/dsh-agent-preset')
  })

  it('预设身份与展示元数据：config.id worldsea / order 5 / name+description 非空', () => {
    const config = rows[0].config!
    expect(config.id).toBe('worldsea')
    expect(config.order).toBe(5)
    expect(typeof config.name).toBe('string')
    expect(config.name!.length).toBeGreaterThan(0)
    expect(typeof config.description).toBe('string')
    expect(config.description!.length).toBeGreaterThan(0)
  })

  it('能力面：worldsea 以预设子行出现且全文档仅此一处（防顶层全局行回潮），子行不带 config', () => {
    const references = [...OURS.matchAll(/name:\s*'dsh-plugin-worldsea'/g)]
    expect(references).toHaveLength(1)
    const plugins = rows[0].config!.plugins!
    const child = plugins.find(entry => entry.name === 'dsh-plugin-worldsea')
    expect(child?.id).toBe('worldsea')
    expect(child?.config).toBeUndefined()
  })

  it('★ 追版纪律：花名册（除 worldsea 子行外）与 dsh 标准预设结构全量一致', () => {
    const standardRows = load(STANDARD).flatMap(entry => entry.insert ?? [])
    const standardRow = standardRows.find(row => row.config?.id === 'standard')
    expect(standardRow).toBeDefined()
    const ours = [...rows[0].config!.plugins!]
    const appended = ours.pop()
    expect(appended?.name).toBe('dsh-plugin-worldsea')
    expect(ours).toEqual(standardRow!.config!.plugins)
  })
})

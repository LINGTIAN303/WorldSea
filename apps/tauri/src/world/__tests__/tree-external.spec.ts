/**
 * 树的外部来源并入 + reloadExternalPlugins 重对账 diff（批1）。
 *
 * collectExternalPlugins 以 vi.mock 替身（返回态可控），内置插件走注入假插件——
 * 钉四态：added / unchanged / updated（卸了重装）/ removed；外加内置 id 冲突拒与启停过滤。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginAPI } from '@worldsea/entity-core'

import type { WorldPlugin } from '../manifest'
import type { ExternalCollectReport } from '../external'

const collectMock = vi.hoisted(() => vi.fn())

vi.mock('../external', async importOriginal => {
  const actual = await importOriginal<typeof import('../external')>()
  return { ...actual, collectExternalPlugins: (...args: unknown[]) => collectMock(...args) }
})

const { disposeWorldTree, externalPluginStates, reloadExternalPlugins, startWorldTree, worldTreeState } = await import('../tree')

const BUILTIN_ID = 'ws.builtin.one'
const EXT_ID = 'ws.ext.one'

const builtinPlugin: WorldPlugin = {
  manifest: { id: BUILTIN_ID, name: '内置假芽', version: '1.0.0', description: '注入用' },
  apply() {},
}

function extPlugin(version: string): WorldPlugin {
  return {
    manifest: { id: EXT_ID, name: '外部插件', version, description: '重对账用' },
    apply() {},
  }
}

function collectReport(plugins: WorldPlugin[], rejected: ExternalCollectReport['rejected'] = []): ExternalCollectReport {
  return {
    plugins,
    rejected,
    codes: new Map(plugins.map(p => [p.manifest.id, `code-${p.manifest.version}`])),
  }
}

beforeEach(() => {
  collectMock.mockReset()
  collectMock.mockResolvedValue(collectReport([]))
})

afterEach(() => {
  disposeWorldTree()
  pluginAPI.clearViews()
})

describe('startWorldTree 外部来源并入', () => {
  it('起树时外部插件并入装载；rejected 独立记账（进 externalPluginStates）', async () => {
    collectMock.mockResolvedValue(collectReport([extPlugin('0.1.0')], [
      { id: 'ws.bad', file: 'x/ws.bad.js', reason: '代码语法错误： boom' },
    ]))
    await startWorldTree({ plugins: [builtinPlugin] })

    expect(worldTreeState().plugins).toEqual([BUILTIN_ID, EXT_ID])
    const states = externalPluginStates()
    expect(states.find(state => state.id === EXT_ID)?.status).toBe('loaded')
    expect(states.find(state => state.id === 'ws.bad')?.status).toBe('rejected')
  })

  it('外部 id 与内置冲突 → 拒且不装载（先到者生效）', async () => {
    collectMock.mockResolvedValue(collectReport([{ ...builtinPlugin, apply() {} }]))
    await startWorldTree({ plugins: [builtinPlugin] })

    expect(worldTreeState().plugins).toEqual([BUILTIN_ID])
    expect(externalPluginStates().find(state => state.id === BUILTIN_ID)?.status).toBe('rejected')
  })
})

describe('reloadExternalPlugins 重对账 diff', () => {
  it('新增 → unchanged → 变更重装 → 消失，四态齐验；内置不碰', async () => {
    await startWorldTree({ plugins: [builtinPlugin] })

    // 新增
    collectMock.mockResolvedValue(collectReport([extPlugin('0.1.0')]))
    let report = await reloadExternalPlugins()
    expect(report.added).toEqual([EXT_ID])
    expect(worldTreeState().plugins).toEqual([BUILTIN_ID, EXT_ID])

    // 未变
    report = await reloadExternalPlugins()
    expect(report.unchanged).toEqual([EXT_ID])
    expect(report.added).toEqual([])

    // 变更 → 卸了重装
    collectMock.mockResolvedValue(collectReport([extPlugin('0.2.0')]))
    report = await reloadExternalPlugins()
    expect(report.updated).toEqual([EXT_ID])
    expect(worldTreeState().plugins).toEqual([BUILTIN_ID, EXT_ID])

    // 消失 → 卸载
    collectMock.mockResolvedValue(collectReport([]))
    report = await reloadExternalPlugins()
    expect(report.removed).toEqual([EXT_ID])
    expect(worldTreeState().plugins).toEqual([BUILTIN_ID])
  })

  it('启停过滤：isEnabled 为 false 的外部插件不装载（进 skipped），重新启用靠 setPluginEnabled', async () => {
    await startWorldTree({ plugins: [builtinPlugin], isEnabled: id => id !== EXT_ID })
    collectMock.mockResolvedValue(collectReport([extPlugin('0.1.0')]))

    const report = await reloadExternalPlugins()
    expect(report.added).toEqual([])
    expect(worldTreeState().skipped).toContain(EXT_ID)
    const states = externalPluginStates()
    expect(states.find(state => state.id === EXT_ID)?.status).toBe('skipped')
  })

  it('树未启动 → 空报告（幂等安全）', async () => {
    const report = await reloadExternalPlugins()
    expect(report.added).toEqual([])
    expect(report.removed).toEqual([])
  })

  it('utility 常驻装载（批5）：isEnabled 为 false 仍装载，不进 skipped', async () => {
    const utilPlugin: WorldPlugin = {
      manifest: { id: 'ws.ext.util', name: '常驻外部插件', version: '1.0.0', description: 'utility 声明', kind: 'utility' },
      apply() {},
    }
    await startWorldTree({ plugins: [builtinPlugin], isEnabled: () => false })
    collectMock.mockResolvedValue(collectReport([utilPlugin]))

    const report = await reloadExternalPlugins()
    expect(report.added).toEqual(['ws.ext.util'])
    expect(worldTreeState().plugins).toContain('ws.ext.util')
    expect(worldTreeState().skipped).not.toContain('ws.ext.util')
  })
})

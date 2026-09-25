/**
 * 装载器核心（B 批）：校验 + 依赖预检 + 去重 + 失败隔离（纯函数 `assemblePlugins`）+ 真实清单冒烟。
 *
 * 【反证口径】「非法即拒」不是静默跳过：被拒条目必须出现在 report.rejected 里（id/原因可读），
 * 且**不影响**其余插件装载。
 */
import { describe, expect, it } from 'vitest'
import { assemblePlugins } from '../loader'
import { WORLD_SERVICES } from '../tree'
import type { WorldPlugin } from '../manifest'

function plugin(id: string, requires?: string[]): WorldPlugin {
  return {
    manifest: { id, name: id, version: '1.0.0', description: '测试插件', requires },
    apply: () => {},
  }
}

const services = [...WORLD_SERVICES]

describe('assemblePlugins（纯函数）', () => {
  it('合法插件全部接受，顺序稳定（按候选顺序）', () => {
    const { accepted, report } = assemblePlugins(
      [
        { file: 'a.ts', plugin: plugin('ws.a.one') },
        { file: 'b.ts', plugin: plugin('ws.b.two', ['world.info']) },
      ],
      services,
    )
    expect(report.loaded).toEqual(['ws.a.one', 'ws.b.two'])
    expect(accepted.map(p => p.manifest.id)).toEqual(['ws.a.one', 'ws.b.two'])
    expect(report.rejected).toEqual([])
  })

  it('无 default 导出 / 清单非法 / apply 缺失 → 逐条拒并留因，不影响他者', () => {
    const { accepted, report } = assemblePlugins(
      [
        { file: 'no-default.ts' },
        { file: 'bad-manifest.ts', plugin: { manifest: { id: 'Bad' }, apply: () => {} } },
        { file: 'no-apply.ts', plugin: { manifest: plugin('ws.ok.manifest').manifest } },
        { file: 'good.ts', plugin: plugin('ws.good.one') },
      ],
      services,
    )
    expect(accepted.map(p => p.manifest.id)).toEqual(['ws.good.one'])
    expect(report.rejected.map(r => r.id)).toEqual(['no-default.ts', 'bad-manifest.ts', 'ws.ok.manifest'])
    expect(report.rejected[0].reason).toContain('default')
    expect(report.rejected[1].reason).toContain('id 形状非法')
    expect(report.rejected[2].reason).toContain('apply')
  })

  it('依赖预检：requires 里的服务未提供 → 拒（反证：本树没这服务就别装）', () => {
    const { accepted, report } = assemblePlugins(
      [
        { file: 'needs.ts', plugin: plugin('ws.needs.sandbox', ['session', 'turn']) },
        { file: 'fine.ts', plugin: plugin('ws.fine.one', ['world.info']) },
      ],
      services,
    )
    expect(accepted.map(p => p.manifest.id)).toEqual(['ws.fine.one'])
    expect(report.rejected[0].id).toBe('ws.needs.sandbox')
    expect(report.rejected[0].reason).toContain('未提供依赖服务')
    expect(report.rejected[0].reason).toContain('session')
  })

  it('id 重复：先到者生效，后者拒', () => {
    const { accepted, report } = assemblePlugins(
      [
        { file: 'first.ts', plugin: plugin('ws.dup.one') },
        { file: 'second.ts', plugin: plugin('ws.dup.one') },
      ],
      services,
    )
    expect(accepted.map(p => p.manifest.id)).toEqual(['ws.dup.one'])
    expect(report.rejected).toEqual([{ id: 'ws.dup.one', reason: 'id 重复（先到者生效）' }])
  })
})

describe('真实清单（轻校验：不拉起重图）', () => {
  // 真实插件图（mind-elixir 等）在 vitest 并行下导入 >35s，故本段只做**轻校验**：
  // ① glob **键**发现（装载器扫得到这两个入口）② 真清单形状 + 依赖预检（用轻 manifest 模块）。
  // 真实模块导入路径由真机探针（__WS_WORLD_TREE__）覆盖。
  const indexFiles = Object.keys(import.meta.glob('./../plugins/*/index.ts')).sort()

  it('装载器能扫到树内每个插件的 index.ts（glob 键发现）', () => {
    const has = (id: string) => indexFiles.some(file => file.includes(`/${id}/index.ts`))
    expect(has('mindmap')).toBe(true)
    expect(has('spike-panel')).toBe(true)
    // C2 Stage①：10 个轻芽已迁入
    for (const id of ['timeline', 'organizations', 'culture', 'conflict', 'inspiration', 'apparel', 'outline', 'manuscript', 'drawing', 'notebook']) {
      expect(has(id), `${id} 应在树内`).toBe(true)
    }
  })

  it('启停过滤：isEnabled=false 的插件记进 skipped（**不算拒**），其余照装', () => {
    const { accepted, report } = assemblePlugins(
      [
        { file: 'a.ts', plugin: plugin('official.alpha') },
        { file: 'b.ts', plugin: plugin('official.beta') },
      ],
      services,
      { isEnabled: id => id !== 'official.beta' },
    )
    expect(report.loaded).toEqual(['official.alpha'])
    expect(report.skipped).toEqual(['official.beta'])
    expect(report.rejected).toEqual([])
    // 关掉的插件仍在 accepted 里（交付树，供真启停随时装载）
    expect(accepted.map(p => p.manifest.id)).toEqual(['official.alpha', 'official.beta'])
  })

  it('真清单全部通过校验与依赖预检（含 mindmap 与示例插件）', async () => {
    const { MINDMAP_MANIFEST } = await import('../plugins/mindmap/manifest')
    const { SPIKE_PANEL_MANIFEST } = await import('../plugins/spike-panel/manifest')
    const candidates = [
      { file: 'plugins/mindmap/manifest.ts', plugin: { manifest: MINDMAP_MANIFEST, apply: () => {} } },
      { file: 'plugins/spike-panel/manifest.ts', plugin: { manifest: SPIKE_PANEL_MANIFEST, apply: () => {} } },
    ]
    const { accepted, report } = assemblePlugins(candidates, services)
    expect(report.rejected).toEqual([])
    expect(accepted.map(p => p.manifest.id).sort()).toEqual(['official.mindmap', 'ws.spike.panel'])
  })
})

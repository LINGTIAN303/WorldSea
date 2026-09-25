/**
 * 装载器核心（B 批）：校验 + 依赖预检 + 去重 + 失败隔离（纯函数 `assemblePlugins`）+ 真实清单冒烟。
 *
 * 【反证口径】「非法即拒」不是静默跳过：被拒条目必须出现在 report.rejected 里（id/原因可读），
 * 且**不影响**其余插件装载。
 */
import { describe, expect, it } from 'vitest'
import { assemblePlugins, collectWorldPlugins } from '../loader'
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

describe('collectWorldPlugins（真实清单冒烟）', () => {
  it('扫到示例插件并接受（清单与依赖预检同过）', async () => {
    const { accepted, report } = await collectWorldPlugins(services)
    expect(accepted.map(p => p.manifest.id)).toContain('ws.spike.panel')
    expect(report.rejected).toEqual([])
  })
})

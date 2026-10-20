import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SproutDetailPanel from '../SproutDetailPanel.vue'
import type { SproutInsight } from '@/world/sproutInsights'

const base: SproutInsight = {
  id: 'official.characters',
  label: '角色',
  icon: 'character',
  domain: 'life',
  secondaryDomains: ['society'],
  source: 'builtin',
  active: true,
  runtime: 'loaded',
  viewCount: 1,
  entityTypes: ['character'],
  requires: [],
  outgoing: [{ pluginId: 'official.species', label: '物种', relations: ['属于', '诞生于'] }],
  incoming: [],
  dependencyLimited: false,
}

describe('SproutDetailPanel', () => {
  it('展示域、装载态、入口视图与出依赖', () => {
    const w = mount(SproutDetailPanel, { props: { insight: base } })
    expect(w.text()).toContain('生命与族群')
    expect(w.text()).toContain('社会与文明')
    expect(w.text()).toContain('已装载')
    expect(w.text()).toContain('入口视图：1 个')
    expect(w.text()).toContain('物种')
    expect(w.text()).toContain('2')
  })

  it('未启用显示关闭语义；被拒显示原因', () => {
    const inactive = mount(SproutDetailPanel, {
      props: { insight: { ...base, active: false, runtime: 'skipped', viewCount: 0 } },
    })
    expect(inactive.text()).toContain('未启用')
    expect(inactive.text()).toContain('实体数据保留')

    const rejected = mount(SproutDetailPanel, {
      props: { insight: { ...base, runtime: 'rejected', reason: '清单非法', viewCount: 0 } },
    })
    expect(rejected.text()).toContain('被拒')
    expect(rejected.text()).toContain('清单非法')
  })

  it('纯视图芽解释无依赖；外部缺声明提示依赖受限', () => {
    const pure = mount(SproutDetailPanel, {
      props: { insight: { ...base, entityTypes: [], outgoing: [], incoming: [] } },
    })
    expect(pure.text()).toContain('纯视图芽')

    const external = mount(SproutDetailPanel, {
      props: { insight: { ...base, source: 'external', dependencyLimited: true } },
    })
    expect(external.text()).toContain('仅统计已装载类型')
  })
})

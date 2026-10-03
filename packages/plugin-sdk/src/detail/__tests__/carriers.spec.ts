import { describe, it, expect } from 'vitest'
import { DEFAULT_CARRIER, activeCarrier, allCarriers, carrierPanelId, getCarrier, resolveCarrier } from '../carriers'

/**
 * L1 载体注册表守卫。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 这里锁的是注册表自洽与「写错也得有东西渲染」，
 * 真正的「换容器不换编排」在 components/__tests__/detailCarrier.spec.ts 用挂载验。
 */

describe('载体注册表', () => {
  it('内建两种载体，缺省是右栏抽屉（未声明零变化）', () => {
    expect(allCarriers().map(c => c.carrier)).toEqual(['drawer', 'column'])
    expect(DEFAULT_CARRIER).toBe('drawer')
    expect(getCarrier('drawer')?.mode).toBe('overlay')
    expect(getCarrier('column')?.mode).toBe('split')
  })

  it('每种载体都有可辨识的标签、图标与一句话说明，且带组件', () => {
    for (const def of allCarriers()) {
      expect(def.label, def.carrier).not.toBe('')
      expect(def.icon, def.carrier).not.toBe('')
      expect(def.description, def.carrier).not.toBe('')
      expect(def.component, def.carrier).toBeTruthy()
    }
  })

  it('未注册的 id 回落缺省载体（芽写错或载体被撤，详情不能点不开）', () => {
    expect(activeCarrier('no-such-carrier').carrier).toBe(DEFAULT_CARRIER)
    expect(activeCarrier('column').carrier).toBe('column')
  })

  it('优先序解析只有一处：覆写 > 芽声明 > 缺省', () => {
    expect(resolveCarrier('drawer', 'column')).toBe('drawer')
    expect(resolveCarrier(undefined, 'column')).toBe('column')
    expect(resolveCarrier(undefined, undefined)).toBe(DEFAULT_CARRIER)
    // 空串（设置里清成未设）不该把芽声明顶掉
    expect(resolveCarrier('', 'column')).toBe('column')
  })

  it('宽度键分载体，抽屉沿用历史键名', () => {
    expect(carrierPanelId('drawer', 'character')).toBe('detail-character')
    expect(carrierPanelId('column', 'character')).toBe('detail-column-character')
    // 未注册 id 解析后仍该有自己的键，不许和抽屉撞车
    expect(carrierPanelId('nope', 'character')).toBe('detail-nope-character')
  })
})

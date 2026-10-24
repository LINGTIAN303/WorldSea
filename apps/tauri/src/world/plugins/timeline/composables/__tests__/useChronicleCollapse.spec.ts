/** 编年史分段折叠：localStorage 按项目持久化，重挂载后恢复（风险点 3）。 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useChronicleCollapse } from '../useChronicleCollapse'

describe('编年史分段折叠持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('折叠 / 展开在重新挂载后保持，分组模式遗留 id 不匹配即视为展开', () => {
    const first = useChronicleCollapse()
    expect(first.isCollapsed('unit:era:3')).toBe(false)
    expect(first.isCollapsed('period:p1')).toBe(false)

    first.toggleGroup('unit:era:3')
    expect(first.isCollapsed('unit:era:3')).toBe(true)

    // 模拟视图重载 / 切视图后再挂载
    const second = useChronicleCollapse()
    expect(second.isCollapsed('unit:era:3')).toBe(true)

    second.toggleGroup('unit:era:3')
    expect(useChronicleCollapse().isCollapsed('unit:era:3')).toBe(false)
  })

  it('存储内容非法时回落空集，不抛错', () => {
    localStorage.setItem('worldsea_timeline_collapsed_groups:default', '{bad json')
    const { isCollapsed } = useChronicleCollapse()
    expect(isCollapsed('all')).toBe(false)
  })
})

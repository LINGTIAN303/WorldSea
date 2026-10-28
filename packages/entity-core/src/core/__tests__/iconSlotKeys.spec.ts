import { describe, expect, it } from 'vitest'
import { detailTabIconSlot, domainIconSlot, regionTypeIconSlot } from '../iconOverrides'

describe('图标槽位 key', () => {
  it('语义域 / 详情页 / 区域类型 key 格式', () => {
    expect(domainIconSlot('life')).toBe('domain:life')
    expect(detailTabIconSlot('character', 'family')).toBe('detailTab:character:family')
    expect(detailTabIconSlot('*', 'info')).toBe('detailTab:*:info')
    expect(regionTypeIconSlot('星海')).toBe('regionType:星海')
  })
})

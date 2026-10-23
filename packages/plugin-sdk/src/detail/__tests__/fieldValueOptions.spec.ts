import { describe, expect, it } from 'vitest'
import { normalizeFieldOptions, optionDisplayText } from '../fieldValue'

describe('字段枚举只读展示', () => {
  const options = [
    { value: 'exact', label: '精确' },
    { value: 'approx', label: '约' },
  ]

  it('枚举值映射为中文标签', () => {
    expect(optionDisplayText('exact', options)).toBe('精确')
    expect(optionDisplayText('approx', options)).toBe('约')
  })

  it('空值统一破折号，未知值原样返回', () => {
    expect(optionDisplayText('', options)).toBe('—')
    expect(optionDisplayText(null, options)).toBe('—')
    expect(optionDisplayText('unknown', options)).toBe('unknown')
  })

  it('兼容历史字符串数组选项', () => {
    expect(normalizeFieldOptions(['正史', '废案'])).toEqual([
      { value: '正史', label: '正史' },
      { value: '废案', label: '废案' },
    ])
    expect(optionDisplayText('废案', ['正史', '废案'])).toBe('废案')
  })
})

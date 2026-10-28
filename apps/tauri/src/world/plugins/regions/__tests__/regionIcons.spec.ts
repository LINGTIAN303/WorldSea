import { afterEach, describe, it, expect } from 'vitest'
import { clearEffectiveIconOverrides, regionTypeIconSlot, setEffectiveIconOverrides } from '@worldsea/entity-core/core'
import { resolveLucideIcon } from '@worldsea/ui-kit/components/lucideMap'
import { getIcon } from '@worldsea/ui-kit'
import { regionTypeIcon, regionTypeValues, typeIconMap } from '../regionConfig'

// 2026-10-02 图标消失修复守卫：typeIconMap 的每个值都必须能被 WsIcon 的解析链
//（lucideMap → 图标注册表）解析，否则卡片图标渲染为空白（此前 galaxy/planet 等 7 名缺失）。
function resolves(name: string): boolean {
  return resolveLucideIcon(name) !== null || getIcon(name) !== undefined
}

describe('区域图谱图标映射完整性', () => {
  it('typeIconMap 每个值都能被 WsIcon 解析链解析', () => {
    const missing = Object.entries(typeIconMap)
      .filter(([, icon]) => !resolves(icon))
      .map(([type, icon]) => `${type}→${icon}`)
    expect(missing).toEqual([])
  })

  it('兜底图标 region 可解析', () => {
    expect(resolves('region')).toBe(true)
  })

  it('类型全集去重且覆盖新旧两套下拉', () => {
    expect(new Set(regionTypeValues).size).toBe(regionTypeValues.length)
    expect(regionTypeValues).toContain('星海')
    expect(regionTypeValues).toContain('城市')
    expect(regionTypeValues).toHaveLength(18)
  })

  it('区域类型图标走覆盖层，未知值回退 region', () => {
    expect(regionTypeIcon('大陆')).toBe('map')
    expect(regionTypeIcon(undefined)).toBe('region')
    expect(regionTypeIcon('不存在')).toBe('region')
    setEffectiveIconOverrides(new Map([[regionTypeIconSlot('大陆'), 'flame']]))
    expect(regionTypeIcon('大陆')).toBe('flame')
  })
})

afterEach(() => clearEffectiveIconOverrides())

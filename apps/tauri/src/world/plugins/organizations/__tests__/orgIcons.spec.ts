import { describe, it, expect } from 'vitest'
import { resolveLucideIcon } from '@worldsea/ui-kit/components/lucideMap'
import { getIcon } from '@worldsea/ui-kit'
import { orgTypeIconMap, orgIconOf } from '../organizationConfig'

// 2026-10-02 势力/组织图标消失修复守卫（同 regions/regionIcons.spec 先例）：
// 组织类型→图标映射的每个值都必须能被 WsIcon 解析链解析（lucideMap → 图标注册表），
// 否则渲染为空白。此前 camp（部落）/ church（教会）双注册表缺失。
function resolves(name: string): boolean {
  return resolveLucideIcon(name) !== null || getIcon(name) !== undefined
}

describe('势力/组织图标映射完整性', () => {
  it('orgTypeIconMap 每个值都能被 WsIcon 解析链解析', () => {
    const missing = Object.entries(orgTypeIconMap)
      .filter(([, icon]) => !resolves(icon))
      .map(([type, icon]) => `${type}→${icon}`)
    expect(missing).toEqual([])
  })

  it('orgIconOf 未知类型兜底 organization，且兜底可解析', () => {
    expect(orgIconOf({ properties: { orgType: '不存在的类型' } })).toBe('organization')
    expect(resolves('organization')).toBe(true)
  })
})

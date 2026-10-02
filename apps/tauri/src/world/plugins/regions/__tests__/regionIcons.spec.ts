import { describe, it, expect } from 'vitest'
import { resolveLucideIcon } from '@worldsea/ui-kit/components/lucideMap'
import { getIcon } from '@worldsea/ui-kit'
import { typeIconMap } from '../regionConfig'

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
})

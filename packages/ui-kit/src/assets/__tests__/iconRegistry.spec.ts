import { describe, expect, it } from 'vitest'
import { hasIcon } from '../iconRegistry'
import { hasLucideIcon } from '../../components/lucideMap'

describe('hasIcon facade', () => {
  it('Lucide-only 图标可解析（回归：换图标后显示图标名）', () => {
    expect(hasLucideIcon('book-open')).toBe(true)
    expect(hasIcon('book-open')).toBe(true)
  })

  it('自定义路径图标可解析', () => {
    expect(hasLucideIcon('cat-layout')).toBe(false)
    expect(hasIcon('cat-layout')).toBe(true)
  })

  it('未知图标不可解析', () => {
    expect(hasIcon('not-an-icon')).toBe(false)
  })
})

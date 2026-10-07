/**
 * characters/characterConfig —— autoLink 目标对齐护栏（2026-10-07）
 * 表单侧声明须与 V2 schema（characters/index.ts）一致：race → species。
 * 历史问题：表单侧曾写 'race'（仓内无此实体类型），与 schema 侧双源漂移。
 */
import { describe, it, expect } from 'vitest'
import { characterFields } from '../characterConfig'

interface WithAutoLink {
  autoLink?: { targetType?: string }
}

describe('characterConfig —— autoLink 目标与 V2 schema 对齐', () => {
  it('race → species（而非已不存在的 race 类型）', () => {
    const race = characterFields.find(f => f.key === 'race') as WithAutoLink | undefined
    expect(race?.autoLink?.targetType).toBe('species')
  })

  it('affiliation → organization', () => {
    const aff = characterFields.find(f => f.key === 'affiliation') as WithAutoLink | undefined
    expect(aff?.autoLink?.targetType).toBe('organization')
  })
})

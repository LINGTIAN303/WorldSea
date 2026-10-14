/** 批8：characters ownFields 真源护栏——autoLink 目标对齐（原 characterConfig.spec 迁移，改指 index.ts 导出） */
import { describe, expect, it } from 'vitest'

import { characterOwnFields } from '../index'

interface WithAutoLink {
  autoLink?: { targetType: string; relationType: string }
}

describe('characterOwnFields —— autoLink 目标与 V2 schema 对齐', () => {
  it('race → species / affiliation → organization（belongs_to）', () => {
    const race = characterOwnFields.find(f => f.key === 'race') as WithAutoLink | undefined
    const aff = characterOwnFields.find(f => f.key === 'affiliation') as WithAutoLink | undefined
    expect(race?.autoLink).toEqual({ targetType: 'species', relationType: 'belongs_to' })
    expect(aff?.autoLink).toEqual({ targetType: 'organization', relationType: 'belongs_to' })
  })

  it('批7 漂移修复在位：appearance 为正式字段', () => {
    expect(characterOwnFields.some(f => f.key === 'appearance')).toBe(true)
  })
})

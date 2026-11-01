import { describe, it, expect } from 'vitest'
import { STYLE_PACKS, DEFAULT_STYLE_ID, AXIS_META, READY_STYLE_IDS } from '../packs'
import { REQUIRED_VARS, FORBIDDEN_VARS } from '../contract'

describe('风格包注册表', () => {
  it('包含四套可选风格，默认 mist', () => {
    expect(Object.keys(STYLE_PACKS).sort()).toEqual(['liquid-glass', 'mist', 'neu', 'soft-glass'])
    expect(READY_STYLE_IDS.sort()).toEqual(['liquid-glass', 'mist', 'neu', 'soft-glass'])
    expect(STYLE_PACKS['liquid-glass'].status).toBe('ready')
    expect(DEFAULT_STYLE_ID).toBe('mist')
  })

  it('每套预设的四维默认值都在允许范围内', () => {
    for (const pack of Object.values(STYLE_PACKS)) {
      for (const [key, meta] of Object.entries(AXIS_META)) {
        const value = pack.axes[key as keyof typeof AXIS_META]
        expect(value, `${pack.id}.${key}`).toBeGreaterThanOrEqual(meta.min)
        expect(value, `${pack.id}.${key}`).toBeLessThanOrEqual(meta.max)
      }
    }
  })

  it('契约变量清单无重复且非空', () => {
    expect(REQUIRED_VARS.length).toBeGreaterThan(20)
    expect(new Set(REQUIRED_VARS).size).toBe(REQUIRED_VARS.length)
    expect(new Set(FORBIDDEN_VARS).size).toBe(FORBIDDEN_VARS.length)
  })
})

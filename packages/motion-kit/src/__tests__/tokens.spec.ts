import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DURATION_VALUES, EASING_VALUES } from '../tokens'

const theme = readFileSync(resolve(process.cwd(), 'apps/tauri/src/styles/theme.css'), 'utf8')

function cssVar(name: string): string {
  const m = theme.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`theme.css 缺少 --${name}`)
  return m[1].trim()
}

function msOf(value: string): number {
  return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000
}

describe('motion tokens 与 theme.css 同源', () => {
  it('时长一致', () => {
    expect(msOf(cssVar('dur-instant'))).toBe(DURATION_VALUES.instant)
    expect(msOf(cssVar('dur-fast'))).toBe(DURATION_VALUES.fast)
    expect(msOf(cssVar('dur-base'))).toBe(DURATION_VALUES.normal)
    expect(msOf(cssVar('dur-lg'))).toBe(DURATION_VALUES.slow)
    expect(msOf(cssVar('dur-view'))).toBe(DURATION_VALUES.view)
    expect(msOf(cssVar('dur-surface'))).toBe(DURATION_VALUES.surface)
  })

  it('缓动一致', () => {
    expect(cssVar('ease')).toBe(EASING_VALUES.default)
    expect(cssVar('ease-in')).toBe(EASING_VALUES.in)
    expect(cssVar('ease-out')).toBe(EASING_VALUES.out)
    expect(cssVar('ease-spring')).toBe(EASING_VALUES.spring)
  })
})

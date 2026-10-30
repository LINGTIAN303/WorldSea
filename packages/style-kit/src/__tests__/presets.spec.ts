import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STYLE_PACKS } from '../packs'
import { REQUIRED_VARS, FORBIDDEN_VARS } from '../contract'

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), `packages/style-kit/src/presets/${name}.css`), 'utf8')

describe('预设 CSS 契约', () => {
  it('每套预设定义全部角色变量', () => {
    for (const id of Object.keys(STYLE_PACKS)) {
      const css = read(id)
      for (const v of REQUIRED_VARS) {
        expect(css, `${id} 缺少 ${v}`).toContain(`${v}:`)
      }
    }
  })

  it('预设不得改写文字与语义令牌', () => {
    for (const id of Object.keys(STYLE_PACKS)) {
      const css = read(id)
      for (const v of FORBIDDEN_VARS) {
        expect(css, `${id} 不得定义 ${v}`).not.toContain(`${v}:`)
      }
    }
  })

  it('预设不得引用会被重指向的令牌（防循环）', () => {
    const banned = [
      'var(--bg-app)', 'var(--bg-surface)', 'var(--bg-muted)',
      'var(--border)', 'var(--border-strong)',
      'var(--shadow-sm)', 'var(--shadow-md)', 'var(--shadow-lg)',
      'var(--glass-bg)', 'var(--glass-blur)',
    ]
    for (const id of Object.keys(STYLE_PACKS)) {
      const css = read(id)
      for (const token of banned) {
        expect(css, `${id} 引用了 ${token}`).not.toContain(token)
      }
    }
  })

  it('选择器与风格 id 对应', () => {
    for (const id of Object.keys(STYLE_PACKS)) {
      expect(read(id)).toContain(`html[data-style='${id}']`)
    }
  })
})

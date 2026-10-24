/**
 * enterGuard 单测 —— 就地编辑的 Enter / Esc IME 守卫（2026-10-24 · 13-A）
 *
 * 关键语义：组合期必须「三不」——不提交、不取消、不 preventDefault，
 * 否则中文选词时按 Enter / Esc 会丢掉整段编辑或候选词无法上屏。
 */
import { describe, it, expect } from 'vitest'
import { guardEnter, guardEsc, isImeComposing } from '../board/forms/enterGuard'

function make(over: {
  isComposing?: boolean
  keyCode?: number
  ctrlKey?: boolean
  shiftKey?: boolean
} = {}) {
  let prevented = false
  const ev = {
    isComposing: false,
    keyCode: 13,
    ctrlKey: false,
    shiftKey: false,
    ...over,
    preventDefault: () => { prevented = true },
  } as unknown as KeyboardEvent
  return { ev, prevented: () => prevented }
}

describe('enterGuard / Enter 提交', () => {
  it('普通 Enter：preventDefault 并执行提交', () => {
    const { ev, prevented } = make()
    let ran = 0
    guardEnter(ev, () => { ran++ })
    expect(ran).toBe(1)
    expect(prevented()).toBe(true)
  })

  it('IME 组合期：不提交、不阻止默认（候选词需要上屏）', () => {
    const { ev, prevented } = make({ isComposing: true })
    let ran = 0
    guardEnter(ev, () => { ran++ })
    expect(ran).toBe(0)
    expect(prevented()).toBe(false)
  })

  it('keyCode 229（部分 IME 的组合期信号）同样放行', () => {
    const { ev, prevented } = make({ keyCode: 229 })
    let ran = 0
    guardEnter(ev, () => { ran++ })
    expect(ran).toBe(0)
    expect(prevented()).toBe(false)
  })

  it('ctrl 选项：未按 Ctrl 不提交，按 Ctrl 才提交', () => {
    const a = make()
    let ran = 0
    guardEnter(a.ev, () => { ran++ }, { ctrl: true })
    expect(ran).toBe(0)
    expect(a.prevented()).toBe(false)

    const b = make({ ctrlKey: true })
    guardEnter(b.ev, () => { ran++ }, { ctrl: true })
    expect(ran).toBe(1)
    expect(b.prevented()).toBe(true)
  })

  it('noShift 选项：Shift+Enter 放行（换行），无 Shift 才提交', () => {
    const a = make({ shiftKey: true })
    let ran = 0
    guardEnter(a.ev, () => { ran++ }, { noShift: true })
    expect(ran).toBe(0)
    expect(a.prevented()).toBe(false)

    const b = make()
    guardEnter(b.ev, () => { ran++ }, { noShift: true })
    expect(ran).toBe(1)
    expect(b.prevented()).toBe(true)
  })
})

describe('enterGuard / Esc 取消', () => {
  it('组合期：只关候选窗，不退出编辑、不阻止默认', () => {
    const a = make({ isComposing: true, keyCode: 27 })
    let ran = 0
    guardEsc(a.ev, () => { ran++ })
    expect(ran).toBe(0)
    expect(a.prevented()).toBe(false)
  })

  it('非组合期：preventDefault 并执行取消', () => {
    const b = make({ keyCode: 27 })
    let ran = 0
    guardEsc(b.ev, () => { ran++ })
    expect(ran).toBe(1)
    expect(b.prevented()).toBe(true)
  })
})

describe('enterGuard / isImeComposing', () => {
  it('isComposing 与 keyCode 229 均判为组合期', () => {
    expect(isImeComposing(make({ isComposing: true }).ev)).toBe(true)
    expect(isImeComposing(make({ keyCode: 229 }).ev)).toBe(true)
    expect(isImeComposing(make().ev)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { createModalLayerId, isTopModalLayer, popModalLayer, pushModalLayer } from '../modalStack'

describe('modalStack', () => {
  it('后打开的层在栈顶；关闭后父层恢复栈顶', () => {
    const parent = createModalLayerId()
    const child = createModalLayerId()
    pushModalLayer(parent)
    pushModalLayer(child)
    expect(isTopModalLayer(parent)).toBe(false)
    expect(isTopModalLayer(child)).toBe(true)
    popModalLayer(child)
    expect(isTopModalLayer(parent)).toBe(true)
    popModalLayer(parent)
    expect(isTopModalLayer(parent)).toBe(false)
  })

  it('重复入栈不产生重复层', () => {
    const layer = createModalLayerId()
    pushModalLayer(layer)
    pushModalLayer(layer)
    popModalLayer(layer)
    expect(isTopModalLayer(layer)).toBe(false)
  })
})

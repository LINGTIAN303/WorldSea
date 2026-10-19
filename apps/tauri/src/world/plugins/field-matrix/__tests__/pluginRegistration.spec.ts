import { describe, expect, it, vi } from 'vitest'

vi.mock('../FieldMatrixView.vue', () => ({ default: {} }))

import { apply } from '../index'

describe('字段矩阵芽注册', () => {
  it('注册 view-only 视图并使用壳工具条', () => {
    const registerView = vi.fn()
    apply(null, { registerView } as never)
    expect(registerView).toHaveBeenCalledWith(expect.objectContaining({
      id: 'field-matrix',
      label: '字段矩阵',
      icon: 'grid',
      toolbar: 'bar',
    }))
  })
})

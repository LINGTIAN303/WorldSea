import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HomeMatrixDigest from '../HomeMatrixDigest.vue'
import type { HomeMatrixRow } from '../homeData'

const rows: HomeMatrixRow[] = [
  { type: 'character', label: '角色', sproutLabel: '角色', fieldCount: 12, requiredCount: 2, relationTypeCount: 5 },
  { type: 'concept', label: '概念', sproutLabel: '概念', fieldCount: 8, requiredCount: 1, relationTypeCount: 2 },
]
const stats = { buds: 27, entities: 2, instances: 20, keys: 18, traits: 13, facets: 5 }

describe('HomeMatrixDigest', () => {
  it('渲染静态表、总计与完整矩阵入口', async () => {
    const w = mount(HomeMatrixDigest, { props: { rows, stats, relationTypeCount: 7, matrixViewId: 'field-matrix' } })
    expect(w.findAll('tbody tr')).toHaveLength(2)
    expect(w.find('.home-matrix-foot').text()).toContain('27 芽')
    expect(w.find('.home-matrix-foot').text()).toContain('7 关系类型')
    await w.find('.home-matrix-foot button').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })

  it('矩阵芽未启用：入口隐藏并提示', () => {
    const w = mount(HomeMatrixDigest, { props: { rows, stats, relationTypeCount: 7, matrixViewId: null } })
    expect(w.find('.home-matrix-foot button').exists()).toBe(false)
    expect(w.text()).toContain('启用字段矩阵芽后可查看完整矩阵')
  })

  it('表格无障碍：caption、列头 scope、横向滚动区可聚焦', () => {
    const w = mount(HomeMatrixDigest, { props: { rows, stats, relationTypeCount: 7, matrixViewId: 'field-matrix' } })
    expect(w.find('table caption').text()).toContain('实体类型')
    const ths = w.findAll('th')
    expect(ths).toHaveLength(5)
    expect(ths.every(th => th.attributes('scope') === 'col')).toBe(true)

    const scroll = w.find('.home-matrix-scroll')
    expect(scroll.attributes('role')).toBe('region')
    expect(scroll.attributes('tabindex')).toBe('0')
    expect(scroll.attributes('aria-label')).toContain('字段矩阵')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('@/composables/useProjectSwitcher', () => ({
  useProjectSwitcher: () => ({
    switching: ref(false),
    currentProject: ref({ id: 'p1', name: '纯真', dirPath: 'D:/world', isDefault: false }),
    projectList: ref([]),
    switchProject: vi.fn(),
    refreshProjectList: vi.fn(),
  }),
}))

import ProjectSwitcher from '../ProjectSwitcher.vue'

describe('ProjectSwitcher 品牌位', () => {
  it('showBrand=false 时不渲染 logo/WorldSea，只留项目名与下拉箭头', () => {
    const w = mount(ProjectSwitcher, { props: { variant: 'titlebar', showBrand: false } })
    expect(w.find('.ps-logo').exists()).toBe(false)
    expect(w.find('.ps-title').exists()).toBe(false)
    expect(w.find('.ps-label').text()).toBe('纯真')
    expect(w.find('.ps-chevron').exists()).toBe(true)
  })

  it('默认仍渲染品牌位（兼容旧用法）', () => {
    const w = mount(ProjectSwitcher, { props: { variant: 'titlebar' } })
    expect(w.find('.ps-logo').exists()).toBe(true)
    expect(w.find('.ps-title').exists()).toBe(true)
  })
})

import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setActiveViewId } from '@worldsea/ui-kit'
import MatrixToolbar from '../components/MatrixToolbar.vue'
import type { FieldMatrixStats } from '../model/types'

const stats: FieldMatrixStats = {
  buds: 18,
  entities: 20,
  instances: 246,
  keys: 151,
  traits: 13,
  facets: 13,
}

let wrapper: VueWrapper | undefined
let targets: HTMLElement[] = []

function makeTarget(id: string) {
  const el = document.createElement('div')
  el.id = id
  document.body.appendChild(el)
  targets.push(el)
}

function mountToolbar() {
  wrapper = mount(MatrixToolbar, {
    attachTo: document.body,
    props: {
      stats,
      query: '',
      onlyRequired: false,
      onlyOwn: false,
      typeFilter: '',
      typeOptions: [{ value: 'text', label: '文本' }],
      jumpOptions: [{ value: '#overview', label: '速览' }],
      sidebarCollapsed: false,
    },
  })
  return wrapper
}

beforeEach(() => {
  makeTarget('view-toolbar-search')
  makeTarget('view-toolbar-filter-body')
  makeTarget('view-toolbar-actions')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  targets.forEach(el => el.remove())
  targets = []
  setActiveViewId(null) // view 层快捷键的全局视图上下文按用例各自设置，跑完即清
})

describe('MatrixToolbar', () => {
  it('按壳工具条落点分发控件', () => {
    mountToolbar()
    expect(document.querySelector('#view-toolbar-search .fm-tb-search')).not.toBeNull()
    expect(document.querySelectorAll('#view-toolbar-filter-body .fm-tb-check')).toHaveLength(2)
    expect(document.querySelector('#view-toolbar-filter-body .fm-tb-select')).not.toBeNull()
    expect(document.querySelector('#view-toolbar-actions')?.textContent).toContain('246')
    const labels = Array.from(document.querySelectorAll('#view-toolbar-actions button'))
      .map(button => button.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['清空', '目录']))
  })

  it('搜索与筛选变更回传视图', () => {
    const toolbar = mountToolbar()
    const input = document.querySelector<HTMLInputElement>('#view-toolbar-search input')!
    input.value = '角色'
    input.dispatchEvent(new Event('input'))
    expect(toolbar.emitted('update:query')?.[0]).toEqual(['角色'])

    const required = document.querySelector<HTMLInputElement>('#view-toolbar-filter-body input[type="checkbox"]')!
    required.checked = true
    required.dispatchEvent(new Event('change'))
    expect(toolbar.emitted('update:onlyRequired')?.[0]).toEqual([true])

    const select = document.querySelector<HTMLSelectElement>('#view-toolbar-filter-body select')!
    select.value = 'text'
    select.dispatchEvent(new Event('change'))
    expect(toolbar.emitted('update:typeFilter')?.[0]).toEqual(['text'])
  })

  it('动作与快速跳转回传视图', () => {
    const toolbar = mountToolbar()
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#view-toolbar-actions button'))
    buttons.find(button => button.textContent?.includes('清空'))!.click()
    buttons.find(button => button.textContent?.includes('目录'))!.click()
    expect(toolbar.emitted('clear')).toHaveLength(1)
    expect(toolbar.emitted('toggle-sidebar')).toHaveLength(1)

    const jump = document.querySelector<HTMLSelectElement>('.fm-tb-jump')!
    jump.value = '#overview'
    jump.dispatchEvent(new Event('change'))
    expect(toolbar.emitted('jump')?.[0]).toEqual(['#overview'])
    expect(jump.value).toBe('')
  })

  it('按 / 聚焦搜索（注册表 view 层），Esc 清空搜索与筛选', () => {
    setActiveViewId('field-matrix')
    const toolbar = mountToolbar()
    const input = document.querySelector<HTMLInputElement>('#view-toolbar-search input')!
    // `/` 已收编注册表（整理批）：事件从元素冒泡到 document，由注册表分发器命中 view 层条目
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(document.activeElement).toBe(input)

    // Esc 走搜索框元素级监听（聚焦态行为保留组件内）
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(toolbar.emitted('update:query')?.[0]).toEqual([''])
    expect(toolbar.emitted('update:onlyRequired')?.[0]).toEqual([false])
    expect(toolbar.emitted('update:onlyOwn')?.[0]).toEqual([false])
    expect(toolbar.emitted('update:typeFilter')?.[0]).toEqual([''])
  })
})

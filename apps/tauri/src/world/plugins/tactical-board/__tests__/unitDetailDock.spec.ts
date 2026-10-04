import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useDetailLayoutStore } from '@worldsea/entity-core'
import UnitDetailDock from '../components/UnitDetailDock.vue'

/**
 * 战术棋盘单位详情 dock 的挂载守卫。背景见
 * docs/plans/2026-10-02-实体详情表单地基与形态批计划.md §七之十
 *
 * 锁的是**接入没改观感**：这枚芽历史上就是常驻右栏，所以它声明 `column`；
 * 用户在设置里改过就按用户的来；没有选中单位时两种容器都不该出现。
 * 断言用 DOM 类名而不是组件名——载体组件已不再对外具名导出（入口只剩注册表）。
 */

let pinia: Pinia
let wrapper: VueWrapper | undefined

const UNIT = {
  id: 3, name: '长枪兵', team: 'ally', x: 2, y: 4,
  hp: 30, max_hp: 40, mp: 5, max_mp: 10,
  attack: 7, defense: 3, speed: 5, move: 4, range: 1, level: 2,
} as never

function mountDock(props: Record<string, unknown> = {}) {
  wrapper = mount(UnitDetailDock, {
    props: {
      unit: UNIT,
      showActions: false,
      showDeployActions: false,
      disabled: false,
      detailCarrier: 'column',
      ...props,
    },
    global: { plugins: [pinia] },
  })
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

describe('战术棋盘单位详情 dock', () => {
  it('缺省按芽声明走栏式（不是浮层抽屉），且单位内容在里面', () => {
    const w = mountDock()
    expect(w.find('.detail-column').exists()).toBe(true)
    expect(w.find('.detail-panel').exists()).toBe(false)
    expect(w.text()).toContain('长枪兵')
  })

  it('用户在设置里改过载体就按用户的来（覆写压过芽声明）', () => {
    useDetailLayoutStore().setCarrier('tactical-board', 'drawer')
    const w = mountDock()
    expect(w.find('.detail-panel').exists()).toBe(true)
    expect(w.find('.detail-column').exists()).toBe(false)
  })

  it('没有选中单位时两种容器都不渲染', () => {
    const w = mountDock({ unit: null })
    expect(w.find('.detail-column').exists()).toBe(false)
    expect(w.find('.detail-panel').exists()).toBe(false)
  })

  it('宽度键带载体名：预写 `detail-column-tactical-board` 的宽度，载体就该按它读回', () => {
    // 这条证明 dock 真把 panel-id 透传给了载体，而不是用了默认键（键规则本身在 carriers.spec 锁）
    localStorage.setItem('worldsea_panel_width_detail-column-tactical-board', '411')
    const w = mountDock()
    expect(w.find('.detail-column').attributes('style') || '').toContain('411px')
    // 与抽屉的键不是同一把：抽屉读自己的 `detail-tactical-board`，看不到这个 411
    localStorage.removeItem('worldsea_panel_width_detail-column-tactical-board')
    localStorage.setItem('worldsea_panel_width_detail-tactical-board', '411')
    useDetailLayoutStore().setCarrier('tactical-board', 'drawer')
    const d = mountDock()
    expect(d.find('.detail-panel').attributes('style') || '').toContain('411px')
  })
})

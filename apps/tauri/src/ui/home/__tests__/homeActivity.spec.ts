import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HomeActivity from '../HomeActivity.vue'

const daily = { '2026-10-01': 1, '2026-10-25': 3, '2026-09-15': 2 }

describe('HomeActivity', () => {
  it('热力图 53×7、等级与 aria 摘要', () => {
    const w = mount(HomeActivity, { props: { daily, today: '2026-10-25' } })
    expect(w.findAll('.home-heat-cell')).toHaveLength(371)

    const today = w.find('[data-date="2026-10-25"]')
    expect(today.classes()).toContain('is-l4')
    expect(today.attributes('title')).toContain('3 项内容')
    expect(w.find('.home-heatmap').attributes('aria-label')).toContain('最高一天 3 项内容')
    expect(w.find('.home-heat-months').text()).toContain('10月')
    expect(w.findAll('.home-heat-legend i')).toHaveLength(5)
  })

  it('月历：今天标记、计数、翻月与月度统计', async () => {
    const w = mount(HomeActivity, { props: { daily, today: '2026-10-25' } })
    expect(w.find('.home-calendar-title').text()).toBe('2026 年 10 月')
    expect(w.findAll('.home-calendar th')).toHaveLength(7)

    const today = w.findAll('.home-calendar td').find(td => td.text() === '25')!
    expect(today.classes()).toContain('is-today')
    expect(today.classes()).toContain('is-l4')
    expect(today.attributes('title')).toContain('3 项内容')
    expect(w.find('.home-calendar-foot').text()).toContain('2 天有更新')
    expect(w.find('.home-calendar-foot').text()).toContain('4 项内容')

    const [prev, next] = w.findAll('.home-calendar-nav')
    expect(next.attributes('disabled')).toBeDefined()
    await prev.trigger('click')
    expect(w.find('.home-calendar-title').text()).toBe('2026 年 9 月')
    expect(w.findAll('.home-calendar-nav')[1].attributes('disabled')).toBeUndefined()
    await w.findAll('.home-calendar-nav')[1].trigger('click')
    expect(w.find('.home-calendar-title').text()).toBe('2026 年 10 月')
  })
})

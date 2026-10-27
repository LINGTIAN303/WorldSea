import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import IconPicker from '../plugins/settings/panels/IconPicker.vue'
import type { IconPickerTarget } from '../iconPanelModel'

const baseTarget: IconPickerTarget = {
  key: 'sprout:official.concepts',
  kind: 'sprout',
  label: '概念/设定库',
  current: 'concept',
  source: 'default',
  domain: 'knowledge',
  syncCount: 1,
  syncDefault: true,
  canResetProject: false,
}

let wrapper: VueWrapper | null = null

function mountPicker(overrides: Partial<IconPickerTarget> = {}): VueWrapper {
  wrapper = mount(IconPicker, {
    props: { show: true, target: { ...baseTarget, ...overrides } },
    attachTo: document.body,
    global: { stubs: { teleport: true, transition: false } },
  })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('IconPicker', () => {
  it('按中文搜索并确认选中图标', async () => {
    const w = mountPicker()
    await w.find('.ip-search').setValue('概念')
    await nextTick()
    const tile = w.findAll('.ip-tile').find(item => item.attributes('aria-label') === '概念')
    expect(tile).toBeTruthy()
    await tile!.trigger('click')
    await w.find('.ip-btn-primary').trigger('click')
    expect(w.emitted('confirm')?.[0]?.[0]).toEqual({ icon: 'concept', applyGlobal: false, syncTypes: true })
  })

  it('同步控件按目标默认态勾选', async () => {
    const w = mountPicker()
    const checks = w.findAll('.ip-option input')
    expect((checks[0].element as HTMLInputElement).checked).toBe(true)
    await checks[1].setValue(true)
    await w.find('.ip-btn-primary').trigger('click')
    expect(w.emitted('confirm')?.[0]?.[0]).toMatchObject({ applyGlobal: true, syncTypes: true })
  })

  it('多实体类型时默认不勾选同步', async () => {
    const w = mountPicker({ syncCount: 2, syncDefault: false })
    const checks = w.findAll('.ip-option input')
    expect((checks[0].element as HTMLInputElement).checked).toBe(false)
  })

  it('项目覆盖时可撤销本项目设置', async () => {
    const w = mountPicker({ source: 'project', canResetProject: true })
    await w.find('.ip-btn-ghost').trigger('click')
    expect(w.emitted('reset')).toHaveLength(1)
  })

  it('当前图标不在精选库时显式提示', async () => {
    const w = mountPicker({ current: 'ws.custom-icon' })
    expect(w.text()).toContain('不在精选库')
  })

  it('按域过滤只显示该域图标', async () => {
    const w = mountPicker()
    const chip = w.findAll('.ip-chip').find(item => item.text() === '知识与规则')
    expect(chip).toBeTruthy()
    await chip!.trigger('click')
    await nextTick()
    const labels = w.findAll('.ip-tile').map(item => item.attributes('aria-label'))
    expect(labels).toContain('概念')
    expect(labels).not.toContain('地图')
  })
})

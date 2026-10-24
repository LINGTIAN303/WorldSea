/** 冲突面板定位：条目与事件 chip 都带出对位方，供两态同时高亮。 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConflictDetector from '../ConflictDetector.vue'
import type { Conflict } from '../../composables/useConflictDetection'

const conflict: Conflict = {
  type: 'overlap',
  scope: 'time',
  description: '某角色参与了时间重叠的事件',
  entities: ['事件一', '事件二'],
  eventIds: ['e1', 'e2'],
  date: '第一纪元10年',
  fuzzy: false,
}

function mountPanel() {
  return mount(ConflictDetector, {
    props: { show: true, conflicts: [conflict], mode: 'time' },
    global: { stubs: { TuiModal: { template: '<div><slot name="header" /><slot /></div>' }, WsIcon: true } },
  })
}

describe('冲突面板定位', () => {
  it('点条目：第一个事件为定位方，另一方为对位', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.cf-item').trigger('click')
    expect(wrapper.emitted('focus')).toEqual([['e1', 'e2']])
  })

  it('点第二个事件 chip：以它为定位方，第一个为对位', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.cf-entity')[1].trigger('click')
    expect(wrapper.emitted('focus')).toEqual([['e2', 'e1']])
  })
})

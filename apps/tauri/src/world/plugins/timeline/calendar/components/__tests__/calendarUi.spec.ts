import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TimePointInput from '../TimePointInput.vue'
import CalendarEditorPanel from '../CalendarEditorPanel.vue'
import { createSimpleCalendar, createThreeEraCalendar } from '../../defaults'

const simple = createSimpleCalendar()

function mountInput(value = '第三纪元147年') {
  return mount(TimePointInput, {
    props: { modelValue: value, calendar: simple },
  })
}

describe('TimePointInput 双通道日期录入', () => {
  it('结构化输入：改纪元后输出规范文本', async () => {
    const w = mountInput()
    const numbers = w.findAll('.tp-fields input[type="number"]')
    expect(numbers.map(input => (input.element as HTMLInputElement).value)).toEqual(['3', '147'])
    await numbers[0].setValue('4')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toBe('第四纪元147年')
  })

  it('文本输入：合法日期解析后回到规范文本', async () => {
    const w = mountInput('第三纪元147年')
    await w.find('.tp-mode-btn').trigger('click')
    const input = w.find('.tp-text-input')
    await input.setValue('第二纪元50年')
    await input.trigger('blur')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toBe('第二纪元50年')
    expect(w.find('.tp-error').exists()).toBe(false)
  })

  it('文本输入：非法日期显示错误并保留原文', async () => {
    const w = mountInput('第三纪元147年')
    await w.find('.tp-mode-btn').trigger('click')
    const input = w.find('.tp-text-input')
    await input.setValue('不可考')
    await input.trigger('blur')
    expect(w.find('.tp-error').text()).toContain('无法按当前历法解析')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toBe('不可考')
  })

  it('前缀模糊词解析为 certainty，正文保持纯日期', async () => {
    const w = mountInput('第三纪元147年')
    await w.find('.tp-mode-btn').trigger('click')
    const input = w.find('.tp-text-input')
    await input.setValue('约 第三纪元147年')
    await input.trigger('blur')
    expect(w.emitted('update:certainty')!.at(-1)![0]).toBe('approx')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toBe('第三纪元147年')
  })
})

describe('CalendarEditorPanel 历法编辑', () => {
  const calendar = createThreeEraCalendar()

  function mountPanel() {
    return mount(CalendarEditorPanel, {
      props: { show: true, calendars: [calendar], activeId: calendar.id },
      global: { stubs: { teleport: true } },
    })
  }

  it('打开时载入激活历法，保存回传同一历法', async () => {
    const w = mountPanel()
    const name = w.find('.cp-name')
    expect((name.element as HTMLInputElement).value).toBe('三纪元历法')
    await name.setValue('我的历法')
    await w.find('.cp-primary').trigger('click')
    const saved = w.emitted('save')!.at(-1)![0] as { id: string; name: string }
    expect(saved.id).toBe('three-era')
    expect(saved.name).toBe('我的历法')
  })

  it('非法命名值长度会阻断保存并展示错误', async () => {
    const w = mountPanel()
    const length = w.findAll('.nv-length')[0]
    await length.setValue('')
    expect(w.find('.cp-primary').attributes('disabled')).toBeDefined()
    expect(w.find('.cp-errors').text()).toContain('缺少长度')
  })

  it('新建预设走 save 事件，id 不与内置模板冲突', async () => {
    const w = mountPanel()
    const selects = w.findAll('.cp-toolbar select')
    await selects[1].setValue('gregorian')
    const create = w.findAll('.cp-btn').find(button => button.text() === '新建')!
    await create.trigger('click')
    const saved = w.emitted('save')!.at(-1)![0] as { id: string; units: unknown[] }
    expect(saved.id.startsWith('gregorian-')).toBe(true)
    expect(saved.units.length).toBeGreaterThan(3)
  })

  it('删除与设为默认走独立事件', async () => {
    const w = mountPanel()
    const activate = w.findAll('.cp-btn').find(button => button.text() === '设为默认')!
    await activate.trigger('click')
    expect(w.emitted('activate')).toBeTruthy()
    const remove = w.findAll('.cp-btn').find(button => button.text() === '删除')!
    await remove.trigger('click')
    expect(w.emitted('remove')![0][0]).toBe('three-era')
  })
})

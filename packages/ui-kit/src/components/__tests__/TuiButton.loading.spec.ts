import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TuiButton from '../TuiButton.vue'

describe('TuiButton loading（批 5 统一）', () => {
  it('loading 时用 WsInlineLoading 星轨并禁用', () => {
    const wrapper = mount(TuiButton, {
      props: { loading: true },
      slots: { default: '保存' },
    })
    expect(wrapper.find('.ws-inline-loading').exists()).toBe(true)
    expect(wrapper.find('.tui-btn__spin').exists()).toBe(false)
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('保存')
  })

  it('非 loading 时不出现星轨、不禁用', () => {
    const wrapper = mount(TuiButton, { props: { icon: 'edit' } })
    expect(wrapper.find('.ws-inline-loading').exists()).toBe(false)
    expect(wrapper.attributes('disabled')).toBeUndefined()
  })
})

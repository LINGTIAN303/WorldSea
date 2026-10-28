import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WsIcon from '../WsIcon.vue'
import { hasCustomIcon, registerCustomIconResolver, resolveCustomIcon } from '../customIconResolver'
import { hasIcon } from '../../assets/iconRegistry'

afterEach(() => registerCustomIconResolver(null))

describe('customIconResolver', () => {
  it('只解析已注册的 custom: 名', () => {
    expect(resolveCustomIcon('custom:abc')).toBeNull()
    registerCustomIconResolver(id => id === 'abc' ? { src: 'asset://localhost/abc.svg' } : null)
    expect(resolveCustomIcon('custom:abc')).toEqual({ src: 'asset://localhost/abc.svg' })
    expect(resolveCustomIcon('custom:missing')).toBeNull()
    expect(resolveCustomIcon('user')).toBeNull()
    expect(hasCustomIcon('custom:abc')).toBe(true)
    expect(hasIcon('custom:abc')).toBe(true)
  })

  it('WsIcon 自定义图标走蒙版节点，不渲染内置图标', () => {
    registerCustomIconResolver(() => ({ src: 'asset://localhost/demo.svg' }))
    const wrapper = mount(WsIcon, { props: { name: 'custom:demo', size: 'sm' } })
    expect(wrapper.find('.ws-icon--custom').exists()).toBe(true)
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.attributes('style') ?? '').toContain('asset://localhost/demo.svg')
    wrapper.unmount()
  })
})

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WsIcon from '../../../components/WsIcon.vue'
import { hasIcon } from '../../iconRegistry'
import {
  ICON_PACKS,
  getIconPack,
  hasPackIcon,
  packIconFullName,
  parsePackIconName,
  resolvePackIcon,
  searchPackIcons,
} from '../index'

describe('内置图标包注册表', () => {
  it('包含多套精选包与包名解析', () => {
    expect(ICON_PACKS.length).toBeGreaterThanOrEqual(14)
    expect(getIconPack('ph')?.label).toBe('Phosphor')
    expect(packIconFullName('ph', 'home')).toBe('ph:home')
    expect(parsePackIconName('ph:home')).toMatchObject({ iconName: 'home' })
    expect(parsePackIconName('unknown:home')).toBeNull()
    expect(parsePackIconName('home')).toBeNull()
    expect(resolvePackIcon('ph:house')?.icon.label).toBe('房屋')
    expect(hasPackIcon('ip-color:home')).toBe(true)
    expect(hasIcon('ph:house')).toBe(true)
    expect(hasIcon('no-such-pack:home')).toBe(false)
  })

  it('彩色包保留原色模式，搜索可按包/语义域过滤', () => {
    expect(getIconPack('ip-color')?.colorMode).toBe('color')
    expect(getIconPack('ph')?.colorMode).toBe('mono')
    const geo = searchPackIcons('房屋', 'all', 'geo')
    expect(geo.some(entry => entry.name === 'ph:house')).toBe(true)
    expect(geo.every(entry => entry.domains.includes('geo'))).toBe(true)
    expect(searchPackIcons('', 'ph').every(entry => entry.packId === 'ph')).toBe(true)
  })

  it('生成 body 不含脚本，且 WsIcon 可直接渲染包图标', () => {
    for (const pack of ICON_PACKS) {
      for (const icon of Object.values(pack.icons)) {
        expect(icon.body).not.toMatch(/<script|<foreignObject/i)
      }
    }
    const wrapper = mount(WsIcon, { props: { name: 'ph:house', size: 'sm' } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('.ws-icon--custom').exists()).toBe(false)
    wrapper.unmount()

    // 数字尺寸不能落到自定义图标的 mask 类上，否则彩色包会被压成灰块
    const colored = mount(WsIcon, { props: { name: 'ip-color:home', size: 16 } })
    expect(colored.find('svg').classes()).not.toContain('ws-icon--custom')
    colored.unmount()
  })
})

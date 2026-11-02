/** BackgroundTargetMap：工作台/首页映射点选、大背景卡片、状态文案与选图锁定。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { BACKGROUND_TARGETS, BACKGROUND_THEMES, useBackground } from '@worldsea/style-kit'
import BackgroundTargetMap from '../BackgroundTargetMap.vue'

enableAutoUnmount(afterEach)

const props = { scope: 'global' as const, map: 'workspace' as const, selected: 'titlebar' as const, disabled: false }

const api = useBackground()

function defaultTargets() {
  return {
    enabled: false,
    fit: 'cover' as const,
    focusX: 50 as const,
    focusY: 50 as const,
    dim: 35,
    blur: 8,
    paths: { light: '', dark: '' },
  }
}

beforeEach(() => {
  api.setProjectConfig(null)
  for (const target of BACKGROUND_TARGETS) {
    for (const theme of BACKGROUND_THEMES) api.clearTargetImage(target, theme, 'global')
    api.updateTarget(target, defaultTargets(), 'global')
  }
  api.flushGlobal()
  localStorage.clear()
})

describe('BackgroundTargetMap', () => {
  it('工作台四区可点选，首页切换发事件', async () => {
    const w = mount(BackgroundTargetMap, { props })
    const labels = w.findAll('.bg-map__region').map((b) => b.text())
    expect(labels.some((t) => t.includes('窗口栏'))).toBe(true)
    expect(labels.some((t) => t.includes('侧栏'))).toBe(true)
    expect(labels.some((t) => t.includes('工具条'))).toBe(true)
    expect(labels.some((t) => t.includes('视图'))).toBe(true)
    await w.find('.bg-map__region--sidebar').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['sidebar'])
    await w.findAll('.bg-map__switch button')[1].trigger('click')
    expect(w.emitted('switch-map')?.[0]).toEqual(['home'])
  })

  it('首页地图整页点选 home，封面不抢点击', async () => {
    const w = mount(BackgroundTargetMap, { props: { ...props, map: 'home', selected: 'home' } })
    expect(w.find('.bg-map__home-cover').text()).toContain('项目封面')
    await w.find('.bg-map__home').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['home'])
    // 封面块无自身点选：点击冒泡回整图，仍是 home
    await w.find('.bg-map__home-cover').trigger('click')
    expect(w.emitted('select')?.[1]).toEqual(['home'])
  })

  it('地图切换有固定舞台，不随视图塌高', () => {
    const w = mount(BackgroundTargetMap, { props })
    const stage = w.find('.bg-map__stage')
    expect(stage.exists()).toBe(true)
    expect(stage.find('.bg-map__viewport--workspace').exists()).toBe(true)
  })

  it('大背景卡片点选 canvas，选中展开', async () => {
    const w = mount(BackgroundTargetMap, { props })
    await w.find('.bg-canvas-card').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['canvas'])
    expect(w.find('.bg-canvas-card').classes()).not.toContain('is-selected')
    const selected = mount(BackgroundTargetMap, { props: { ...props, selected: 'canvas' } })
    expect(selected.find('.bg-canvas-card').classes()).toContain('is-selected')
  })

  it('选图期间锁定所有点选', async () => {
    const w = mount(BackgroundTargetMap, { props: { ...props, disabled: true } })
    expect(w.find('.bg-map__region--sidebar').attributes('disabled')).toBeDefined()
    expect(w.find('.bg-map__switch button').attributes('disabled')).toBeDefined()
    expect(w.find('.bg-canvas-card').attributes('disabled')).toBeDefined()
  })

  it('状态文案：未设置 / 开 / 关 / 缺图', async () => {
    const w = mount(BackgroundTargetMap, { props })
    const state = () => w.find('.bg-map__region--titlebar .bg-map__state')
    expect(state().text()).toBe('未设置')
    expect(state().attributes('data-state')).toBe('unset')

    api.setTargetImage('titlebar', 'light', { path: 'C:/bg/a.webp', src: 'asset://a.webp' }, 'global')
    await nextTick()
    expect(state().text()).toBe('开')
    expect(state().attributes('data-state')).toBe('on')

    api.updateTarget('titlebar', { enabled: false }, 'global')
    await nextTick()
    expect(state().text()).toBe('关')
    expect(state().attributes('data-state')).toBe('off')

    api.markMissing('titlebar', 'light', 'global')
    api.markMissing('titlebar', 'dark', 'global')
    await nextTick()
    expect(state().text()).toBe('缺图')
    expect(state().attributes('data-state')).toBe('missing')
  })

  it('项目范围跟随全局显示跟随，大背景卡片同样显示状态', async () => {
    api.setProjectConfig({ version: 1, targets: {} })
    const w = mount(BackgroundTargetMap, { props: { ...props, scope: 'project' } })
    const state = w.find('.bg-map__region--sidebar .bg-map__state')
    expect(state.text()).toBe('跟随')
    expect(state.attributes('data-state')).toBe('follow')
    expect(w.find('.bg-canvas-card__state').attributes('data-state')).toBe('follow')
  })

  it('预览跟随编辑范围：全局看全局图，项目自定义看项目图', async () => {
    api.setTargetImage('sidebar', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    const w = mount(BackgroundTargetMap, { props })
    const layerStyle = () => w.find('.bg-map__region--sidebar .ws-bg-layer').attributes('style') ?? ''
    expect(layerStyle()).toContain('asset://g.webp')

    api.setProjectConfig({
      version: 1,
      targets: {
        sidebar: {
          ...defaultTargets(),
          enabled: true,
          paths: { light: '.worldsea/backgrounds/p.webp', dark: '' },
        },
      },
    })
    api.setTargetImage('sidebar', 'light', {
      path: '.worldsea/backgrounds/p.webp',
      src: 'asset://p.webp',
    }, 'project')
    await w.setProps({ scope: 'project' })
    await nextTick()
    expect(layerStyle()).toContain('asset://p.webp')

    api.setProjectConfig({ version: 1, targets: {} })
    await nextTick()
    expect(w.find('.bg-map__region--sidebar .bg-map__state').text()).toBe('跟随')
    expect(layerStyle()).toContain('asset://g.webp')
  })
})

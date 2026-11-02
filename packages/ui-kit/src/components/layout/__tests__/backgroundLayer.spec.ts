import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BackgroundLayer from '../BackgroundLayer.vue'
import { useBackground } from '@worldsea/style-kit'

const api = useBackground()

describe('BackgroundLayer', () => {
  beforeEach(() => {
    api.clear()
    localStorage.clear()
  })

  it('目标有图且启用时渲染', async () => {
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    const w = mount(BackgroundLayer, { props: { target: 'canvas' } })
    expect(w.find('.ws-bg-layer--canvas').exists()).toBe(true)
  })

  it('预览模式在关闭态也渲染', async () => {
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    api.updateTarget('canvas', { enabled: false }, 'global')
    const w = mount(BackgroundLayer, { props: { target: 'canvas', preview: true } })
    expect(w.find('.ws-bg-layer').exists()).toBe(true)
  })

  it('双主题都缺失不渲染', async () => {
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    api.markMissing('canvas', 'light', 'global')
    api.markMissing('canvas', 'dark', 'global')
    const w = mount(BackgroundLayer, { props: { target: 'canvas' } })
    expect(w.find('.ws-bg-layer').exists()).toBe(false)
  })
})

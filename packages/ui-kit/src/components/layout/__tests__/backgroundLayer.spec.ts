import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BackgroundLayer from '../BackgroundLayer.vue'
import { BACKGROUND_TARGETS, BACKGROUND_THEMES, useBackground } from '@worldsea/style-kit'

const api = useBackground()

/** 模块单例跨用例复用：逐目标清图、复位参数与项目覆盖，避免串扰 */
function reset() {
  api.setProjectConfig(null)
  for (const target of BACKGROUND_TARGETS) {
    for (const theme of BACKGROUND_THEMES) api.clearTargetImage(target, theme, 'global')
    api.updateTarget(target, {
      enabled: false, fit: 'cover', focusX: 50, focusY: 50, dim: 35, blur: 8,
    }, 'global')
  }
  localStorage.clear()
}

describe('BackgroundLayer', () => {
  beforeEach(() => {
    reset()
  })

  it('目标有图且启用时渲染', () => {
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    const w = mount(BackgroundLayer, { props: { target: 'canvas' } })
    expect(w.find('.ws-bg-layer--canvas').exists()).toBe(true)
  })

  it('预览模式在关闭态也渲染', () => {
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    api.updateTarget('canvas', { enabled: false }, 'global')
    const w = mount(BackgroundLayer, { props: { target: 'canvas', preview: true } })
    expect(w.find('.ws-bg-layer').exists()).toBe(true)
  })

  it('双主题都缺失不渲染', () => {
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    api.markMissing('canvas', 'light', 'global')
    api.markMissing('canvas', 'dark', 'global')
    const w = mount(BackgroundLayer, { props: { target: 'canvas' } })
    expect(w.find('.ws-bg-layer').exists()).toBe(false)
  })

  it('scope 预览按范围取图：全局范围显示全局图，项目自定义无图时项目范围隐藏', () => {
    api.setTargetImage('canvas', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    api.setTargetCustom('canvas', true)
    // 项目自定义遮住生效范围：生效范围与项目范围都无图
    expect(mount(BackgroundLayer, { props: { target: 'canvas', preview: true } })
      .find('.ws-bg-layer').exists()).toBe(false)
    expect(mount(BackgroundLayer, { props: { target: 'canvas', scope: 'project', preview: true } })
      .find('.ws-bg-layer').exists()).toBe(false)
    // 全局范围仍按全局配置预览，并用内联变量注入图片
    const globalPreview = mount(BackgroundLayer, { props: { target: 'canvas', scope: 'global', preview: true } })
    const el = globalPreview.find('.ws-bg-layer')
    expect(el.exists()).toBe(true)
    expect((el.element as HTMLElement).style.getPropertyValue('--layer-image')).toContain('asset://g.webp')
  })

  it('项目范围有自定义图时渲染项目图', () => {
    api.setTargetImage('canvas', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    api.setTargetCustom('canvas', true)
    api.setTargetSrcs('canvas', { light: 'asset://p.webp', dark: '' }, 'project')
    api.updateTarget('canvas', { enabled: true }, 'project')
    const w = mount(BackgroundLayer, { props: { target: 'canvas', scope: 'project' } })
    expect(w.find('.ws-bg-layer').exists()).toBe(true)
    expect((w.find('.ws-bg-layer').element as HTMLElement).style.getPropertyValue('--layer-image'))
      .toContain('asset://p.webp')
  })

  it('项目范围跟随全局时隐藏，不回退生效/全局图', () => {
    api.setTargetImage('canvas', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    api.updateTarget('canvas', { enabled: true }, 'global')
    // 无项目自定义目标：项目范围不得回退到生效配置（旧实现会显示全局图）
    expect(mount(BackgroundLayer, { props: { target: 'canvas', scope: 'project', preview: true } })
      .find('.ws-bg-layer').exists()).toBe(false)
    expect(mount(BackgroundLayer, { props: { target: 'canvas', scope: 'project' } })
      .find('.ws-bg-layer').exists()).toBe(false)
    // 全局范围照常显示
    expect(mount(BackgroundLayer, { props: { target: 'canvas', scope: 'global', preview: true } })
      .find('.ws-bg-layer').exists()).toBe(true)
  })

  it('本项目自定义无图时全局范围预览可见、项目范围隐藏', () => {
    api.setTargetImage('canvas', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    api.updateTarget('canvas', { enabled: true }, 'global')
    api.setTargetCustom('canvas', true)
    expect(mount(BackgroundLayer, { props: { target: 'canvas', scope: 'global', preview: true } })
      .find('.ws-bg-layer').exists()).toBe(true)
    expect(mount(BackgroundLayer, { props: { target: 'canvas', scope: 'project', preview: true } })
      .find('.ws-bg-layer').exists()).toBe(false)
  })

  it('previewTheme 覆盖预览亮暗，不依赖 document 主题', async () => {
    api.setTargetImage('canvas', 'light', { path: '/l.webp', src: 'asset://light.webp' }, 'global')
    api.setTargetImage('canvas', 'dark', { path: '/d.webp', src: 'asset://dark.webp' }, 'global')
    const w = mount(BackgroundLayer, {
      props: { target: 'canvas', scope: 'global', preview: true, previewTheme: 'dark' },
    })
    const style = () => (w.find('.ws-bg-layer').element as HTMLElement).style.getPropertyValue('--layer-image')
    expect(style()).toContain('asset://dark.webp')
    await w.setProps({ previewTheme: 'light' })
    await nextTick()
    expect(style()).toContain('asset://light.webp')
  })
})

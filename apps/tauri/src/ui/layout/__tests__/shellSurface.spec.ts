import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ShellSurface from '../ShellSurface.vue'

const slots = {
  home: '<div class="home-stub">home</div>',
  workspace: '<div class="ws-stub">workspace</div>',
}

function displayOf(w: VueWrapper, surface: string): string {
  return (w.find(`[data-surface="${surface}"]`).element as HTMLElement).style.display
}

afterEach(() => {
  vi.useRealTimers()
  delete document.documentElement.dataset.reduceMotion
  delete document.documentElement.dataset.animNav
})

describe('ShellSurface 表面切换', () => {
  it('工作台启动：首页不挂载、工作台可见', () => {
    const w = mount(ShellSurface, { props: { surface: 'workspace' }, slots })
    expect(w.find('[data-surface="home"]').exists()).toBe(false)
    expect(displayOf(w, 'workspace')).not.toBe('none')
  })

  it('切到首页：首页覆盖层出现，工作台延后隐藏', async () => {
    vi.useFakeTimers()
    const w = mount(ShellSurface, { props: { surface: 'workspace' }, slots })
    await w.setProps({ surface: 'home' })
    expect(w.find('.shell-home-layer').exists()).toBe(true)
    expect(displayOf(w, 'workspace')).not.toBe('none')
    vi.advanceTimersByTime(180)
    await w.vm.$nextTick()
    expect(displayOf(w, 'workspace')).toBe('none')
  })

  it('切回工作台：立即显示，不等计时器', async () => {
    vi.useFakeTimers()
    const w = mount(ShellSurface, { props: { surface: 'workspace' }, slots })
    await w.setProps({ surface: 'home' })
    await w.setProps({ surface: 'workspace' })
    expect(displayOf(w, 'workspace')).not.toBe('none')
  })

  it('减弱动效时立即隐藏工作台', async () => {
    document.documentElement.dataset.reduceMotion = 'on'
    const w = mount(ShellSurface, { props: { surface: 'workspace' }, slots })
    await w.setProps({ surface: 'home' })
    expect(displayOf(w, 'workspace')).toBe('none')
  })

  it('关闭导航动效时立即隐藏工作台', async () => {
    document.documentElement.dataset.animNav = 'off'
    const w = mount(ShellSurface, { props: { surface: 'workspace' }, slots })
    await w.setProps({ surface: 'home' })
    expect(displayOf(w, 'workspace')).toBe('none')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, onUnmounted } from 'vue'
import ShellSurface from '../ShellSurface.vue'

describe('ShellSurface', () => {
  it('首页/工作台互斥可见，main 唯一，inert/busy 透传', async () => {
    const w = mount(ShellSurface, {
      props: { surface: 'home' },
      slots: { home: '<div class="home-slot">home</div>', workspace: '<div class="work-slot">work</div>' },
    })
    const main = w.find('main#main-content')
    expect(main.exists()).toBe(true)
    expect(main.classes()).toContain('is-home')
    expect(w.find('[data-surface="home"]').attributes('style') ?? '').not.toContain('display: none')
    expect(w.find('[data-surface="workspace"]').attributes('style') ?? '').toContain('display: none')

    await w.setProps({
      surface: 'workspace',
      inert: true,
      busy: true,
      workspaceClass: { 'sidebar-right': true },
    })
    const main2 = w.find('main#main-content')
    expect(main2.classes()).toContain('shell-body')
    expect(main2.classes()).toContain('sidebar-right')
    expect(w.find('[data-surface="workspace"]').attributes('style') ?? '').not.toContain('display: none')
    expect(w.find('[data-surface="home"]').exists()).toBe(false)
    expect(main2.attributes('inert')).toBeDefined()
    expect(main2.attributes('aria-busy')).toBe('true')
  })

  it('切换表面不卸载工作台子树（ViewContainer 的 Teleport 目标须常驻）', async () => {
    const unmounted = vi.fn()
    const WorkspaceChild = defineComponent({
      setup() {
        onUnmounted(unmounted)
        return () => h('div', { class: 'ws-child' })
      },
    })
    const w = mount(ShellSurface, {
      props: { surface: 'workspace' },
      slots: { workspace: () => h(WorkspaceChild) },
    })
    await w.setProps({ surface: 'home' })
    expect(unmounted).not.toHaveBeenCalled()
    expect(w.find('.ws-child').exists()).toBe(true)
  })
})

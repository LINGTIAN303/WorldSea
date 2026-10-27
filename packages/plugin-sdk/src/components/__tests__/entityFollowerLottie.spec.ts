// F4 守卫：追踪浮层 Lottie 微型控制条——仅 lottie 显示；暂停/恢复调用渲染器；点形象仍可播放。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { pauseSpy, resumeSpy, playSpy } = vi.hoisted(() => ({
  pauseSpy: vi.fn(),
  resumeSpy: vi.fn(),
  playSpy: vi.fn(),
}))

vi.mock('../PortraitRenderer.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'PortraitRenderer',
      props: ['src', 'kind', 'alt', 'autoplay', 'actions', 'motion'],
      setup(_, { expose }) {
        expose({ play: playSpy, pause: pauseSpy, resume: resumeSpy })
        return () => h('div', { class: 'pr-stub' })
      },
    }),
  }
})

import EntityFollower from '../EntityFollower.vue'

const base = {
  id: 'chr-1', type: 'character', name: '凉', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  pauseSpy.mockClear()
  resumeSpy.mockClear()
  playSpy.mockClear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.querySelector('.efollower')?.remove()
})

function mountFollower(entity: Record<string, unknown>) {
  wrapper = mount(EntityFollower, { props: { entity: entity as never }, attachTo: document.body })
  return wrapper
}

const control = () => document.querySelector('.ef-play') as HTMLButtonElement | null

describe('EntityFollower —— Lottie 控制条（F4）', () => {
  it('lottie 形象显示控制条：暂停 → 恢复，图标状态切换', async () => {
    mountFollower({ ...base, portrait: 'http://x/a.json', portraitKind: 'lottie' })
    expect(control()).toBeTruthy()
    expect(control()!.getAttribute('aria-label')).toBe('暂停')

    control()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(pauseSpy).toHaveBeenCalledTimes(1)
    expect(control()!.getAttribute('aria-label')).toBe('播放')

    control()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(resumeSpy).toHaveBeenCalledTimes(1)
    expect(control()!.getAttribute('aria-label')).toBe('暂停')
  })

  it('非 lottie（静态/模型）不显示控制条', () => {
    mountFollower({ ...base, portrait: 'http://x/p.png', portraitKind: 'static' })
    expect(control()).toBeNull()
  })

  it('暂停后点形象播放：play 被调用且按钮回到「暂停」态', async () => {
    mountFollower({ ...base, portrait: 'http://x/a.json', portraitKind: 'lottie' })
    control()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(control()!.getAttribute('aria-label')).toBe('播放')

    await (document.querySelector('.ef-stage') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(playSpy).toHaveBeenCalledWith('click')
    expect(control()!.getAttribute('aria-label')).toBe('暂停')
  })

  it('切换实体时暂停状态复位', async () => {
    const w = mountFollower({ ...base, portrait: 'http://x/a.json', portraitKind: 'lottie' })
    control()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(control()!.getAttribute('aria-label')).toBe('播放')

    await w.setProps({
      entity: { ...base, id: 'chr-2', portrait: 'http://x/b.json', portraitKind: 'lottie' } as never,
    })
    await w.vm.$nextTick()
    expect(control()!.getAttribute('aria-label')).toBe('暂停')
  })
})

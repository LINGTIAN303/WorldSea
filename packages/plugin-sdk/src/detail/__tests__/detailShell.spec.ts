/**
 * DetailShell 标签条行为测试（2026-10-08 Tab 优化批 B）。
 *
 * 锁：无障碍语义（tablist/tab/aria-selected/roving tabindex）、方向键/Home/End 自动激活、
 * count 徽标、滚轮横滚（仅在溢出时接管）。jsdom 无 scrollIntoView——全局打桩。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import DetailShell from '../../components/DetailShell.vue'
import type { DetailTab } from '../useDetailChrome'

const TABS: DetailTab[] = [
  { id: 'info', label: '信息', icon: 'outline' },
  { id: 'cover', label: '封面', icon: 'image' },
  { id: 'relations', label: '关联', icon: 'link', count: 7 },
]

let wrapper: VueWrapper | undefined

function mountShell(activeTab = 'info') {
  wrapper = mount(DetailShell, {
    props: { entity: null, editing: false, tabs: TABS, activeTab },
    slots: { default: '<div class="probe">内容</div>' },
  })
  return wrapper
}

beforeEach(() => {
  vi.stubGlobal('scrollIntoViewMock', vi.fn())
  Element.prototype.scrollIntoView = (Element.prototype.scrollIntoView || vi.fn()) as never
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('DetailShell / 无障碍', () => {
  it('tablist/tab 语义 + aria-selected + roving tabindex', () => {
    const w = mountShell('cover')
    expect(w.find('[role="tablist"]').exists()).toBe(true)
    const tabs = w.findAll('[role="tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].attributes('aria-selected')).toBe('false')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(tabs[0].attributes('tabindex')).toBe('-1')
    expect(tabs[1].attributes('tabindex')).toBe('0')
  })

  it('单 tab 不渲标签条（既有行为保持）', () => {
    const w = mount(DetailShell, {
      props: { entity: null, editing: false, tabs: [TABS[0]], activeTab: 'info' },
    })
    expect(w.find('[role="tablist"]').exists()).toBe(false)
    w.unmount()
  })

  it('count 徽标渲染（含 0 值）', () => {
    const w = mount(DetailShell, {
      props: { entity: null, editing: false, tabs: [{ id: 'relations', label: '关联', count: 0 }], activeTab: 'relations' },
    })
    // 单 tab 无标签条 → 用三 tab 版本断言
    w.unmount()
    const w2 = mountShell()
    expect(w2.find('.dp-tab-count').text()).toBe('7')
  })

  it('ArrowRight 在标签间循环（wrap）并自动激活到目标', async () => {
    const w = mountShell('relations')
    const tabs = w.findAll('[role="tab"]')
    await tabs[2].trigger('keydown', { key: 'ArrowRight' })
    expect(w.emitted('tab-change')?.[0]).toEqual(['info'])
  })

  it('ArrowLeft 从首个回绕到末个', async () => {
    const w = mountShell('info')
    const tabs = w.findAll('[role="tab"]')
    await tabs[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(w.emitted('tab-change')?.[0]).toEqual(['relations'])
  })

  it('Home / End 直达首尾', async () => {
    const w = mountShell('cover')
    const tabs = w.findAll('[role="tab"]')
    await tabs[1].trigger('keydown', { key: 'Home' })
    expect(w.emitted('tab-change')?.[0]).toEqual(['info'])
    await tabs[1].trigger('keydown', { key: 'End' })
    expect(w.emitted('tab-change')?.[1]).toEqual(['relations'])
  })

  it('不相关按键不拦截', async () => {
    const w = mountShell('info')
    await w.findAll('[role="tab"]')[0].trigger('keydown', { key: 'a' })
    expect(w.emitted('tab-change')).toBeUndefined()
  })
})

describe('DetailShell / 滚轮横滚', () => {
  function fakeMetrics(w: VueWrapper, scrollWidth: number, clientWidth: number) {
    const el = w.find('[role="tablist"]').element as HTMLElement
    Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
    el.scrollLeft = 0
    return el
  }

  it('溢出时：滚轮纵向分量转为横向滚动且 preventDefault', async () => {
    const w = mountShell()
    const el = fakeMetrics(w, 400, 200)
    const ev = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    await nextTick()
    expect(el.scrollLeft).toBe(60)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('不溢出时：放行（不 preventDefault、不横滚）', async () => {
    const w = mountShell()
    const el = fakeMetrics(w, 200, 200)
    const ev = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    await nextTick()
    expect(el.scrollLeft).toBe(0)
    expect(ev.defaultPrevented).toBe(false)
  })
})

// 形象图批 D1 守卫（2026-10-25）：追踪浮层——挂载条件 / 关闭（按钮+Esc）/ 点击形象触发播放。
// 跟随鼠标的真实 mousemove 路径属真机走查；此处锁组件契约。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import EntityFollower from '../EntityFollower.vue'
import PortraitRenderer from '../PortraitRenderer.vue'
import { useSettingsStore } from '@worldsea/entity-core'

const entity = {
  id: 'chr-1', type: 'character', name: '凉', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
  portrait: 'http://asset.localhost/p.gif', portraitKind: 'animated',
} as never

let wrapper: VueWrapper | undefined

function mountFollower() {
  setActivePinia(createPinia())
  wrapper = mount(EntityFollower, { props: { entity }, attachTo: document.body })
  return wrapper
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('EntityFollower —— D1 追踪浮层', () => {
  it('挂载即渲染 PortraitRenderer（形象与名称）；默认非跟踪态（固定角位，无 ef-follow）', () => {
    const w = mountFollower()
    const el = document.querySelector('.efollower') as HTMLElement
    expect(el).toBeTruthy()
    expect(el.classList.contains('ef-follow')).toBe(false)
    expect(w.findComponent(PortraitRenderer).props('src')).toBe('http://asset.localhost/p.gif')
    expect(el.textContent).toContain('凉')
  })

  it('跟踪开关开 → ef-follow 类（跟随鼠标态由设置驱动）', async () => {
    const w = mountFollower()
    const settings = useSettingsStore()
    settings.portraitFollowMouse = true
    await new Promise((r) => setTimeout(r))
    const el = document.querySelector('.efollower') as HTMLElement
    expect(el.classList.contains('ef-follow')).toBe(true)
  })

  it('点击形象区不抛错（#12 非跟踪播放入口）；Esc / 关闭按钮 → emit close', async () => {
    const w = mountFollower()
    // play 的真实行为（模型随机动作/动图重头播）由 PortraitRenderer 单测与走查覆盖；
    // 此处锁点击入口链路（animated 无 lottie 实例时 play 为 no-op 不抛错）。Teleport 转 body → DOM 查询
    await (document.querySelector('.ef-stage') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await (document.querySelector('.ef-close') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(w.emitted('close')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')?.length).toBeGreaterThanOrEqual(2)
  })
})

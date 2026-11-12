// 形象图批 D3 守卫（2026-10-25）：文件头判动图纯函数 + MotionStage 分层渲染 + motion 表单写路径。
// WAAPI 真动画与触发链路属真机走查。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { isAnimatedImageBytes } from '@worldsea/entity-core/core'
import MotionStage from '../MotionStage.vue'
import EntityCoverPanel from '../EntityCoverPanel.vue'
import type { MotionConfig } from '@worldsea/entity-core'

// ── 文件头判动图（APNG / 动图 WebP）──
function pngWith(ctl: boolean): Uint8Array {
  const head = new Uint8Array(64)
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (ctl) head.set([0x61, 0x63, 0x54, 0x4c], 40) // acTL
  return head
}
function webpWith(anim: boolean): Uint8Array {
  const head = new Uint8Array(64)
  head.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]) // RIFF....WEBP
  if (anim) head.set([0x41, 0x4e, 0x49, 0x4d], 16) // ANIM
  return head
}

describe('isAnimatedImageBytes —— 扩展名不可辨的动图判类（走查确认项）', () => {
  it('APNG（PNG+acTL）与动图 WebP（ANIM/ANMF）判真；静态判假', () => {
    expect(isAnimatedImageBytes(pngWith(true))).toBe(true)
    expect(isAnimatedImageBytes(pngWith(false))).toBe(false)
    expect(isAnimatedImageBytes(webpWith(true))).toBe(true)
    expect(isAnimatedImageBytes(webpWith(false))).toBe(false)
  })
})

// ── MotionStage：区域分层渲染 ──
const motion: MotionConfig = {
  regions: [
    { id: 'r1', x: 25, y: 25, w: 50, h: 50 },
    { id: 'r2', x: 0, y: 0, w: 20, h: 20 },
  ],
  tracks: [
    { id: 't1', regionId: 'r1', trigger: 'loop', duration: 2, loop: true, alternate: true, dy: 5 },
    { id: 't2', regionId: 'ghost', trigger: 'hover', duration: 1, loop: false }, // 区域缺失 → 不渲染
  ],
}

let wrapper: VueWrapper | undefined
beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('MotionStage —— 区域分层（#8 动哪里/动多少处）', () => {
  it('每条有效轨迹一层同源 img；region 缺失的轨迹不渲染；clip-path 按区域生成', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    wrapper = mount(MotionStage, { props: { src: 'https://x/p.png', motion }, attachTo: el })
    await new Promise((r) => setTimeout(r))
    const layers = [...el.querySelectorAll('.mstage-layer')] as HTMLElement[]
    expect(layers.length).toBe(1) // ghost 轨迹剔除
    expect((layers[0] as HTMLImageElement).src).toContain('p.png')
    // jsdom 31 起按 CSS 简写规则折叠 inset：四边相等时 `inset(25% 25% 25% 25%)` 序列化为
    // `inset(25%)`（jsdom 25 不折叠）。断言四边数值本身，不依赖序列化形态。
    expect(layers[0].style.clipPath).toMatch(/^inset\(25%\)$/)
    el.remove()
  })

  it('轨迹 easing 透传到 WAAPI 关键帧（F2）', async () => {
    const captured: Keyframe[][] = []
    const proto = HTMLElement.prototype as unknown as { animate?: (k: Keyframe[]) => Animation }
    const original = proto.animate
    proto.animate = (k: Keyframe[]) => {
      captured.push(k)
      return { cancel: () => {} } as Animation
    }
    try {
      const withEasing: MotionConfig = {
        ...motion,
        tracks: [{ ...motion.tracks[0], easing: 'ease-in-out' }],
      }
      const el = document.createElement('div')
      document.body.appendChild(el)
      wrapper = mount(MotionStage, { props: { src: 'https://x/p.png', motion: withEasing }, attachTo: el })
      await new Promise((r) => setTimeout(r))
      expect(captured.length).toBeGreaterThan(0)
      expect(captured.at(-1)?.every((k) => k.easing === 'ease-in-out')).toBe(true)
      el.remove()
    } finally {
      if (original) proto.animate = original
      else delete proto.animate
    }
  })
})

describe('EntityCoverPanel —— 区域动效表单（D3）', () => {
  const entity = {
    id: 'chr-1', type: 'character', name: '凉', description: '', tags: [],
    properties: {}, createdAt: '', updatedAt: '',
    portrait: 'http://x/p.png', portraitKind: 'static',
  } as never

  it('静态类显示区域动效区；入口打开画布编辑器（D4 起表单进编辑器）', async () => {
    setActivePinia(createPinia())
    wrapper = mount(EntityCoverPanel, { props: { entity }, attachTo: document.body })

    expect(wrapper.find('.ecp-actions').exists()).toBe(true)
    expect(wrapper.text()).toContain('尚未配置')
    const open = wrapper.findAll('button').find(b => b.text().includes('打开画布编辑器'))
    expect(open).toBeTruthy()
    await open!.trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(document.querySelector('.me-dialog')).toBeTruthy()
  })

  it('模型类不显示区域动效区（模型走动作配置）', () => {
    setActivePinia(createPinia())
    wrapper = mount(EntityCoverPanel, {
      props: { entity: { ...entity, portraitKind: 'model', portrait: 'http://x/h.glb' } },
    })
    expect(wrapper.findAll('.ecp-actions').length).toBe(1) // 仅模型动作配置区
  })
})

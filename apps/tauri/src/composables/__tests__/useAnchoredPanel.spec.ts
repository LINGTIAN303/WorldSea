/**
 * useAnchoredPanel 测试（批3 归一件）：函数 ref 接管面板元素、位置按锚点 rect 计算
 * （bottomGuard 钳位）、面板外点击关闭/面板内与锚点上点击不关。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useAnchoredPanel } from '../useAnchoredPanel'

describe('useAnchoredPanel', () => {
  function mountPanel(anchorRect: () => DOMRect) {
    const close = vi.fn()
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    vi.spyOn(anchorEl, 'getBoundingClientRect').mockImplementation(anchorRect)

    const Host = defineComponent({
      setup() {
        const anchor = () => anchorEl
        const { panelRef, panelStyle } = useAnchoredPanel(anchor, () => close(), { bottomGuard: 300 })
        return () => h('div', { ref: panelRef, style: panelStyle.value, 'data-panel': '' }, '面板内容')
      },
    })
    const wrapper = mount(Host, { attachTo: document.body })
    return { close, wrapper, anchorEl }
  }

  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 900)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('位置 = 锚点下方右对齐（top 钳位护栏生效）', async () => {
    const { wrapper } = mountPanel(() => new DOMRect(800, 100, 120, 32))
    await nextTick()
    const style = wrapper.find('[data-panel]').attributes('style') || ''
    // right = 1000 - (800+120) = 80
    expect(style).toContain('right: 80px')
    // top = 100+32+6 = 138 < 900-300 护栏
    expect(style).toContain('top: 138px')
    wrapper.unmount()
  })

  it('top 超护栏时钳位（锚点贴近视口底部）', async () => {
    // 锚点 bottom=700 → 706 > 900-300=600 → 钳到 600
    const { wrapper } = mountPanel(() => new DOMRect(500, 668, 120, 32))
    await nextTick()
    const style = wrapper.find('[data-panel]').attributes('style') || ''
    expect(style).toContain('top: 600px')
    wrapper.unmount()
  })

  it('面板外点击关闭，面板内与锚点点击不关', async () => {
    const { close, wrapper, anchorEl } = mountPanel(() => new DOMRect(400, 100, 120, 32))
    await nextTick()
    const panel = wrapper.find('[data-panel]').element
    // 面板内点击：不关
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    // 上面派发在 document 上（目标=document）→ 属面板外 → 会关；改为构造目标模拟：
    // 先重置再用 contains 可过的目标派发
    close.mockClear()
    const inside = document.createElement('span')
    panel.appendChild(inside)
    inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(close).not.toHaveBeenCalled()
    // 锚点点击：不关（切换开关语义由外层按钮处理）
    anchorEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(close).not.toHaveBeenCalled()
    // 外部点击：关
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(close).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

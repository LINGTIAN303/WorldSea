// @vitest-environment jsdom
/**
 * OverlayHost 契约（批2）：真源镜像（登记/反注册）、`ws-open-<id>` 打开事件、
 * 面板 emit close 关闭、反注册时监听器与打开态一并清理。
 * 面板组件用桩（记录 show prop 的轻组件），不引入真实数据面板。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { pluginAPI } from '@worldsea/entity-core'
import OverlayHost from '../OverlayHost.vue'

/** 桩面板：渲染自身 show prop 供断言。 */
function stubPanel(name: string) {
  return defineComponent({
    name,
    props: { show: { type: Boolean, default: false } },
    emits: ['close'],
    setup(props) {
      return () => h('div', { class: `stub-${name}`, 'data-show': String(props.show) })
    },
  })
}

function dispatchOpen(id: string): void {
  window.dispatchEvent(new CustomEvent(`ws-open-${id}`))
}

function findShow(wrapper: ReturnType<typeof mount>, name: string): string | undefined {
  return wrapper.find(`.stub-${name}`).attributes('data-show')
}

afterEach(() => {
  pluginAPI.clearOverlays()
})

describe('OverlayHost（批2）', () => {
  it('既有登记兜底对账：挂载前登记的面板也渲染', () => {
    pluginAPI.registerOverlay({ id: 'trash', label: '回收站', component: stubPanel('PreTrash') })
    const wrapper = mount(OverlayHost)
    expect(wrapper.find('.stub-PreTrash').exists()).toBe(true)
    wrapper.unmount()
  })

  it('挂载后登记 → 渲染 + ws-open 事件打开 + close 事件关闭', async () => {
    const wrapper = mount(OverlayHost)
    pluginAPI.registerOverlay({ id: 'artifacts', label: '产物', component: stubPanel('Art') })
    await wrapper.vm.$nextTick() // 登记回调同步改 ref，DOM 更新在 nextTick

    expect(findShow(wrapper, 'Art')).toBe('false')
    dispatchOpen('artifacts')
    await wrapper.vm.$nextTick()
    expect(findShow(wrapper, 'Art')).toBe('true')

    wrapper.findComponent({ name: 'Art' }).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(findShow(wrapper, 'Art')).toBe('false')
    wrapper.unmount()
  })

  it('反注册 → 组件卸载 + 事件监听移除（再 dispatch 不复活）', async () => {
    const wrapper = mount(OverlayHost)
    pluginAPI.registerOverlay({ id: 'consistency', label: '一致性', component: stubPanel('Cons') })
    dispatchOpen('consistency')
    await wrapper.vm.$nextTick()

    pluginAPI.unregisterOverlay('consistency')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.stub-Cons').exists()).toBe(false)

    dispatchOpen('consistency')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.stub-Cons').exists()).toBe(false)
    wrapper.unmount()
  })
})

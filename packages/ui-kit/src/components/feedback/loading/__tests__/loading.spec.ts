import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WsInlineLoading from '../WsInlineLoading.vue'
import WsSkeleton from '../WsSkeleton.vue'
import WsStageRoute from '../WsStageRoute.vue'
import WsLoadingOverlay from '../WsLoadingOverlay.vue'
import WsScanRadar from '../WsScanRadar.vue'
import type { LoadingStage } from '../types'

const stages: LoadingStage[] = [
  { short: '数据源', full: '切换数据源…', detail: '绑定工作区指针' },
  { short: '实体', full: '装载实体 / 关系 / 文件…', detail: '实体 1,284 · 关系 3,106 · 文件 42' },
  { short: '芽', full: '重装芽与视图…', detail: '27 个芽 · 视图注册' },
  { short: '关联', full: '恢复文件关联…', detail: '文件监听 / 导图 / 章节迁移' },
]

describe('加载反馈组件', () => {
  it('WsInlineLoading：aria/尺寸/变体', () => {
    const orbit = mount(WsInlineLoading, { props: { size: 'sm', label: '正在刷新' } })
    expect(orbit.attributes('role')).toBe('status')
    expect(orbit.attributes('aria-label')).toBe('正在刷新')
    expect(orbit.attributes('aria-live')).toBe('off')
    expect(orbit.classes()).toContain('is-sm')
    expect(orbit.find('.ws-inline-loading__orbit').exists()).toBe(true)

    const line = mount(WsInlineLoading, { props: { variant: 'line', live: true } })
    expect(line.find('.ws-inline-loading__line').exists()).toBe(true)
    expect(line.attributes('aria-live')).toBe('polite')
  })

  it('WsSkeleton：role/aria-busy 与行数', () => {
    const wrapper = mount(WsSkeleton, { props: { variant: 'text', lines: 2, label: '读取实体' } })
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.findAll('.ws-skeleton__line').length).toBe(2)
  })

  it('WsStageRoute：4 个短标签，当前节点高亮', () => {
    const wrapper = mount(WsStageRoute, { props: { stages, current: 1 } })
    const labels = wrapper.findAll('.ws-stage-route__label')
    expect(labels.length).toBe(4)
    expect(labels[0].classes()).toContain('is-done')
    expect(labels[1].classes()).toContain('is-active')
    expect(labels[2].classes()).not.toContain('is-active')
  })

  it('WsStageRoute：失败态当前节点 warning', () => {
    const wrapper = mount(WsStageRoute, { props: { stages, current: 1, status: 'error' } })
    const labels = wrapper.findAll('.ws-stage-route__label')
    expect(labels[1].classes()).toContain('is-error')
  })

  it('WsLoadingOverlay：阶段式文案与计数，加载中无操作按钮', () => {
    const wrapper = mount(WsLoadingOverlay, {
      props: { show: true, title: '正在切换项目', stages, current: 1 },
    })
    expect(wrapper.find('.ws-loading-overlay').attributes('role')).toBe('status')
    expect(wrapper.text()).toContain('正在切换项目')
    expect(wrapper.text()).toContain('装载实体 / 关系 / 文件…')
    expect(wrapper.text()).toContain('2 / 4')
    expect(wrapper.findAll('.ws-loading-panel__actions button').length).toBe(0)
  })

  it('WsLoadingOverlay：失败态出现重试/关闭并 emit', async () => {
    const wrapper = mount(WsLoadingOverlay, {
      props: {
        show: true,
        title: '正在切换项目',
        errorTitle: '切换失败',
        errorText: '无法完成项目切换',
        stages,
        current: 1,
        status: 'error',
        error: '装载实体失败',
      },
    })
    expect(wrapper.text()).toContain('切换失败')
    expect(wrapper.text()).toContain('装载实体失败')
    const buttons = wrapper.findAll('.ws-loading-panel__actions button')
    expect(buttons.length).toBe(2)

    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('WsLoadingOverlay：完成态 4/4 且无操作按钮', () => {
    const wrapper = mount(WsLoadingOverlay, {
      props: {
        show: true,
        stages,
        current: 3,
        status: 'success',
        successTitle: '切换完成',
        successText: '群岛档案已就绪',
        successDetail: '可以继续工作',
      },
    })
    expect(wrapper.text()).toContain('切换完成')
    expect(wrapper.text()).toContain('4 / 4')
    expect(wrapper.findAll('.ws-loading-panel__actions button').length).toBe(0)
  })

  it('WsScanRadar：真实百分比进入 aria-label', () => {
    const wrapper = mount(WsScanRadar, { props: { progress: 63 } })
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-label')).toBe('正在扫描 63%')
    expect(wrapper.findAll('.ws-scan-radar__dot.is-found').length).toBe(2)
  })
})

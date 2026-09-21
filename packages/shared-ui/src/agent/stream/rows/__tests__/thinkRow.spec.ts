/**
 * ThinkRow 推理行渲染契约（C1 推理流式专项，2026-09-20）
 *
 * 锁定的行为（性能优化的正确性前提）：
 * - 摘要：流式取「末个非空行」、完成取「首个非空行」，截断 80 字符
 * - 正文：折叠态（不可见）**不**随增量更新 DOM；展开瞬间同步到最新；展开态增量经 rAF 合并
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ThinkRow from '../ThinkRow.vue'

type ThinkStatus = 'streaming' | 'complete'

function thinkItem(text: string, status: ThinkStatus = 'streaming') {
  return { id: 'think-1', text, status }
}

/** 等一帧（jsdom rAF 由 pretendToBeVisual 提供） */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function bodyText(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find('.ws-stream-think-body').text()
}

function summaryText(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find('.ws-stream-think-summary').text()
}

describe('ThinkRow 摘要', () => {
  it('流式取末个非空行、完成取首个非空行', async () => {
    const wrapper = mount(ThinkRow, { props: { item: thinkItem('首行\n\n  次行  ') } })
    expect(summaryText(wrapper)).toBe('次行')
    await wrapper.setProps({ item: thinkItem('首行\n\n  次行  ', 'complete') })
    expect(summaryText(wrapper)).toBe('首行')
    wrapper.unmount()
  })

  it('超长行截断 80 字符', () => {
    const long = 'x'.repeat(200)
    const wrapper = mount(ThinkRow, { props: { item: thinkItem(long) } })
    expect(summaryText(wrapper)).toBe('x'.repeat(80))
    wrapper.unmount()
  })
})

describe('ThinkRow 正文更新（折叠态跳过 / 展开态节流）', () => {
  it('折叠态：增量不更新正文 DOM，但摘要跟随最新', async () => {
    const wrapper = mount(ThinkRow, { props: { item: thinkItem('第一行\n第二行') } })
    expect(bodyText(wrapper)).toBe('第一行\n第二行')

    await wrapper.setProps({ item: thinkItem('第一行\n第二行\n第三行') })
    // 折叠态正文高度为 0 且 aria-hidden：DOM 文本保持挂载时的内容（省下每 delta 的全文 patch）
    expect(bodyText(wrapper)).toBe('第一行\n第二行')
    // 摘要（可见）必须是最新
    expect(summaryText(wrapper)).toBe('第三行')
    wrapper.unmount()
  })

  it('展开瞬间同步到最新内容（不闪现旧文本）', async () => {
    const wrapper = mount(ThinkRow, { props: { item: thinkItem('第一行\n第二行') } })
    await wrapper.setProps({ item: thinkItem('第一行\n第二行\n第三行') })
    await wrapper.find('.ws-stream-think-title').trigger('click')
    expect(bodyText(wrapper)).toBe('第一行\n第二行\n第三行')
    wrapper.unmount()
  })

  it('展开态：增量经一帧后同步（rAF 合并）', async () => {
    const wrapper = mount(ThinkRow, { props: { item: thinkItem('A') } })
    await wrapper.find('.ws-stream-think-title').trigger('click')

    await wrapper.setProps({ item: thinkItem('A\nB') })
    expect(bodyText(wrapper)).toBe('A') // 同一帧内不立即 patch
    await nextFrame()
    expect(bodyText(wrapper)).toBe('A\nB')
    wrapper.unmount()
  })

  it('折叠态切换回展开：显示的是最新内容而非挂载时的内容', async () => {
    const wrapper = mount(ThinkRow, { props: { item: thinkItem('A') } })
    await wrapper.setProps({ item: thinkItem('A\nB') })
    await wrapper.setProps({ item: thinkItem('A\nB\nC') })
    await wrapper.find('.ws-stream-think-title').trigger('click')
    expect(bodyText(wrapper)).toBe('A\nB\nC')
    wrapper.unmount()
  })
})

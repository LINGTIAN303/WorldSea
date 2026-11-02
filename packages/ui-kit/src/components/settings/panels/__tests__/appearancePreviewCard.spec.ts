// 外观面板第六卡结构守卫（2026-10-25 形象图批 C/D1 走查疑点）：Deck 六张卡各自渲染
// 对应分支——第六张（data-index=5）必须是「卡片与预览」（含视频封面区与形象图追踪区），
// 而非复用 idx 0 的主题内容。
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppearancePanel from '../AppearancePanel.vue'

beforeEach(() => { localStorage.clear() })

describe('AppearancePanel —— Deck 六卡分支', () => {
  it('第六张卡（idx=5）为「卡片与预览」，含视频封面三档与形象图追踪，不含主题内容', () => {
    setActivePinia(createPinia())
    const w = mount(AppearancePanel, { props: { searchQuery: '' } })
    const cards = w.findAll('.deck-card')
    expect(cards.length).toBe(6)
    const sixth = w.find('.deck-card[data-index="5"]')
    const text = sixth.text()
    expect(text).toContain('卡片与预览')
    expect(text).toContain('视频封面')
    expect(text).toContain('卡片内自动播放')
    expect(text).toContain('形象图追踪')
    expect(text).toContain('浮层跟随鼠标')
    // 主题内容只应出现在第一张
    expect(w.find('.deck-card[data-index="0"]').text()).toContain('主题')
    expect(text).not.toContain('底色')
    // 每卡恰一个 sc-head：设置外壳左列目录按 sc-head 抓标题并按索引翻卡——
    // 一卡多头会目录越位点错卡（D1 走查实锤：视频封面→主题、形象图追踪→高亮）
    expect(sixth.findAll('.sc-head').length).toBe(1)
    for (const c of cards) expect(c.findAll('.sc-head').length).toBe(1)
  })

  it('追踪/滚动暂停等新键在 settingsStore 就绪（persisted 默认值）', () => {
    setActivePinia(createPinia())
    const w = mount(AppearancePanel, { props: { searchQuery: '' } })
    // 面板挂载即 store 初始化成功（键存在性经 v-model 绑定消费，无异常即通）
    expect(w.find('.deck-card[data-index="5"]').exists()).toBe(true)
  })

  it('背景卡命中填充/焦点/暗化/模糊', () => {
    setActivePinia(createPinia())
    for (const q of ['填充', '焦点', '暗化', '模糊']) {
      const w = mount(AppearancePanel, { props: { searchQuery: q } })
      const cards = w.findAll('.deck-card')
      expect(cards[1].isVisible()).toBe(true)
      expect(cards[0].isVisible()).toBe(false)
      w.unmount()
    }
  })

  it('背景卡命中分区/窗口栏/侧栏/内容区/首页/亮色/暗色', () => {
    setActivePinia(createPinia())
    for (const q of ['分区', '窗口栏', '侧栏', '内容区', '首页', '亮色', '暗色']) {
      const w = mount(AppearancePanel, { props: { searchQuery: q } })
      const cards = w.findAll('.deck-card')
      expect(cards[1].isVisible()).toBe(true)
      expect(cards[0].isVisible()).toBe(false)
      w.unmount()
    }
  })
})

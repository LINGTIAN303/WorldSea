import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { entitySchemaRegistry, fieldRegistry, useDetailLayoutStore } from '@worldsea/entity-core'

import DetailSettingsPanel from '../DetailSettingsPanel.vue'

/**
 * 设置 ·「实体详情」Tab 守卫（批次 1b-2）。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §七
 *
 * 锁的是**面板只做类型级覆写、且合并只有一条路**：所有写入都应落到 `detailLayoutStore`
 * 的 `overrides[type]`，详情面按同一函数读回。若哪天面板自己拼了默认值，这几例会立刻报红。
 */

const confirmMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@worldsea/ui-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@worldsea/ui-kit')>()
  return { ...actual, useConfirm: () => ({ confirm: confirmMock }) }
})

let pinia: Pinia
let wrapper: VueWrapper | undefined

function mountPanel(searchQuery = '') {
  wrapper = mount(DetailSettingsPanel, {
    props: { searchQuery },
    global: { plugins: [pinia] },
  })
  return wrapper
}

function overrideOf(type = 'character') {
  return useDetailLayoutStore().overrides[type] ?? {}
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
  confirmMock.mockClear()
  fieldRegistry.resetToBuiltin('character')
  fieldRegistry.resetToBuiltin('item')
  fieldRegistry.registerBuiltin('character', [
    { key: 'title', label: '名称', fieldType: 'text' },
    { key: 'age', label: '年龄', fieldType: 'number' },
    { key: 'origin', label: '出身', fieldType: 'text' },
  ] as never)
  fieldRegistry.registerBuiltin('item', [
    { key: 'title', label: '名称', fieldType: 'text' },
    { key: 'rarity', label: '稀有度', fieldType: 'select' },
  ] as never)
  entitySchemaRegistry.register({ typeKey: 'character', label: '角色', icon: 'user', fields: [] } as never)
  entitySchemaRegistry.register({ typeKey: 'item', label: '道具', icon: 'item', fields: [] } as never)
})

function heads(w: VueWrapper): string[] {
  return w.findAll('.sc-head').map(h => h.text())
}

describe('面板骨架', () => {
  it('三张卡各有分节标题（左列 rail 靠 .sc-head 取文本）', () => {
    const w = mountPanel()
    expect(heads(w)).toHaveLength(3)
    expect(heads(w)[0]).toContain('内容形态')
    expect(heads(w)[1]).toContain('字段顺序与可见性')
    expect(heads(w)[2]).toContain('形态配置')
    expect(w.find('.ds-type').text()).toBe('角色')
  })

  it('搜索模式只留命中关键字的卡（flat 平铺由 CardDeck 承担）', () => {
    const w = mountPanel('时间轴')
    expect(w.findAll('.set-card').filter(c => c.isVisible()).length).toBe(1)
  })
})

describe('内容形态（卡一）', () => {
  it('五个形态都成按钮，当前形态高亮', () => {
    const w = mountPanel()
    const chips = w.findAll('.set-chip')
    expect(chips.map(c => c.text())).toEqual(['分组式', '表格式', '段落式', '摘要式', '时间轴式'])
    expect(chips[0].classes()).toContain('on')
  })

  it('点形态只写 overrides[type].contentForm，并落盘', async () => {
    const w = mountPanel()
    await w.findAll('.set-chip')[2].trigger('click')
    expect(overrideOf().contentForm).toBe('narrative')
    expect(JSON.parse(localStorage.getItem('worldsea_detail_layouts') || '{}').character.contentForm).toBe('narrative')
  })

  it('未覆写时不给「恢复芽默认」按钮（免得是个假动作）', () => {
    expect(mountPanel().find('.set-btn').exists()).toBe(false)
  })

  it('有覆写后按钮出现，确认即清空该类型覆写', async () => {
    const w = mountPanel()
    await w.findAll('.set-chip')[1].trigger('click')
    const btn = w.find('.set-btn')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(confirmMock).toHaveBeenCalled()
    expect(overrideOf()).toEqual({})
  })

  it('取消确认则覆写原样留着', async () => {
    confirmMock.mockResolvedValueOnce(false as never)
    const w = mountPanel()
    await w.findAll('.set-chip')[1].trigger('click')
    await w.find('.set-btn').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(overrideOf().contentForm).toBe('table')
  })
})

describe('字段顺序与可见性（卡二）', () => {
  function fieldRows(w: VueWrapper) {
    return w.findAll('.ds-field')
  }

  it('按该类型注册字段成行，标题也在内但由详情面自行不占行', () => {
    const w = mountPanel()
    expect(fieldRows(w).map(r => r.find('.ds-label').text())).toEqual(['名称', '年龄', '出身'])
    expect(fieldRows(w)[0].find('.ds-key').text()).toBe('title')
  })

  it('↑↓ 写 order；首行 ↑ 与末行 ↓ 禁用（不产生无意义覆写）', async () => {
    const w = mountPanel()
    const ups = w.findAll('[aria-label="上移"]')
    const downs = w.findAll('[aria-label="下移"]')
    expect(ups[0].attributes('disabled')).toBeDefined()
    await downs[1].trigger('click')
    expect(overrideOf().order).toEqual(['title', 'origin', 'age'])
    await ups[0].trigger('click')
    expect(overrideOf().order).toEqual(['title', 'origin', 'age'])
  })

  it('可见性开关写 hidden，再点回原状', async () => {
    const w = mountPanel()
    await fieldRows(w)[1].find('input[type=checkbox]').trigger('change')
    expect(overrideOf().hidden).toEqual(['age'])
    expect(fieldRows(w)[1].find('.ds-label').classes()).toContain('is-hidden')
    await fieldRows(w)[1].find('input[type=checkbox]').trigger('change')
    expect(overrideOf().hidden).toEqual([])
  })

  it('切实体类型后读写都跟着换（两类型互不串台）', async () => {
    const w = mountPanel()
    await w.find('select').setValue('item')
    expect(w.find('.ds-type').text()).toBe('道具')
    await w.findAll('.set-chip')[3].trigger('click')
    expect(overrideOf('item').contentForm).toBe('summary')
    expect(overrideOf('character').contentForm).toBeUndefined()
  })
})

describe('形态配置（卡三）', () => {
  it('分组式没有配置项，如实说明而不是空卡', () => {
    const w = mountPanel()
    expect(w.text()).toContain('「分组式」没有可配置项')
  })

  it('摘要式按 configSchema 自动渲染开关与数字，写入 contentConfig', async () => {
    const w = mountPanel()
    await w.findAll('.set-chip')[3].trigger('click')
    const rows = w.findAll('.set-card')[2].findAll('.set-row')
    expect(rows.map(r => r.find('span').text())).toEqual(['最多属性数', '显示正文摘录'])
    await rows[0].find('input[type=number]').setValue('6')
    expect(overrideOf().contentConfig).toEqual({ maxChips: 6 })
    await rows[1].find('input[type=checkbox]').trigger('change')
    expect(overrideOf().contentConfig).toEqual({ maxChips: 6, showExcerpt: false })
  })

  it('数字框清空时回落默认值，不落 0', async () => {
    const w = mountPanel()
    await w.findAll('.set-chip')[3].trigger('click')
    const num = w.findAll('.set-card')[2].find('input[type=number]')
    await num.setValue('')
    expect(overrideOf().contentConfig).toEqual({ maxChips: 14 })
  })
})

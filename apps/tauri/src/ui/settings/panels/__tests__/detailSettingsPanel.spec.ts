import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { entitySchemaRegistry, fieldRegistry, useDetailLayoutStore, useFieldOrderStore } from '@worldsea/entity-core'

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

describe('面板骨架', () => {
  it('五张卡各有分节标题（左列 rail 靠 .sc-head 取首个 span 文本）', () => {
    const w = mountPanel()
    const heads = w.findAll('.sc-head').map(h => h.find('span').text())
    expect(heads).toEqual(['内容形态', '字段顺序与可见性', '形态配置', '分组管理', '命名预设'])
    expect(w.findAll('.sc-head')[0].text()).toContain('角色')
  })

  it('搜索模式只留命中关键字的卡（flat 平铺由 CardDeck 承担）', () => {
    const visible = (q: string) => mountPanel(q).findAll('.set-card').filter(c => c.isVisible()).length
    expect(visible('时间轴')).toBe(1)
    expect(visible('分组管理')).toBe(1)
    expect(visible('命名预设')).toBe(1)
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
    expect(mountPanel().findAll('.set-card')[0].find('.set-btn').exists()).toBe(false)
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
    return w.findAll('.set-card')[1].findAll('.ds-field')
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

describe('分组管理（卡四）', () => {
  function card(w: VueWrapper) {
    return w.findAll('.set-card')[3]
  }
  /** 保存按钮（草稿态才解禁） */
  function saveBtn(w: VueWrapper) {
    return card(w).findAll('.set-btn').find(b => b.text() === '保存分组')!
  }

  it('新建分组只改草稿，点「保存分组」才落盘（空组即时写会被归一丢掉，按钮像坏了一样）', async () => {
    const w = mountPanel()
    await card(w).findAll('.set-btn')[0].trigger('click')
    expect(saveBtn(w).attributes('disabled')).toBeUndefined()
    expect(overrideOf().groups).toBeUndefined()
    await saveBtn(w).trigger('click')
    expect(overrideOf().groups).toHaveLength(1)
    expect((overrideOf().groups as { label: string }[])[0].label).toBe('分组 1')
  })

  it('字段归属下拉把字段挂进组，且一个字段只属一个组', async () => {
    const w = mountPanel()
    await card(w).findAll('.set-btn')[0].trigger('click')
    await card(w).findAll('.set-btn')[0].trigger('click')
    const selects = card(w).findAll('select')
    // 标题不占详情行、隐藏字段不分组 → 只有「年龄 / 出身」两个可挂
    expect(selects).toHaveLength(2)
    await selects[0].setValue('g1')
    await selects[0].setValue('g2')
    await saveBtn(w).trigger('click')
    const groups = overrideOf().groups as { key: string; fieldKeys: string[] }[]
    expect(groups.map(g => g.key)).toEqual(['g1', 'g2'])
    expect(groups[0].fieldKeys).toEqual([])
    expect(groups[1].fieldKeys).toEqual(['age'])
  })

  it('改名与删组都进草稿，保存后如实落盘', async () => {
    const w = mountPanel()
    await card(w).findAll('.set-btn')[0].trigger('click')
    await card(w).find('input[aria-label="分组名"]').setValue('少年时期')
    await saveBtn(w).trigger('click')
    expect((overrideOf().groups as { label: string }[])[0].label).toBe('少年时期')

    await card(w).find('button[aria-label="删除分组"]').trigger('click')
    await saveBtn(w).trigger('click')
    expect(overrideOf().groups).toHaveLength(0)
  })

  it('放弃修改回到已保存的分组', async () => {
    const w = mountPanel()
    await card(w).findAll('.set-btn')[0].trigger('click')
    await card(w).findAll('.set-btn').find(b => b.text() === '保存分组')!.trigger('click')
    await card(w).findAll('.set-btn')[0].trigger('click')
    const discard = card(w).findAll('.set-btn').find(b => b.text() === '放弃修改')!
    await discard.trigger('click')
    expect(card(w).findAll('input[aria-label="分组名"]')).toHaveLength(1)
  })

  it('删掉一个组再新建，不会撞出同 key 同名（组数不等于序号）', async () => {
    const w = mountPanel()
    const addBtn = () => card(w).findAll('.set-btn')[0]
    await addBtn().trigger('click')
    await addBtn().trigger('click')
    await card(w).findAll('button[aria-label="删除分组"]')[0].trigger('click')
    await saveBtn(w).trigger('click')
    await addBtn().trigger('click')
    const names = card(w).findAll('input[aria-label="分组名"]').map(i => (i.element as HTMLInputElement).value)
    expect(names).toEqual(['分组 2', '分组 1'])
  })

  it('隐藏字段不参与分组', () => {
    // 先写覆写再挂载：挂载之后再 patch 不会同步反映到 DOM（要等 nextTick 重算）
    useDetailLayoutStore().patch('character', { hidden: ['age'] })
    const w = mountPanel()
    expect(card(w).findAll('select')).toHaveLength(1)
    expect(card(w).text()).toContain('出身')
  })
})

describe('命名预设（卡五）', () => {
  function card(w: VueWrapper) {
    return w.findAll('.set-card')[4]
  }

  it('无预设时如实说没有，而不是空列表', () => {
    expect(card(mountPanel()).text()).toContain('该类型还没有预设')
  })

  it('「存当前顺序」把该类型字段键存成一份新预设', async () => {
    const w = mountPanel()
    await card(w).find('input[aria-label="新预设名"]').setValue('设定资料')
    await card(w).findAll('.set-btn')[0].trigger('click')
    const orders = useFieldOrderStore().orders.character.presets['设定资料']
    expect(orders.order).toEqual(['title', 'age', 'origin'])
    expect(card(w).text()).toContain('设定资料')
  })

  it('应用预设切 active 并重排 registry 基准序，字段不增不减', async () => {
    const store2 = useFieldOrderStore()
    store2.savePreset('character', '重序', ['origin', 'age', 'title'])
    const w = mountPanel()
    const apply = card(w).findAll('.ds-btn-wide').find(b => b.text() === '应用')!
    await apply.trigger('click')
    expect(useFieldOrderStore().getActivePreset('character')).toBe('重序')
    expect(fieldRegistry.getFields('character').map(f => f.key)).toEqual(['origin', 'age', 'title'])
  })

  it('删预设走确认；取消则留着', async () => {
    useFieldOrderStore().savePreset('character', '重序', ['origin', 'age', 'title'])
    confirmMock.mockResolvedValueOnce(false as never)
    const w = mountPanel()
    await card(w).find('button[aria-label="删除预设"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(useFieldOrderStore().getPresetNames('character')).toContain('重序')

    await card(w).find('button[aria-label="删除预设"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(useFieldOrderStore().getPresetNames('character')).not.toContain('重序')
  })

  it('有预设时，顺序卡的提示说明基准序来自哪一档', () => {
    useFieldOrderStore().savePreset('character', '重序', ['origin', 'age', 'title'])
    const w = mountPanel()
    expect(w.findAll('.set-card')[1].text()).toContain('当前基准序来自预设「默认」')
  })
})

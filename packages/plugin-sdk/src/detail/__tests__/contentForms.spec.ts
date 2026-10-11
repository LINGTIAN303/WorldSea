import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import {
  activeContentForm,
  allContentForms,
  defaultContentConfig,
  getContentForm,
  registerContentForm,
  resolveContentConfig,
} from '../contentForms'
import { DEFAULT_CONTENT_FORM, resolveLayout } from '../detailLayout'
import EntityDetailForm from '../EntityDetailForm.vue'
import type { DetailFieldMeta } from '../fieldMeta'

/**
 * L2 内容形态注册表与分发守卫。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 *
 * 这里锁三件事：注册表自洽（默认值只有一份来源）、派生型编辑态回落分组式、
 * **分发真的按 contentForm 走**（不是五件里永远渲染第一件）。
 */

let pinia: Pinia
let wrapper: VueWrapper | undefined
const FIELDS: DetailFieldMeta[] = [
  { key: 'title', label: '名称', fieldType: 'text', source: 'builtin', scope: 'type' },
  { key: 'species', label: '种族', fieldType: 'text', source: 'builtin', scope: 'type' },
  { key: 'description', label: '描述', fieldType: 'textarea', source: 'builtin', scope: 'type' },
  { key: 'born', label: '出生', fieldType: 'date', source: 'builtin', scope: 'type' },
  { key: 'master', label: '师父', fieldType: 'entityRef', source: 'user', scope: 'entity' },
]
const ENTITY = {
  id: 'e1',
  type: 'character',
  name: '林渊',
  description: '少年**剑客**，守夜人',
  tags: [],
  properties: { species: '人族', born: '1420-03-01', master: 'e2' },
} as unknown as Entity

function mountForm(contentForm: string, editing = false): VueWrapper {
  const w = mount(EntityDetailForm, {
    props: {
      entity: ENTITY,
      fields: FIELDS,
      layout: resolveLayout(FIELDS.map(f => f.key), { contentForm }),
      editing,
      draft: {},
      entityLabel: '角色',
    },
    global: { plugins: [pinia] },
  })
  wrapper = w
  return w
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  useEntityStore().entityMap.set('e2', { ...ENTITY, id: 'e2', name: '沈砚' } as Entity)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('内容形态注册表', () => {
  it('五种内建形态齐全，缺省形态是唯一可就地编辑的那个', () => {
    expect(allContentForms().map(f => f.form)).toEqual(['grouped', 'table', 'narrative', 'summary', 'timeline'])
    expect(DEFAULT_CONTENT_FORM).toBe('grouped')
    expect(getContentForm('grouped')?.kind).toBe('inline')
  })

  it('每个形态都有可辨识的标签、图标与一句话说明（选择器不能渲染成空白按钮）', () => {
    for (const def of allContentForms()) {
      expect(def.label, def.form).not.toBe('')
      expect(def.icon, def.form).not.toBe('')
      expect(def.description, def.form).not.toBe('')
      expect(def.component, def.form).toBeTruthy()
    }
  })

  it('默认配置只由 configSchema 派生（不给第二份 defaultConfig 漂移的机会）', () => {
    for (const def of allContentForms()) {
      expect(Object.keys(defaultContentConfig(def.form)).sort(), def.form)
        .toEqual([...def.configSchema.map(f => f.key)].sort())
    }
  })

  it('重复注册同 id 被跳过，不覆盖已登记的形态', () => {
    registerContentForm({ ...getContentForm('table')!, label: '被覆盖了', component: {} as never, form: 'table', configSchema: [] })
    expect(getContentForm('table')?.label).toBe('表格式')
    expect(allContentForms().filter(f => f.form === 'table')).toHaveLength(1)
  })
})

describe('resolveContentConfig —— 缺键兜默认，多键不吞', () => {
  it('按 schema 默认打底', () => {
    expect(resolveContentConfig('summary')).toEqual({ maxChips: 14, showExcerpt: true })
    expect(resolveContentConfig('grouped')).toEqual({})
  })

  it('存储里的值覆盖默认，undefined 不算值', () => {
    expect(resolveContentConfig('summary', { maxChips: 4 }).maxChips).toBe(4)
    expect(resolveContentConfig('summary', { maxChips: undefined }).maxChips).toBe(14)
  })

  it('未注册的形态 id 也不炸（返回空配置，渲染侧另有回落）', () => {
    expect(resolveContentConfig('no-such-form', { a: 1 })).toEqual({ a: 1 })
  })
})

describe('activeContentForm —— 谁真的被渲染', () => {
  it('未注册 id 与派生型在编辑态都回落到分组式', () => {
    expect(activeContentForm('no-such-form', false)).toBe('grouped')
    expect(activeContentForm('table', true)).toBe('grouped')
    expect(activeContentForm('narrative', true)).toBe('grouped')
  })

  it('只读态各归其位；分组式自己编辑态不回落', () => {
    expect(activeContentForm('summary', false)).toBe('summary')
    expect(activeContentForm('timeline', false)).toBe('timeline')
    expect(activeContentForm('grouped', true)).toBe('grouped')
  })
})

describe('EntityDetailForm 分发', () => {
  it('形态选择器按注册顺序渲染全部形态，当前形态高亮', () => {
    const w = mountForm('table')
    const btns = w.findAll('.edf-form-btn')
    expect(btns).toHaveLength(5)
    expect(btns.map(b => b.text())).toEqual(['分组式', '表格式', '段落式', '摘要式', '时间轴式'])
    expect(btns[1].classes()).toContain('is-active')
  })

  it('contentForm 决定渲染哪一个：表格式出表格、摘要式出属性牌、分组式出行', () => {
    expect(mountForm('table').find('.ws-dt').exists()).toBe(true)
    expect(mountForm('table').find('.dfm-group').exists()).toBe(false)
    expect(mountForm('summary').findAll('.dfs-chip').length).toBeGreaterThan(0)
    expect(mountForm('grouped').findAll('.dfm-group').length).toBeGreaterThan(0)
    expect(mountForm('narrative').find('.dfm-para').text()).toContain('少年剑客')
    // 段落式真的走富文本渲染：markdown 源要变成结构，而不是把 `**` 原样贴在正文里
    const md = mountForm('narrative')
    expect(md.find('.dfm-para-text').html()).toContain('<strong>剑客</strong>')
    expect(md.find('.dfm-para-text').text()).not.toContain('**')
    expect(mountForm('timeline').find('.dft-node').text()).toContain('1420-03-01')
  })

  it('只读形态把 entityRef 解成实体名，不显示裸 ID', () => {
    const w = mountForm('table')
    expect(w.find('.ws-dt').text()).toContain('沈砚')
    expect(w.find('.ws-dt').text()).not.toContain('e2')
  })

  it('派生形态在编辑态回落分组式并说明原因，写入口仍只有一条', () => {
    const w = mountForm('timeline', true)
    expect(w.find('.dft-node').exists()).toBe(false)
    expect(w.findAll('.edf-row').length).toBeGreaterThan(0)
    expect(w.find('.edf-form-hint').text()).toContain('编辑中暂用分组式')
    // 高亮留在用户选的形态上，而不是回落后的分组式
    expect(w.findAll('.edf-form-btn')[4].classes()).toContain('is-active')
  })

  it('点形态按钮发 change-form（由载体落盘，本件不直写存储）', async () => {
    const w = mountForm('grouped')
    await w.findAll('.edf-form-btn')[2].trigger('click')
    expect(w.emitted('change-form')?.[0]).toEqual(['narrative'])
  })

  it('芽补充区与保存条不随形态变化而丢失', async () => {
    const w = mountForm('summary')
    await w.setProps({ editing: true })
    expect(w.find('.edf-actions').exists()).toBe(true)
    expect(w.find('.edf-add').exists()).toBe(true)
  })
})

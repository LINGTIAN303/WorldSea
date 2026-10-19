/**
 * formsRegistration 单测 —— **真实注册表**的守卫（与 formRegistry.spec 互补）。
 *
 * formRegistry.spec 用假定义覆盖注册表机制；本文件用 `initializeForms()` 注册真实形式，
 * 守住三类最容易悄悄坏掉的东西：
 *  ① icon 名必须是 ui-kit lucideMap 里真实存在的 id（**批次 1 踩过**：`icon: 'list'` 未注册 → 渲染为空）
 *  ② defaultConfig 必须覆盖 configSchema 的每个 key（避免「面板有项、但默认值缺失」）
 *  ③ select 字段的 default 必须落在自己的 options 内（避免默认值不在选项里）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { initializeForms, resetFormsInitialization } from '../board/forms/initializeForms'
import { getAllForms, getForm, resolveFormConfig } from '../board/forms/registry'
import { hasLucideIcon } from '@worldsea/ui-kit/components/lucideMap'

beforeAll(() => {
  resetFormsInitialization()
  initializeForms()
})

describe('formsRegistration / 真实注册表', () => {
  it('十一种表现形式均已注册，且 form 标识唯一', () => {
    const forms = getAllForms().map(d => d.form)
    for (const expected of ['title', 'card', 'question', 'paragraph', 'script', 'sentence', 'tree', 'table', 'storyline', 'progress', 'refs']) {
      expect(forms).toContain(expected)
    }
    expect(new Set(forms).size).toBe(forms.length)
    expect(forms).toHaveLength(11)
  })

  it('每个形式：label 非空、component 已挂载、defaultHeight 为正', () => {
    for (const def of getAllForms()) {
      expect(def.label.trim().length).toBeGreaterThan(0)
      expect(def.component).toBeTruthy()
      expect(Number(def.defaultHeight)).toBeGreaterThan(0)
    }
  })

  it('icon 必须是 lucideMap 里真实存在的 id（否则渲染为空节点）', () => {
    for (const def of getAllForms()) {
      expect(hasLucideIcon(def.icon), `${def.form} 的 icon「${def.icon}」未注册`).toBe(true)
    }
  })

  it('defaultConfig 覆盖 configSchema 的每个 key', () => {
    for (const def of getAllForms()) {
      for (const field of def.configSchema) {
        expect(
          Object.prototype.hasOwnProperty.call(def.defaultConfig, field.key),
          `${def.form}.defaultConfig 缺少 ${field.key}`,
        ).toBe(true)
      }
    }
  })

  it('select 字段的 default 落在自身 options 内', () => {
    for (const def of getAllForms()) {
      for (const field of def.configSchema.filter(f => f.type === 'select')) {
        const values = (field.options ?? []).map(o => o.value)
        expect(values.length, `${def.form}.${field.key} 没有选项`).toBeGreaterThan(0)
        expect(values, `${def.form}.${field.key} 的默认值不在选项内`).toContain(field.default)
      }
    }
  })

  it('multi-select 字段：默认是非空数组、每项在 options 内、满足 minSelected', () => {
    for (const def of getAllForms()) {
      for (const field of def.configSchema.filter(f => f.type === 'multi-select')) {
        const values = (field.options ?? []).map(o => String(o.value))
        expect(values.length, `${def.form}.${field.key} 没有选项`).toBeGreaterThan(0)
        expect(Array.isArray(field.default), `${def.form}.${field.key} 默认值不是数组`).toBe(true)
        const selected = field.default as string[]
        expect(
          selected.length,
          `${def.form}.${field.key} 默认值少于 minSelected`,
        ).toBeGreaterThanOrEqual(field.minSelected ?? 1)
        for (const v of selected) {
          expect(values, `${def.form}.${field.key} 的默认项「${v}」不在选项内`).toContain(v)
        }
      }
    }
  })

  it('表格式提供列选择（含新增的节点类型 / 所属线索）', () => {
    const field = (getForm('table')?.configSchema ?? []).find(f => f.key === 'columns')
    expect(field?.type).toBe('multi-select')
    expect(field?.minSelected).toBe(1)
    expect((field?.options ?? []).map(o => o.value)).toEqual([
      'title', 'order', 'status', 'wordCount', 'nodeType', 'storylines',
    ])
  })

  it('五视图的信息密度配置键均已声明', () => {
    const keysOf = (form: string): string[] =>
      (getForm(form)?.configSchema ?? []).map(f => f.key)
    expect(keysOf('tree')).toContain('expandDepth')
    expect(keysOf('storyline')).toEqual(expect.arrayContaining(['maxLines', 'maxTags', 'sortBy']))
    expect(keysOf('progress')).toContain('maxStorylines')
    expect(keysOf('refs')).toContain('maxGroups')
  })

  it('resolveFormConfig 对每个形式都能取到全部 schema key（缺配置也不留空）', () => {
    for (const def of getAllForms()) {
      const resolved = resolveFormConfig(def.form)
      for (const field of def.configSchema) {
        expect(resolved[field.key], `${def.form}.${field.key} 解析后为 undefined`).toBeDefined()
      }
    }
  })

  it('派生型（表格式 / 线索式 / 进度式 / 关联实体）只读；标题式 / 树式 / 句子式可就地编辑', () => {
    expect(getForm('table')?.kind).toBe('derived')
    expect(getForm('storyline')?.kind).toBe('derived')
    expect(getForm('progress')?.kind).toBe('derived')
    // 关联实体徽章读的是**关系表**（不是节点字段），只能派生只读
    expect(getForm('refs')?.kind).toBe('derived')
    expect(getForm('title')?.kind).toBe('inline')
    expect(getForm('sentence')?.kind).toBe('inline')
    expect(getForm('tree')?.kind).toBe('inline')
  })

  it('线索式 / 进度式都提供范围配置（all / this）', () => {
    for (const form of ['storyline', 'progress']) {
      const scope = (getForm(form)?.configSchema ?? []).find(f => f.key === 'scope')
      expect(scope, `${form} 缺少 scope 配置`).toBeTruthy()
      expect(scope?.type).toBe('select')
      expect((scope?.options ?? []).map(o => o.value)).toEqual(['all', 'this'])
    }
  })

  it('句子式的软上限与行数是数字型配置（组件按数字解析）', () => {
    const sentence = getForm('sentence')
    const keys = (sentence?.configSchema ?? []).map(f => f.key)
    expect(keys).toContain('maxLines')
    expect(keys).toContain('charLimit')
  })
})

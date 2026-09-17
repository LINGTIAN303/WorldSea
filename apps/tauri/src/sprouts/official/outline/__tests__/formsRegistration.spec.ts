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
  it('六种表现形式均已注册，且 form 标识唯一', () => {
    const forms = getAllForms().map(d => d.form)
    for (const expected of ['title', 'sentence', 'tree', 'table', 'storyline', 'progress']) {
      expect(forms).toContain(expected)
    }
    expect(new Set(forms).size).toBe(forms.length)
    expect(forms).toHaveLength(6)
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

  it('resolveFormConfig 对每个形式都能取到全部 schema key（缺配置也不留空）', () => {
    for (const def of getAllForms()) {
      const resolved = resolveFormConfig(def.form)
      for (const field of def.configSchema) {
        expect(resolved[field.key], `${def.form}.${field.key} 解析后为 undefined`).toBeDefined()
      }
    }
  })

  it('派生型（表格式 / 线索式 / 进度式）只读；标题式 / 树式 / 句子式可就地编辑', () => {
    expect(getForm('table')?.kind).toBe('derived')
    expect(getForm('storyline')?.kind).toBe('derived')
    expect(getForm('progress')?.kind).toBe('derived')
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

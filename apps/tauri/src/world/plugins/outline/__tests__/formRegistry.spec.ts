/**
 * formRegistry 单测 —— 表现形式注册表 + 标题式编号/缩进/层级纯函数。
 *
 * 注册表用「假组件」注册（不 import 真 Vue 组件），保证测试轻量与快速；
 * 编号类纯函数是标题式呈现的全部规则，独立覆盖。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerForm,
  getForm,
  getAllForms,
  getFormsByKind,
  resolveFormConfig,
  clearForms,
  type FormDefinition,
} from '../board/forms/registry'
import {
  MAX_HEADING_LEVEL,
  MAX_INDENT_DEPTH,
  composeTitleLine,
  depthToHeadingLevel,
  formatNumbering,
  indentForDepth,
  shouldDegradeToListItem,
  toChineseNumber,
  toRomanNumber,
} from '../board/forms/titleNumbering'

/** 最小假定义：component 用字符串占位（注册表只存引用，不渲染） */
function fakeDef(form: string, over: Partial<FormDefinition> = {}): FormDefinition {
  return {
    form,
    label: form,
    icon: 'outline',
    kind: 'inline',
    defaultHeight: 32,
    defaultConfig: { a: 1 },
    configSchema: [
      { key: 'a', label: 'A', type: 'number', default: 1 },
      { key: 'b', label: 'B', type: 'select', options: [{ value: 'x', label: 'X' }], default: 'x' },
    ],
    component: 'FAKE' as unknown as FormDefinition['component'],
    ...over,
  }
}

beforeEach(() => {
  clearForms()
})

describe('formRegistry / 注册与查询', () => {
  it('注册后可按 form 取回', () => {
    registerForm(fakeDef('title'))
    expect(getForm('title')?.form).toBe('title')
    expect(getAllForms()).toHaveLength(1)
  })

  it('幂等：重复注册同 form 不覆盖已有定义', () => {
    registerForm(fakeDef('title', { label: '第一次' }))
    registerForm(fakeDef('title', { label: '第二次' }))
    expect(getAllForms()).toHaveLength(1)
    expect(getForm('title')?.label).toBe('第一次')
  })

  it('按 kind 过滤', () => {
    registerForm(fakeDef('title', { kind: 'inline' }))
    registerForm(fakeDef('table', { kind: 'derived' }))
    expect(getFormsByKind('inline').map(d => d.form)).toEqual(['title'])
    expect(getFormsByKind('derived').map(d => d.form)).toEqual(['table'])
  })

  it('未注册的 form 查不到（调用方需自行兜底）', () => {
    expect(getForm('nope')).toBeUndefined()
  })
})

describe('formRegistry / resolveFormConfig', () => {
  it('默认值 + 覆盖值合并', () => {
    registerForm(fakeDef('title'))
    expect(resolveFormConfig('title', { a: 9 })).toEqual({ a: 9, b: 'x' })
  })

  it('缺键用 configSchema 默认补齐；undefined 不覆盖默认', () => {
    registerForm(fakeDef('title'))
    expect(resolveFormConfig('title', { a: undefined })).toEqual({ a: 1, b: 'x' })
  })

  it('未注册 form 时仍返回传入配置（不抛错）', () => {
    expect(resolveFormConfig('ghost', { z: 3 })).toEqual({ z: 3 })
  })

  it('不修改传入对象（纯函数）', () => {
    registerForm(fakeDef('title'))
    const input = { a: 5 }
    resolveFormConfig('title', input)
    expect(input).toEqual({ a: 5 })
  })
})

describe('titleNumbering / 数字格式', () => {
  it('中文数字（含十位与 10 的边界）', () => {
    expect(toChineseNumber(1)).toBe('一')
    expect(toChineseNumber(9)).toBe('九')
    expect(toChineseNumber(10)).toBe('十')
    expect(toChineseNumber(11)).toBe('十一')
    expect(toChineseNumber(20)).toBe('二十')
    expect(toChineseNumber(23)).toBe('二十三')
  })

  it('罗马数字', () => {
    expect(toRomanNumber(1)).toBe('I')
    expect(toRomanNumber(4)).toBe('IV')
    expect(toRomanNumber(9)).toBe('IX')
    expect(toRomanNumber(14)).toBe('XIV')
  })
})

describe('titleNumbering / formatNumbering', () => {
  it('none 恒为空串', () => {
    expect(formatNumbering([1, 2, 3], 'none')).toBe('')
  })

  it('numeric 点分', () => {
    expect(formatNumbering([1, 2, 3], 'numeric')).toBe('1.2.3')
  })

  it('chinese 逐层换样式', () => {
    expect(formatNumbering([1], 'chinese')).toBe('一、')
    expect(formatNumbering([1, 2], 'chinese')).toBe('一、（二）')
    expect(formatNumbering([2, 2, 1], 'chinese')).toBe('二、（二）1.')
    expect(formatNumbering([2, 2, 1, 3], 'chinese')).toBe('二、（二）1.(3)')
  })

  it('roman 首层罗马、其后点分', () => {
    expect(formatNumbering([2], 'roman')).toBe('II')
    expect(formatNumbering([2, 3], 'roman')).toBe('II.3')
  })

  it('空链返回空串（任何样式）', () => {
    for (const s of ['none', 'numeric', 'chinese', 'roman'] as const) {
      expect(formatNumbering([], s)).toBe('')
    }
  })
})

describe('titleNumbering / 缩进与层级映射', () => {
  it('缩进随深度递增并在上限处停止累加', () => {
    expect(indentForDepth(0)).toBe(0)
    expect(indentForDepth(2)).toBe(32)
    expect(indentForDepth(MAX_INDENT_DEPTH + 5)).toBe(indentForDepth(MAX_INDENT_DEPTH))
  })

  it('层级 → 标题层级（1 基，夹在 H1–H6）', () => {
    expect(depthToHeadingLevel(0)).toBe(1)
    expect(depthToHeadingLevel(5)).toBe(6)
    expect(depthToHeadingLevel(9)).toBe(MAX_HEADING_LEVEL)
  })

  it('超深层级降级为列表项（缩进停止与导出规则一致）', () => {
    expect(shouldDegradeToListItem(MAX_INDENT_DEPTH - 1)).toBe(false)
    expect(shouldDegradeToListItem(MAX_INDENT_DEPTH)).toBe(true)
  })
})

describe('titleNumbering / composeTitleLine', () => {
  it('拼接编号与标题；空名回落占位', () => {
    expect(composeTitleLine('第三章', [1, 2], 'numeric')).toBe('1.2 第三章')
    expect(composeTitleLine('  ', [1], 'numeric')).toBe('1 未命名节点')
    expect(composeTitleLine('第三章', [1], 'none')).toBe('第三章')
  })
})

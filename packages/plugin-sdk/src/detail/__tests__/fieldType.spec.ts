import { describe, expect, it } from 'vitest'

import { CONTROL_SPEC, controlSpecFor, nativeInputType } from '../fieldControlMap'
import { normalizeFieldType, isArrayValueField, NORMALIZED_FIELD_TYPES } from '../fieldType'
import { emptyValueFor, toArrayValue, toDisplayText, toInputText, stripHtml } from '../fieldValue'

describe('normalizeFieldType —— 命名漂移的唯一吸收点', () => {
  it('规范名原样归一', () => {
    for (const t of ['text', 'textarea', 'number', 'boolean', 'date', 'select', 'tags', 'color', 'image', 'formula', 'url', 'email'] as const) {
      expect(normalizeFieldType(t)).toBe(t)
    }
  })

  it('camelCase 漂移（multiSelect / entityRef）识别', () => {
    expect(normalizeFieldType('multiSelect')).toBe('multiSelect')
    expect(normalizeFieldType('entityRef')).toBe('entityRef')
  })

  it('连字符与旧别名归一（三套实现各写各的历史来源）', () => {
    expect(normalizeFieldType('multi-select')).toBe('multiSelect')
    expect(normalizeFieldType('entity-ref')).toBe('entityRef')
    expect(normalizeFieldType('entity-refs')).toBe('entityRef')
    expect(normalizeFieldType('text-long')).toBe('textarea')
  })

  it('richtext 保持独立类型（并轨时不能把弹窗的富文本编辑降级成 textarea）', () => {
    expect(normalizeFieldType('richtext')).toBe('richtext')
    expect(normalizeFieldType('richText')).toBe('richtext')
    expect(controlSpecFor(normalizeFieldType('richtext')).kind).toBe('richtext')
  })

  it('大小写与空白不影响结果', () => {
    expect(normalizeFieldType('  ENTITYREF ')).toBe('entityRef')
    expect(normalizeFieldType('MULTISELECT')).toBe('multiSelect')
  })

  it('空值按 text，未识别显式 unknown —— 不得静默转 text', () => {
    expect(normalizeFieldType(undefined)).toBe('text')
    expect(normalizeFieldType('')).toBe('text')
    expect(normalizeFieldType('weirdType')).toBe('unknown')
  })
})

describe('CONTROL_SPEC —— 映射表与类型全集对齐', () => {
  it('键集合 === 归一类型全集（新增类型未配控件即报红）', () => {
    expect(Object.keys(CONTROL_SPEC).sort()).toEqual([...NORMALIZED_FIELD_TYPES].sort())
  })

  it('越界类型回落 unsupported', () => {
    expect(controlSpecFor('notARealType' as never).kind).toBe('unsupported')
  })

  it('entityRef 整行且可写（裸 ID 缺陷的控件面闸门）', () => {
    const spec = controlSpecFor(normalizeFieldType('entityRef'))
    expect(spec.kind).toBe('entityRef')
    expect(spec.fullWidth).toBe(true)
    expect(spec.editable).toBe(true)
  })

  it('formula 只读、unknown 不可写', () => {
    expect(controlSpecFor('formula')).toMatchObject({ kind: 'static', editable: false })
    expect(controlSpecFor('unknown')).toMatchObject({ kind: 'unsupported', editable: false })
  })

  it('原生 input 类型只在 number/url/email 上偏离 text', () => {
    expect(nativeInputType('number')).toBe('number')
    expect(nativeInputType('url')).toBe('url')
    expect(nativeInputType('email')).toBe('email')
    expect(nativeInputType('text')).toBe('text')
    expect(nativeInputType('formula')).toBe('text')
  })
})

describe('fieldValue —— 值形态（数组落库为既定口径）', () => {
  it('isArrayValueField 只认 multiSelect', () => {
    expect(isArrayValueField('multiSelect')).toBe(true)
    expect(isArrayValueField('tags')).toBe(false)
    expect(isArrayValueField('text')).toBe(false)
  })

  it('toArrayValue 兼容数组、逗号串、空值', () => {
    expect(toArrayValue(['炼金', '食用'])).toEqual(['炼金', '食用'])
    expect(toArrayValue('炼金, 食用,,制毒')).toEqual(['炼金', '食用', '制毒'])
    expect(toArrayValue('单值')).toEqual(['单值'])
    expect(toArrayValue(null)).toEqual([])
    expect(toArrayValue([])).toEqual([])
  })

  it('toInputText 数组并读不丢信息', () => {
    expect(toInputText(['a', 'b'])).toBe('a、b')
    expect(toInputText(null)).toBe('')
  })

  it('toDisplayText：空值统一「—」，布尔统一「是/否」，数组并读', () => {
    expect(toDisplayText('', 'text')).toBe('—')
    expect(toDisplayText(undefined, 'text')).toBe('—')
    expect(toDisplayText(true, 'boolean')).toBe('是')
    expect(toDisplayText(false, 'boolean')).toBe('否')
    expect(toDisplayText(['炼金'], 'multiSelect')).toBe('炼金')
    expect(toDisplayText([], 'tags')).toBe('—')
    expect(toDisplayText('<b>粗</b>', 'textarea')).toBe('粗')
  })

  it('stripHtml 还原实体后再剥标签', () => {
    expect(stripHtml('&lt;code&gt;')).toBe('<code>')
    expect(stripHtml('')).toBe('')
  })

  it('emptyValueFor 按类型给默认（数组型给数组）', () => {
    expect(emptyValueFor('multiSelect')).toEqual([])
    expect(emptyValueFor('number')).toBe(0)
    expect(emptyValueFor('boolean')).toBe(false)
    expect(emptyValueFor('text')).toBe('')
    expect(emptyValueFor('tags')).toBe('')
  })
})

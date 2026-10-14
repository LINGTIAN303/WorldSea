/** 批8：formFields 派生兜底——基础字段前置 + fieldRegistry builtin 追加 + 去重 */
import { describe, expect, it } from 'vitest'

import { fieldRegistry } from '@worldsea/entity-core'
import { BASE_FORM_FIELDS, deriveFormFields } from '../formFields'

describe('deriveFormFields', () => {
  it('基础字段前置（name/description/tags）', () => {
    const fields = deriveFormFields('zz-derive-test')
    expect(fields.map(f => f.key)).toEqual(['name', 'description', 'tags'])
    expect(fields[0]!.required).toBe(true)
  })

  it('fieldRegistry builtin 追加在基础字段之后、去重', () => {
    fieldRegistry.registerBuiltin('zz-derive-test', [
      { key: 'name', label: '重名（应去重）', fieldType: 'text' },
      { key: 'color', label: '颜色', fieldType: 'text' },
    ])
    const fields = deriveFormFields('zz-derive-test')
    expect(fields.map(f => f.key)).toEqual(['name', 'description', 'tags', 'color'])
    expect(fields.find(f => f.key === 'name')!.label).toBe('名称') // 基础字段声明不被 builtin 重名覆盖
  })
})

/** 批7 走查回归（真机临时 harness 转正）：schema 覆盖删除回落后，entitySchemaRegistry 与 fieldRegistry 必须双回落。
 *  走查实证：fieldRegistry.registerBuiltin 旧追加语义导致覆盖新增的 builtin 字段残留——replaceBuiltin 修复钉死。 */
import { describe, expect, it } from 'vitest'
import { entitySchemaRegistry, fieldRegistry, pluginAPI, setSchemaOverlays } from '../../index'

const TYPE = 'zz-fallback-test'
const BASE_PARAMS = { type: TYPE, label: '回落测试', traits: [], ownFields: [{ key: 'baseField', label: '基础', fieldType: 'text' as const }] }

describe('schema 覆盖回落（双 registry 清理）', () => {
  it('覆盖追加字段 → 删除覆盖回落：entitySchemaRegistry 与 fieldRegistry 均无残留', () => {
    // ① 内置基线
    pluginAPI.registerEntityV2({ ...BASE_PARAMS })
    expect(fieldRegistry.getFields(TYPE).map(f => f.key)).toEqual(['baseField'])

    // ② 覆盖生效：ownFields 追加 extraField
    setSchemaOverlays(new Map([[TYPE, { type: TYPE, ownFields: [{ key: 'extraField', label: '覆盖追加', fieldType: 'text' }] }]]))
    pluginAPI.registerEntityV2({ ...BASE_PARAMS })
    expect(fieldRegistry.getFields(TYPE).map(f => f.key)).toEqual(['baseField', 'extraField'])
    expect(entitySchemaRegistry.get(TYPE)!.fields.map(f => f.key)).toContain('extraField')

    // ③ 删除覆盖回落：两 registry 均无 extraField 残留（走查发现的 fieldRegistry 残留在此钉死）
    setSchemaOverlays(new Map())
    pluginAPI.registerEntityV2({ ...BASE_PARAMS })
    expect(fieldRegistry.getFields(TYPE).map(f => f.key)).toEqual(['baseField'])
    expect(entitySchemaRegistry.get(TYPE)!.fields.map(f => f.key)).toEqual(['baseField'])
  })
})

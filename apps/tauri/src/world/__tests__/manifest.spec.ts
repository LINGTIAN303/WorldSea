/**
 * 树插件清单校验（B 批）：形状门禁——非法即拒、给可读原因，不静默修补。
 */
import { describe, expect, it } from 'vitest'
import { validateManifest } from '../manifest'

const valid = {
  id: 'ws.demo.plugin',
  name: '示例',
  version: '1.0.0',
  description: '一句话说明',
}

describe('validateManifest', () => {
  it('合法清单通过（requires 可省）', () => {
    const check = validateManifest({ ...valid })
    expect(check.ok).toBe(true)
  })

  it('id 形状：须小写点分且 ≥2 段', () => {
    for (const id of ['demo', 'Demo.Plugin', 'ws..x', 'ws.', '', 42]) {
      const check = validateManifest({ ...valid, id })
      expect(check.ok, `id=${String(id)} 应被拒`).toBe(false)
    }
    expect(validateManifest({ ...valid, id: 'ws.demo.plugin' }).ok).toBe(true)
  })

  it('name / description 不得为空，version 须 x.y.z 起头', () => {
    expect(validateManifest({ ...valid, name: '  ' }).ok).toBe(false)
    expect(validateManifest({ ...valid, description: '' }).ok).toBe(false)
    expect(validateManifest({ ...valid, version: 'v1' }).ok).toBe(false)
    expect(validateManifest({ ...valid, version: '1.2.3-beta.1' }).ok).toBe(true)
  })

  it('requires 若给则须为非空字符串数组', () => {
    expect(validateManifest({ ...valid, requires: ['world.info'] }).ok).toBe(true)
    expect(validateManifest({ ...valid, requires: [] }).ok).toBe(true)
    expect(validateManifest({ ...valid, requires: 'world.info' }).ok).toBe(false)
    expect(validateManifest({ ...valid, requires: [''] }).ok).toBe(false)
  })

  it('domain / secondaryDomains 若给则须为非空字符串 / 字符串数组', () => {
    expect(validateManifest({ ...valid, domain: 'life' }).ok).toBe(true)
    expect(validateManifest({ ...valid, domain: '' }).ok).toBe(false)
    expect(validateManifest({ ...valid, domain: 42 }).ok).toBe(false)
    expect(validateManifest({ ...valid, secondaryDomains: ['society'] }).ok).toBe(true)
    expect(validateManifest({ ...valid, secondaryDomains: 'society' }).ok).toBe(false)
    expect(validateManifest({ ...valid, secondaryDomains: [''] }).ok).toBe(false)
  })

  it('entityTypes 若给则须为字符串数组、元素非空且不重复；空数组合法', () => {
    expect(validateManifest({ ...valid, entityTypes: ['character'] }).ok).toBe(true)
    expect(validateManifest({ ...valid, entityTypes: [] }).ok).toBe(true)
    expect(validateManifest({ ...valid, entityTypes: 'character' }).ok).toBe(false)
    expect(validateManifest({ ...valid, entityTypes: [''] }).ok).toBe(false)
    expect(validateManifest({ ...valid, entityTypes: ['x', 'x'] }).ok).toBe(false)
  })

  it('非对象一律拒', () => {
    for (const value of [null, undefined, 'x', 1, []]) {
      expect(validateManifest(value).ok).toBe(false)
    }
  })
})

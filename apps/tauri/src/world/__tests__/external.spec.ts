/**
 * 外部插件装载器（批1）：求值器 + 收集器。
 * 求值器 = 纯函数全覆盖；收集器经注入 IO（不经 Tauri），钉目录缺失空集 / 失败隔离 /
 * ws. 前缀与文件名一致性。
 */
import { describe, expect, it } from 'vitest'

import { collectExternalPlugins, evaluateExternalPlugin, type ExternalIo } from '../external'
import { createRequire } from '../modules'

const require = createRequire()

const VALID = `(require) => ({ manifest: { id: 'ws.demo', name: '示例', version: '0.1.0', description: 'x' }, apply() {} })`

describe('evaluateExternalPlugin（求值器）', () => {
  it('合法工厂 → ok，产出 manifest + apply', () => {
    const result = evaluateExternalPlugin(VALID, require)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.id).toBe('ws.demo')
      expect(typeof result.apply).toBe('function')
    }
  })

  it('语法错误 → 可读 reason（不抛）', () => {
    const result = evaluateExternalPlugin('(require) => ({', require)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('语法错误')
  })

  it('非函数表达式 / 工厂返回非对象 → 拒', () => {
    expect(evaluateExternalPlugin('42', require).ok).toBe(false)
    const nonObject = evaluateExternalPlugin('() => 42', require)
    expect(nonObject.ok).toBe(false)
    if (!nonObject.ok) expect(nonObject.reason).toContain('不是对象')
  })

  it('工厂执行抛错 → 隔离为 reason', () => {
    const result = evaluateExternalPlugin('() => { throw new Error("boom") }', require)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('boom')
  })

  it('清单非法 / apply 缺失 → 拒（原因来自 manifest 校验面）', () => {
    const badId = evaluateExternalPlugin(`() => ({ manifest: { id: 'Bad Id', name: 'x', version: '1.0.0', description: 'x' }, apply() {} })`, require)
    expect(badId.ok).toBe(false)
    const noApply = evaluateExternalPlugin(`() => ({ manifest: { id: 'ws.demo', name: 'x', version: '1.0.0', description: 'x' } })`, require)
    expect(noApply.ok).toBe(false)
    if (!noApply.ok) expect(noApply.reason).toContain('apply')
  })
})

/** 内存 IO（收集器测试注入）。 */
function memoryIo(files: Record<string, string>): ExternalIo {
  return {
    async list(dir) {
      // 目录名任意——测试只关心文件集
      void dir
      return Object.keys(files).map(name => ({ name, isDir: false }))
    },
    async read(path) {
      const name = path.split('/').pop() ?? ''
      const hit = files[name]
      if (hit === undefined) throw new Error('ENOENT')
      return hit
    },
  }
}

describe('collectExternalPlugins（收集器）', () => {
  it('目录缺失 / 无项目目录 → 空报告（不算错）', async () => {
    const empty = await collectExternalPlugins(null, memoryIo({}))
    expect(empty.plugins).toEqual([])
    expect(empty.rejected).toEqual([])
    const missing = await collectExternalPlugins('C:/proj/worlddata', {
      async list() { return null },
      async read() { throw new Error('unreachable') },
    })
    expect(missing.plugins).toEqual([])
  })

  it('成功收集：插件进 plugins、源码进 codes（指纹）', async () => {
    const report = await collectExternalPlugins('C:/proj/worlddata', memoryIo({ 'ws.demo.js': VALID }))
    expect(report.plugins).toHaveLength(1)
    expect(report.plugins[0]!.manifest.id).toBe('ws.demo')
    expect(report.codes.get('ws.demo')).toBe(VALID)
  })

  it('失败隔离：坏文件进 rejected，好文件照常收集', async () => {
    const report = await collectExternalPlugins('C:/proj/worlddata', memoryIo({
      'ws.bad.js': '(require) => ({',
      'ws.demo.js': VALID,
    }))
    expect(report.plugins.map(p => p.manifest.id)).toEqual(['ws.demo'])
    expect(report.rejected).toHaveLength(1)
    expect(report.rejected[0]!.file).toContain('ws.bad.js')
  })

  it('id 域守卫：非 ws. 前缀拒；id 与文件名不一致拒', async () => {
    const report = await collectExternalPlugins('C:/proj/worlddata', memoryIo({
      'official.spoof.js': `() => ({ manifest: { id: 'official.spoof', name: '冒名', version: '1.0.0', description: 'x' }, apply() {} })`,
      'ws.mismatch.js': `() => ({ manifest: { id: 'ws.other', name: '错位', version: '1.0.0', description: 'x' }, apply() {} })`,
    }))
    expect(report.plugins).toEqual([])
    expect(report.rejected.some(entry => entry.reason.includes('ws.'))).toBe(true)
    expect(report.rejected.some(entry => entry.reason.includes('文件名'))).toBe(true)
  })
})

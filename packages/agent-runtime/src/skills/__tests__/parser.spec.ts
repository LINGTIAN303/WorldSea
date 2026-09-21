/**
 * frontmatter 解析器契约测试（S1 协议基座，2026-09-17）
 *
 * 覆盖三类：① 存量块式回归（原有形态不得破坏）② 协议基座新增能力
 * （flow 数组 / 规范空格分隔 allowed-tools / metadata 映射 / 缩进判定嵌套）③ 空/异常输入。
 */

import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../parser'

/** 包一层 frontmatter 便于书写用例 */
function fmOf(yaml: string): ReturnType<typeof parseFrontmatter>['frontmatter'] {
  return parseFrontmatter(`---\n${yaml}\n---\nbody`).frontmatter
}

describe('parseFrontmatter · 存量块式回归', () => {
  it('块式 allowed-tools / base-tools', () => {
    const fm = fmOf(['name: demo', 'description: d', 'allowedTools:', '  - entity_list', '  - content_search', 'baseTools:', '  - read_file'].join('\n'))
    expect(fm.allowedTools).toEqual(['entity_list', 'content_search'])
    expect(fm.baseTools).toEqual(['read_file'])
  })

  it('capabilities 三通道（块式嵌套）', () => {
    const fm = fmOf(
      [
        'name: demo',
        'description: d',
        'capabilities:',
        '  internal:',
        '    - a',
        '  cli:',
        '    - b',
        '  mcp:',
        '    - c',
      ].join('\n'),
    )
    expect(fm.capabilities).toEqual({ internal: ['a'], cli: ['b'], mcp: ['c'] })
  })

  it('schemaContext.entityTypes（kebab 键）', () => {
    const fm = fmOf(['name: demo', 'description: d', 'schema-context:', '  entity-types:', '    - 角色', '    - 地点'].join('\n'))
    expect(fm.schemaContext).toEqual({ entityTypes: ['角色', '地点'], fieldPolicy: 'prefer-defined' })
  })

  it('无 capabilities 时 allowedTools 兜底并入 internal', () => {
    const fm = fmOf(['name: demo', 'description: d', 'allowedTools:', '  - entity_list'].join('\n'))
    expect(fm.capabilities).toEqual({ internal: ['entity_list'], cli: [], mcp: [] })
  })

  it('无 frontmatter 时 body 原样返回', () => {
    const parsed = parseFrontmatter('# 纯 Markdown 正文')
    expect(parsed.body).toBe('# 纯 Markdown 正文')
    expect(parsed.frontmatter.name).toBe('')
    expect(parsed.frontmatter.allowedTools).toEqual([])
  })
})

describe('parseFrontmatter · 协议基座新增能力', () => {
  it('flow 数组：tags 与 allowed-tools（修复 atlas/timeline 类形态）', () => {
    const fm = fmOf(
      ['name: demo', 'description: d', 'tags: [a, b]', 'allowed-tools: [x, y]', 'triggers: [t1, t2]'].join('\n'),
    )
    expect(fm.tags).toEqual(['a', 'b'])
    expect(fm.allowedTools).toEqual(['x', 'y'])
    expect(fm.triggers).toEqual(['t1', 't2'])
  })

  it('flow 空数组视为空列表', () => {
    const fm = fmOf(['name: demo', 'description: d', 'tags: []'].join('\n'))
    expect(fm.tags).toBeUndefined()
  })

  it('规范形态：allowed-tools 空格分隔字符串', () => {
    const fm = fmOf(['name: demo', 'description: d', 'allowed-tools: Bash(git:*) Read write_file'].join('\n'))
    expect(fm.allowedTools).toEqual(['Bash(git:*)', 'Read', 'write_file'])
  })

  it('逗号分隔字符串（tags / capabilities 子通道）', () => {
    const fm = fmOf(['name: demo', 'description: d', 'tags: a, b, c', 'capabilities:', '  internal: x, y'].join('\n'))
    expect(fm.tags).toEqual(['a', 'b', 'c'])
    expect(fm.capabilities?.internal).toEqual(['x', 'y'])
  })

  it('带引号的列表项去引号', () => {
    const fm = fmOf(['name: demo', 'description: d', 'tags: ["含空格的标签", plain]'].join('\n'))
    expect(fm.tags).toEqual(['含空格的标签', 'plain'])
  })

  it('metadata 映射（含 worldsea.* 扩展键）', () => {
    const fm = fmOf(
      ['name: demo', 'description: d', 'metadata:', '  author: example-org', '  version: "1.0"', '  worldsea.badge: beta'].join('\n'),
    )
    expect(fm.metadata).toEqual({ author: 'example-org', version: '1.0', 'worldsea.badge': 'beta' })
  })

  it('规范字段 license / compatibility 直通', () => {
    const fm = fmOf(['name: demo', 'description: d', 'license: Apache-2.0', 'compatibility: Requires python3'].join('\n'))
    expect(fm.license).toBe('Apache-2.0')
    expect(fm.compatibility).toBe('Requires python3')
  })

  it('缩进判定：capabilities 之后的顶层 cli 不落入嵌套通道（原实现缺陷回归）', () => {
    const fm = fmOf(['name: demo', 'description: d', 'capabilities:', '  internal:', '    - a', 'cli: 不应被吞'].join('\n'))
    expect(fm.capabilities).toEqual({ internal: ['a'], cli: [], mcp: [] })
  })

  it('metadata 之后的顶层键不被当作 metadata 子键', () => {
    const fm = fmOf(['name: demo', 'description: d', 'metadata:', '  k: v', 'tags: [t]'].join('\n'))
    expect(fm.metadata).toEqual({ k: 'v' })
    expect(fm.tags).toEqual(['t'])
  })

  it('多行 flow 序列（`[` 独占一行——timeline-architect 实际形态）', () => {
    const fm = fmOf(
      [
        'name: demo',
        'description: d',
        'allowed-tools:',
        '  [',
        "    timeline(action='create_event'),",
        '    entity_create,',
        '    consistency_check,',
        '  ]',
        'tags: [t]',
      ].join('\n'),
    )
    expect(fm.allowedTools).toEqual(["timeline(action='create_event')", 'entity_create', 'consistency_check'])
    expect(fm.tags).toEqual(['t'])
  })

  it('block 式列表遇到新顶层键即终止（列表边界正确）', () => {
    const fm = fmOf(['name: demo', 'description: d', 'tags:', '  - a', 'priority: 8'].join('\n'))
    expect(fm.tags).toEqual(['a'])
    expect(fm.priority).toBe(8)
  })

  it('body 保留（frontmatter 之后内容原样）', () => {
    const parsed = parseFrontmatter('---\nname: demo\ndescription: d\n---\n## 正文\n内容')
    expect(parsed.body).toBe('## 正文\n内容')
  })
})
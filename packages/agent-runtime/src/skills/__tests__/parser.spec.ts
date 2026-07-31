/**
 * parser.ts 单元测试
 *
 * 验证 parseFrontmatter 对两种格式的解析能力：
 * - SKILL.md（--- frontmatter + body，Claude Code 标准格式，连字符 key）
 * - skill.yaml 包装（--- + yaml + ---，WorldSmith 原生格式，驼峰 key）
 *
 * 重点覆盖风险点2：capabilities/schemaContext 嵌套结构解析
 */
import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../parser'

describe('parseFrontmatter', () => {
  describe('SKILL.md 格式（连字符 key + capabilities 嵌套）', () => {
    it('解析 capabilities.internal/cli/mcp 嵌套列表', () => {
      const raw = `---
name: worldbuilding
description: 世界观构建
capabilities:
  internal:
    - entity.list
    - entity.get
  cli:
    - git.status
  mcp: []
---
# 正文内容`
      const parsed = parseFrontmatter(raw)
      expect(parsed.frontmatter.name).toBe('worldbuilding')
      expect(parsed.frontmatter.capabilities).toBeDefined()
      expect(parsed.frontmatter.capabilities!.internal).toEqual(['entity.list', 'entity.get'])
      expect(parsed.frontmatter.capabilities!.cli).toEqual(['git.status'])
      expect(parsed.frontmatter.capabilities!.mcp).toEqual([])
      expect(parsed.body.trim()).toBe('# 正文内容')
    })

    it('解析 allowed-tools 连字符列表', () => {
      const raw = `---
name: test
description: 测试
allowed-tools:
  - tool_a
  - tool_b
---
body`
      const parsed = parseFrontmatter(raw)
      expect(parsed.frontmatter.allowedTools).toEqual(['tool_a', 'tool_b'])
      // allowedTools 存在但无 capabilities 时，自动转为 capabilities.internal
      expect(parsed.frontmatter.capabilities).toBeDefined()
      expect(parsed.frontmatter.capabilities!.internal).toEqual(['tool_a', 'tool_b'])
    })

    it('解析 schema-context.entity-types 嵌套', () => {
      const raw = `---
name: test
schema-context:
  entity-types:
    - region
    - organization
---
body`
      const parsed = parseFrontmatter(raw)
      expect(parsed.frontmatter.schemaContext).toBeDefined()
      expect(parsed.frontmatter.schemaContext!.entityTypes).toEqual(['region', 'organization'])
      expect(parsed.frontmatter.schemaContext!.fieldPolicy).toBe('prefer-defined')
    })

    it('解析标量字段（id/icon/category/priority/auto-activate/version）', () => {
      const raw = `---
id: my-skill
name: 我的技能
icon: globe
category: domain
priority: 8
auto-activate: true
version: 2.1.0
---
body`
      const parsed = parseFrontmatter(raw)
      expect(parsed.frontmatter.id).toBe('my-skill')
      expect(parsed.frontmatter.name).toBe('我的技能')
      expect(parsed.frontmatter.icon).toBe('globe')
      expect(parsed.frontmatter.category).toBe('domain')
      expect(parsed.frontmatter.priority).toBe(8)
      expect(parsed.frontmatter.autoActivate).toBe(true)
      expect(parsed.frontmatter.version).toBe('2.1.0')
    })
  })

  describe('skill.yaml 包装格式（驼峰 key）', () => {
    it('解析 allowedTools 驼峰列表', () => {
      const yamlContent = `id: agent-orchestrator
name: Agent 调度器
description: 多 Agent 调度
allowedTools:
  - list_sub_agent_types
  - dispatch_sub_agent`
      const wrapped = `---\n${yamlContent}\n---\n`
      const parsed = parseFrontmatter(wrapped)
      expect(parsed.frontmatter.id).toBe('agent-orchestrator')
      expect(parsed.frontmatter.name).toBe('Agent 调度器')
      expect(parsed.frontmatter.allowedTools).toEqual(['list_sub_agent_types', 'dispatch_sub_agent'])
    })

    it('解析 baseTools 驼峰列表', () => {
      const yamlContent = `id: test
name: 测试
baseTools:
  - entity_list
  - entity_get
allowedTools:
  - entity_create`
      const wrapped = `---\n${yamlContent}\n---\n`
      const parsed = parseFrontmatter(wrapped)
      expect(parsed.frontmatter.baseTools).toEqual(['entity_list', 'entity_get'])
      expect(parsed.frontmatter.allowedTools).toEqual(['entity_create'])
    })

    it('解析 capabilities 嵌套（驼峰 key 包装格式）', () => {
      const yamlContent = `id: test
name: 测试
capabilities:
  internal:
    - entity.list
  cli: []
  mcp: []`
      const wrapped = `---\n${yamlContent}\n---\n`
      const parsed = parseFrontmatter(wrapped)
      expect(parsed.frontmatter.capabilities).toBeDefined()
      expect(parsed.frontmatter.capabilities!.internal).toEqual(['entity.list'])
      expect(parsed.frontmatter.capabilities!.cli).toEqual([])
      expect(parsed.frontmatter.capabilities!.mcp).toEqual([])
    })

    it('解析 autoActivate 驼峰 key', () => {
      const yamlContent = `id: test
name: 测试
autoActivate: true`
      const wrapped = `---\n${yamlContent}\n---\n`
      const parsed = parseFrontmatter(wrapped)
      expect(parsed.frontmatter.autoActivate).toBe(true)
    })
  })

  describe('边界情况', () => {
    it('无 frontmatter 分隔符时，整体作为 body 返回', () => {
      const raw = '这是纯正文，没有 frontmatter'
      const parsed = parseFrontmatter(raw)
      expect(parsed.frontmatter.name).toBe('')
      expect(parsed.frontmatter.allowedTools).toEqual([])
      expect(parsed.frontmatter.baseTools).toEqual([])
      expect(parsed.body).toBe(raw)
    })

    it('最小 frontmatter（仅 name）正常解析', () => {
      const raw = `---
name: minimal
---
body content`
      const parsed = parseFrontmatter(raw)
      expect(parsed.frontmatter.name).toBe('minimal')
      expect(parsed.frontmatter.allowedTools).toEqual([])
      expect(parsed.body.trim()).toBe('body content')
    })

    it('triggers 和 tags 列表解析', () => {
      const raw = `---
name: test
triggers:
  - 生成
  - 批量
tags:
  - 创作
---
body`
      const parsed = parseFrontmatter(raw)
      expect(parsed.frontmatter.triggers).toEqual(['生成', '批量'])
      expect(parsed.frontmatter.tags).toEqual(['创作'])
    })
  })
})

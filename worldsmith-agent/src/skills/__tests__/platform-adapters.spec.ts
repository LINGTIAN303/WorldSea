/**
 * platform-adapters.ts 单元测试
 *
 * 验证多平台技能格式互通：
 * - 格式检测（detectPlatform）
 * - Claude Code SKILL.md 导入/导出
 * - Cursor .mdc 导入/导出（globs → tags 映射）
 * - WorldSmith skill.yaml 导入/导出
 * - 往返转换一致性（导出后再导入，核心字段保持一致）
 */
import { describe, it, expect } from 'vitest'
import {
  detectPlatform,
  importClaudeCodeSkill,
  importCursorRule,
  importWorldSmithYaml,
  autoImportSkill,
  exportToClaudeCodeSkill,
  exportToCursorRule,
  exportToSkillYaml,
} from '../platform-adapters'

describe('detectPlatform', () => {
  it('Cursor 格式（含 alwaysApply/globs）', () => {
    expect(detectPlatform('---\ndescription: test\nalwaysApply: true\n---\nbody')).toBe('cursor')
    expect(detectPlatform('---\ndescription: test\nglobs: "**/*.tsx"\n---\nbody')).toBe('cursor')
  })

  it('Claude Code 格式（含 allowed-tools/name）', () => {
    expect(detectPlatform('---\nname: test\nallowed-tools:\n  - tool_a\n---\nbody')).toBe('claude-code')
    expect(detectPlatform('---\nname: test\ndescription: x\n---\nbody')).toBe('claude-code')
  })

  it('WorldSmith 格式（含 baseTools/id）', () => {
    expect(detectPlatform('---\nid: test\nbaseTools:\n  - entity_list\n---\nbody')).toBe('worldsmith')
  })

  it('无 frontmatter 默认 claude-code', () => {
    expect(detectPlatform('纯文本无 frontmatter')).toBe('claude-code')
  })
})

describe('Claude Code SKILL.md 导入', () => {
  it('解析 name/description/allowed-tools（连字符）', () => {
    const raw = `---
name: worldbuilding
description: 世界观构建
allowed-tools:
  - entity_create
  - entity_update
---
# 正文`
    const result = importClaudeCodeSkill(raw, 'fallback')
    expect(result.platform).toBe('claude-code')
    expect(result.meta.name).toBe('worldbuilding')
    expect(result.meta.description).toBe('世界观构建')
    expect(result.meta.allowedTools).toEqual(['entity_create', 'entity_update'])
    expect(result.body.trim()).toBe('# 正文')
  })

  it('缺少 name 时用 fallbackId', () => {
    const raw = `---
description: 无 name 的技能
---
body`
    const result = importClaudeCodeSkill(raw, 'my-skill')
    expect(result.meta.id).toBe('my-skill')
    expect(result.meta.name).toBe('my-skill')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('无 category 时默认 action 并警告', () => {
    const raw = `---
name: test
description: x
---
body`
    const result = importClaudeCodeSkill(raw, 'test')
    expect(result.meta.category).toBe('action')
    expect(result.warnings.some(w => w.includes('category'))).toBe(true)
  })
})

describe('Cursor .mdc 导入', () => {
  it('解析 description + alwaysApply + globs → tags', () => {
    const raw = `---
description: React 组件规范
globs: "**/*.tsx"
alwaysApply: false
---
# 规范正文`
    const result = importCursorRule(raw, 'react-rules')
    expect(result.platform).toBe('cursor')
    expect(result.meta.description).toBe('React 组件规范')
    // name 从 description 兜底（前30字符）
    expect(result.meta.name).toBe('React 组件规范')
    // globs 存入 tags
    expect(result.meta.tags).toContain('cursor-glob:**/*.tsx')
    // alwaysApply → autoActivate
    expect(result.meta.autoActivate).toBe(false)
    expect(result.body.trim()).toBe('# 规范正文')
  })

  it('globs 列表格式（多个）', () => {
    const raw = `---
description: test
globs:
  - "**/*.tsx"
  - "**/*.ts"
alwaysApply: true
---
body`
    const result = importCursorRule(raw, 'test')
    expect(result.meta.tags).toContain('cursor-glob:**/*.tsx')
    expect(result.meta.tags).toContain('cursor-glob:**/*.ts')
    expect(result.meta.autoActivate).toBe(true)
  })
})

describe('WorldSmith skill.yaml 导入', () => {
  it('解析完整 manifest', () => {
    const raw = `id: my-skill
name: 我的技能
icon: globe
description: 测试
category: domain
version: 2.0.0
baseTools:
  - entity_list
allowedTools:
  - entity_create`
    const result = importWorldSmithYaml(raw, 'fallback')
    expect(result.platform).toBe('worldsmith')
    expect(result.meta.id).toBe('my-skill')
    expect(result.meta.name).toBe('我的技能')
    expect(result.meta.icon).toBe('globe')
    expect(result.meta.category).toBe('domain')
    expect(result.meta.version).toBe('2.0.0')
    expect(result.meta.baseTools).toEqual(['entity_list'])
    expect(result.meta.allowedTools).toEqual(['entity_create'])
    // skill.yaml 是 manifest，body 为空
    expect(result.body).toBe('')
  })
})

describe('autoImportSkill 自动检测', () => {
  it('Cursor 格式自动走 cursor 适配器', () => {
    const raw = `---\ndescription: x\nalwaysApply: true\n---\nbody`
    const result = autoImportSkill(raw, 'test')
    expect(result.platform).toBe('cursor')
  })

  it('Claude Code 格式自动走 claude-code 适配器', () => {
    const raw = `---\nname: test\ndescription: x\n---\nbody`
    const result = autoImportSkill(raw, 'test')
    expect(result.platform).toBe('claude-code')
  })

  it('WorldSmith 格式自动走 worldsmith 适配器', () => {
    const raw = `id: test\nname: 测试\nbaseTools:\n  - entity_list`
    const result = autoImportSkill(raw, 'test')
    expect(result.platform).toBe('worldsmith')
  })
})

describe('导出适配器', () => {
  const meta = {
    id: 'my-skill',
    name: '我的技能',
    icon: 'globe',
    description: '测试描述',
    category: 'domain' as const,
    enabled: true,
    visibility: 'always' as const,
    version: '1.5.0',
    promptFile: 'SKILL.md',
    allowedTools: ['entity_create', 'entity_update'],
    baseTools: ['entity_list'],
    autoActivate: true,
    tags: ['cursor-glob:**/*.tsx', '创作'],
  }

  it('导出为 Claude Code SKILL.md', () => {
    const exported = exportToClaudeCodeSkill(meta, '# 提示词正文')
    expect(exported).toContain('name: 我的技能')
    expect(exported).toContain('description: 测试描述')
    expect(exported).toContain('allowed-tools:')
    expect(exported).toContain('  - entity_create')
    expect(exported).toContain('version: 1.5.0')
    expect(exported).toContain('# 提示词正文')
    // 不应包含 WorldSmith 特有字段
    expect(exported).not.toContain('baseTools')
    expect(exported).not.toContain('category:')
  })

  it('导出为 Cursor .mdc（globs 从 tags 提取）', () => {
    const exported = exportToCursorRule(meta, '# 规范正文')
    expect(exported).toContain('description: 测试描述')
    expect(exported).toContain('globs: **/*.tsx')
    expect(exported).toContain('alwaysApply: true')
    expect(exported).toContain('# 规范正文')
    // 不应包含 WorldSmith 特有字段
    expect(exported).not.toContain('name:')
    expect(exported).not.toContain('allowedTools')
  })

  it('导出为 WorldSmith skill.yaml', () => {
    const exported = exportToSkillYaml(meta)
    expect(exported).toContain('id: my-skill')
    expect(exported).toContain('name: 我的技能')
    expect(exported).toContain('icon: globe')
    expect(exported).toContain('category: domain')
    expect(exported).toContain('version: 1.5.0')
    expect(exported).toContain('baseTools:')
    expect(exported).toContain('allowedTools:')
    expect(exported).toContain('tags:')
    expect(exported).toContain('  - cursor-glob:**/*.tsx')
  })
})

describe('往返转换一致性', () => {
  it('Claude Code 导出后导入，核心字段一致', () => {
    const originalMeta = {
      id: 'round-trip',
      name: '往返测试',
      icon: 'module-builder',
      description: '往返一致性验证',
      category: 'action' as const,
      enabled: true,
      visibility: 'always' as const,
      version: '1.0.0',
      promptFile: 'SKILL.md',
      allowedTools: ['tool_a', 'tool_b'],
      baseTools: [],
    }
    const exported = exportToClaudeCodeSkill(originalMeta, '# 正文')
    const imported = importClaudeCodeSkill(exported, 'round-trip')
    expect(imported.meta.name).toBe('往返测试')
    expect(imported.meta.description).toBe('往返一致性验证')
    expect(imported.meta.allowedTools).toEqual(['tool_a', 'tool_b'])
    expect(imported.body.trim()).toBe('# 正文')
  })

  it('Cursor 导出后导入，description/globs 一致', () => {
    const originalMeta = {
      id: 'cursor-rt',
      name: 'Cursor往返',
      icon: 'module-builder',
      description: 'Cursor 往返测试',
      category: 'action' as const,
      enabled: true,
      visibility: 'always' as const,
      version: '1.0.0',
      promptFile: 'SKILL.md',
      allowedTools: [],
      baseTools: [],
      autoActivate: true,
      tags: ['cursor-glob:**/*.vue'],
    }
    const exported = exportToCursorRule(originalMeta, '# 规范')
    const imported = importCursorRule(exported, 'cursor-rt')
    expect(imported.meta.description).toBe('Cursor 往返测试')
    expect(imported.meta.tags).toContain('cursor-glob:**/*.vue')
    expect(imported.meta.autoActivate).toBe(true)
  })
})

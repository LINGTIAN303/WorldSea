/**
 * R 批 R-0：能力类分派（toolClassify）用例
 *
 * 覆盖三层分派的判定顺序：精确表 → 前缀规则 → 目录兜底 → generic 兜底。
 */
import { describe, expect, it } from 'vitest'

import { classifyTool, TOOL_CLASS_EXACT, type ToolCatalogEntryView } from '../toolClassify'

function entry(partial: Partial<ToolCatalogEntryView> & { name: string; category: string }): ToolCatalogEntryView {
  return { aliases: [], readOnly: true, destructive: false, ...partial }
}

describe('classifyTool · 精确表', () => {
  it('文件四变体按操作分派', () => {
    expect(classifyTool('read_file')).toBe('file-read')
    expect(classifyTool('write_file')).toBe('file-write')
    expect(classifyTool('edit_file')).toBe('file-edit')
    expect(classifyTool('edit_diff')).toBe('file-edit')
    expect(classifyTool('list_directory')).toBe('file-list')
  })

  it('终端 / 搜索 / 网络 / 计划 / 交互命中对应类', () => {
    expect(classifyTool('bash')).toBe('terminal')
    expect(classifyTool('powershell')).toBe('terminal')
    expect(classifyTool('grep')).toBe('search')
    expect(classifyTool('find')).toBe('search')
    expect(classifyTool('workspace_search')).toBe('search')
    expect(classifyTool('web_fetch')).toBe('web')
    expect(classifyTool('todo_write')).toBe('plan')
    expect(classifyTool('ask_user_question')).toBe('interaction')
    expect(classifyTool('delegate_to_sub_agent')).toBe('subagent')
    expect(classifyTool('list_mcp_resources')).toBe('mcp')
  })

  it('历史别名（回源老会话消息）仍可归位', () => {
    expect(classifyTool('fs_read')).toBe('file-read')
    expect(classifyTool('execute_command')).toBe('terminal')
  })
})

describe('classifyTool · 前缀规则', () => {
  it('MCP / 技能 / 会话终端 / 记忆 / 域内族前缀', () => {
    expect(classifyTool('mcp__filesystem__read_file')).toBe('mcp')
    expect(classifyTool('load_skill')).toBe('skill')
    expect(classifyTool('load_skill_reference')).toBe('skill')
    expect(classifyTool('shell_session_exec')).toBe('terminal')
    expect(classifyTool('memory_recall')).toBe('memory')
    expect(classifyTool('memory_delete')).toBe('memory')
    expect(classifyTool('entity_create')).toBe('domain')
    expect(classifyTool('kb_write')).toBe('domain')
    expect(classifyTool('ui_update_components')).toBe('domain')
    expect(classifyTool('project_export')).toBe('domain')
    expect(classifyTool('vision_analyze')).toBe('domain')
  })
})

describe('classifyTool · 目录兜底与优先级', () => {
  it('目录在场的未知工具按 category 兜底（file 按读写细分）', () => {
    expect(classifyTool('new_fs_probe', entry({ name: 'new_fs_probe', category: 'file', readOnly: true }))).toBe('file-read')
    expect(classifyTool('new_fs_writer', entry({ name: 'new_fs_writer', category: 'file', readOnly: false }))).toBe('file-edit')
    expect(classifyTool('new_shell', entry({ name: 'new_shell', category: 'dev' }))).toBe('terminal')
    expect(classifyTool('new_index', entry({ name: 'new_index', category: 'search' }))).toBe('search')
    expect(classifyTool('new_mcp_proxy', entry({ name: 'new_mcp_proxy', category: 'mcp' }))).toBe('mcp')
  })

  it('目录未登记的 category → 域内业务（注册过的工具不落 generic）', () => {
    expect(classifyTool('mystery_tool', entry({ name: 'mystery_tool', category: 'weird' }))).toBe('domain')
  })

  it('精确表优先于目录（目录存在也不改既有形态）', () => {
    expect(classifyTool('bash', entry({ name: 'bash', category: 'file', readOnly: true }))).toBe('terminal')
    expect(classifyTool('grep', entry({ name: 'grep', category: 'file', readOnly: true }))).toBe('search')
  })

  it('无目录 + 未知工具 → generic（fallback 必达，不许静默消失）', () => {
    expect(classifyTool('totally_unknown')).toBe('generic')
    expect(classifyTool('totally_unknown', null)).toBe('generic')
  })
})

describe('classifyTool · 表内自洽', () => {
  it('精确表值均为合法类且不自相矛盾', () => {
    const valid = new Set([
      'terminal', 'file-read', 'file-write', 'file-edit', 'file-list', 'search', 'web',
      'mcp', 'skill', 'subagent', 'plan', 'memory', 'interaction', 'domain', 'generic',
    ])
    for (const [name, cls] of Object.entries(TOOL_CLASS_EXACT)) {
      expect(valid.has(cls), `${name} → ${cls} 非法`).toBe(true)
      expect(classifyTool(name)).toBe(cls)
    }
  })
})

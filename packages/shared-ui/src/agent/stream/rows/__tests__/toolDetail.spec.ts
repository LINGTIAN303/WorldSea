/**
 * R 批 R-a：终端卡 / 文件行（解析 + 展开体分派 + 行段接线）
 *
 * 锁定的行为：
 * - `parseToolResult`：对象解析 / 非法 JSON / 非对象 / __meta 提取
 * - `detailKindFor`：终端恒终端卡；文件类按结果形状（content / entries）分派；其余回落通用
 * - 行段接线：终端行渲染终端卡（含 shell 徽标）、读文件行渲染代码视图（带行号）、未知工具不误入类卡
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ToolRow from '../ToolRow.vue'
import { detailKindFor, parseToolResult } from '../tool-detail/toolResult'
import type { ToolItem } from '../tool-detail/types'

function item(name: string, args: Record<string, unknown> = {}, result?: string): ToolItem {
  return {
    id: `row-${name}`,
    tc: { id: `call-${name}`, name, args, status: 'completed', result },
  } as unknown as ToolItem
}

describe('parseToolResult', () => {
  it('解析对象并提取 __meta', () => {
    const { json, meta } = parseToolResult('{"stdout":"hi","__meta":{"op":"cmd","exit_code":0}}')
    expect(json?.stdout).toBe('hi')
    expect(meta?.exit_code).toBe(0)
  })

  it('非法 JSON / 非对象 / 空值 → null', () => {
    for (const raw of [undefined, '', 'not-json', '"str"', '[1,2]', 'null']) {
      const { json, meta } = parseToolResult(raw as string | undefined)
      expect(json).toBeNull()
      expect(meta).toBeNull()
    }
  })

  it('无 __meta → meta 为 null，json 保留', () => {
    const { json, meta } = parseToolResult('{"content":"x"}')
    expect(json?.content).toBe('x')
    expect(meta).toBeNull()
  })
})

describe('detailKindFor（展开体分派）', () => {
  it('终端类恒走终端卡（无论结果形状）', () => {
    expect(detailKindFor('terminal', item('bash', { command: 'ls' }))).toBe('terminal')
    expect(detailKindFor('terminal', item('bash', {}, '{"stdout":"x"}'))).toBe('terminal')
  })

  it('文件读（结果带 content）→ 代码视图；列目录（entries）→ 目录列表', () => {
    const read = item('read_file', { path: 'a.ts' }, '{"content":"line1","path":"a.ts","total_lines":1}')
    expect(detailKindFor('file-read', read)).toBe('file-read')
    const list = item('list_directory', { path: '.' }, '{"path":".","entries":[{"name":"a","type":"file"}]}')
    expect(detailKindFor('file-list', list)).toBe('file-list')
  })

  it('文件写/改（无 content / entries）→ 通用详情', () => {
    expect(detailKindFor('file-write', item('write_file', { path: 'a.ts' }, '{"ok":true}'))).toBe('generic')
    expect(detailKindFor('file-edit', item('edit_file', { path: 'a.ts' }))).toBe('generic')
  })

  it('非终端/非文件类 → 通用详情', () => {
    expect(detailKindFor('mcp', item('mcp__fs__read', {}, '{"content":"x"}'))).toBe('generic')
    expect(detailKindFor('generic', item('mystery'))).toBe('generic')
  })
})

describe('ToolRow 接线（R-a）', () => {
  it('终端行：渲染终端卡 + shell 徽标 + exit/duration 尾行', () => {
    const wrapper = mount(ToolRow, {
      props: {
        item: item('bash', { command: 'npm run build', cwd: 'apps/tauri' }, '{"stdout":"done","stderr":"","exit_code":0,"__meta":{"op":"cmd","exit_code":0,"duration_ms":3400}}'),
      },
    })
    expect(wrapper.find('.ws-stream-tool-shell').text()).toBe('bash')
    const card = wrapper.find('.ws-term')
    expect(card.exists()).toBe(true)
    expect(card.find('.ws-term-cmd').text()).toContain('npm run build')
    expect(card.find('.ws-term-block-body').text()).toBe('done')
    expect(card.find('.ws-term-exit').text()).toBe('exit 0')
    expect(card.find('.ws-term-dur').text()).toBe('3.4s')
    expect(wrapper.find('.ws-stream-tool-detail').exists()).toBe(true)
    wrapper.unmount()
  })

  it('非零退出：尾行标红（is-fail）', () => {
    const wrapper = mount(ToolRow, {
      props: { item: item('powershell', { command: 'boom' }, '{"stdout":"","exit_code":1,"__meta":{"exit_code":1}}') },
    })
    expect(wrapper.find('.ws-term-shell').text()).toBe('PowerShell')
    expect(wrapper.find('.ws-term-exit').classes()).toContain('is-fail')
    wrapper.unmount()
  })

  it('读文件行：代码视图 + 行号（offset 起始行）+ 文件路径摘要', () => {
    const p = 'D:/WorldSea/packages/shared-ui/src/agent/stream/rows/ToolRow.vue'
    const wrapper = mount(ToolRow, {
      props: {
        item: item('read_file', { path: p }, JSON.stringify({
          content: 'line A\nline B', path: p, offset: 10, lines_returned: 2, total_lines: 99, truncated: true,
          __meta: { op: 'read', path: p, lines: 99 },
        })),
      },
    })
    const file = wrapper.find('.ws-file')
    expect(file.exists()).toBe(true)
    // 行号槽：起始行 = offset + 1
    expect(file.findAll('.ws-file-code-gutter span').map((s) => s.text())).toEqual(['11', '12'])
    expect(file.find('.ws-file-code-body').text()).toContain('line A')
    expect(file.find('.ws-file-head-path').text()).toBe(p)
    // 摘要：长路径收缩为「…/末两段」
    expect(wrapper.find('.ws-stream-tool-subject').text()).toBe('…/rows/ToolRow.vue')
    expect(wrapper.find('.ws-stream-tool-fileicon').exists()).toBe(true)
    wrapper.unmount()
  })

  it('列目录行：目录列表（目录 / 文件图标 + 名称）', () => {
    const wrapper = mount(ToolRow, {
      props: {
        item: item('list_directory', { path: 'src' }, '{"path":"src","entries":[{"name":"a","type":"dir"},{"name":"b.ts","type":"file","size":12}]}'),
      },
    })
    const rows = wrapper.findAll('.ws-file-list-row')
    expect(rows.length).toBe(2)
    expect(rows[0].find('.ws-file-list-dir').exists()).toBe(true)
    expect(rows[1].find('.ws-file-list-icon').exists()).toBe(true)
    wrapCleanup(wrapper)
  })

  it('未知工具：不误入类卡（回落通用详情，无终端/文件根）', () => {
    const wrapper = mount(ToolRow, { props: { item: item('totally_unknown', { a: 1 }, '{"ok":true}') } })
    expect(wrapper.find('.ws-term').exists()).toBe(false)
    expect(wrapper.find('.ws-file').exists()).toBe(false)
    expect(wrapper.find('.ws-stream-tool-detail').exists()).toBe(true)
    wrapCleanup(wrapper)
  })
})

function wrapCleanup(wrapper: { unmount: () => void }): void {
  wrapper.unmount()
}

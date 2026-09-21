// E3-4（2026-09-18）：沙箱审计元信息的界面文案映射单测
// 覆盖：后端稳定锚点（read_only / workspace_write）→ 工具行短标签；未知/缺失返回空串（不渲染徽标）；
//       新增 sandbox 字段不影响既有效果标签（cmd 仍按 exit / duration 渲染）。
import { describe, it, expect } from 'vitest'
import { formatSandboxMode, extractEffectLabel } from '../rows/toolSemantics'

describe('formatSandboxMode（E3-4 沙箱徽标）', () => {
  it('后端稳定锚点映射为界面文案', () => {
    expect(formatSandboxMode('read_only')).toBe('沙箱·只读')
    expect(formatSandboxMode('workspace_write')).toBe('沙箱·工作区写')
  })

  it('未知 / 缺失返回空串（调用方据此不渲染徽标）', () => {
    expect(formatSandboxMode(undefined)).toBe('')
    expect(formatSandboxMode(null)).toBe('')
    expect(formatSandboxMode('unknown')).toBe('')
  })

  it('沙箱字段不影响既有效果标签（cmd 仍按 exit / duration 渲染）', () => {
    expect(
      extractEffectLabel({ op: 'cmd', exit_code: 1, duration_ms: 1200, sandbox: 'workspace_write' }),
    ).toBe('exit 1 · 1.2s')
    expect(extractEffectLabel({ op: 'cmd', exit_code: 0, sandbox_denied: true })).toBe('exit 0')
  })
})
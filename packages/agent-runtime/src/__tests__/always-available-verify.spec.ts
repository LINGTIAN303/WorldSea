/** alwaysAvailable meta 等价性回归测试（守卫双向等价，用独立实例避免全局污染），详细见 docs/details/注释/packages/agent-runtime/tests-always-available-verify-spec.md */
import { describe, it, expect } from 'vitest'
import { ALL_TOOLS } from '../agent'
import { ToolRegistry } from '@worldsea/agent-core'
import type { ToolDefinition as AgentCoreToolDefinition } from '@worldsea/agent-core'
import { ALWAYS_AVAILABLE_TOOLS } from '../skills/registry'

describe('alwaysAvailable meta 等价性', () => {
  it('getAlwaysAvailable() 双向等价于 ALWAYS_AVAILABLE_TOOLS', () => {
    // 用独立 ToolRegistry 实例，模拟 initToolMetaRegistry(ALL_TOOLS) 的注册效果
    // 类型断言：worldsea-agent 的 ToolDefinition（meta 可选）→ agent-core 的 ToolDefinition（meta 必填），
    // 与 initToolMetaRegistry 内部断言一致
    const registry = new ToolRegistry()
    for (const tool of ALL_TOOLS) {
      if (tool.meta) registry.register(tool as AgentCoreToolDefinition)
    }

    const alwaysAvailable = new Set(registry.getAlwaysAvailable())
    const declared = new Set(ALWAYS_AVAILABLE_TOOLS)

    const missing = [...declared].filter(n => !alwaysAvailable.has(n))
    const extra = [...alwaysAvailable].filter(n => !declared.has(n))

    expect(missing, `ALWAYS_AVAILABLE_TOOLS 中缺少 alwaysAvailable meta 的工具: ${missing.join(', ')}`).toEqual([])
    expect(extra, `getAlwaysAvailable() 多出（不在 ALWAYS_AVAILABLE_TOOLS）: ${extra.join(', ')}`).toEqual([])
  })
})

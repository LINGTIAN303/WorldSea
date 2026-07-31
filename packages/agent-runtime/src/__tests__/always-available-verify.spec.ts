/**
 * alwaysAvailable meta 等价性回归测试（任务3 收尾）
 *
 * 守卫 ToolRegistry.getAlwaysAvailable() 与 ALWAYS_AVAILABLE_TOOLS 的双向等价性。
 * 若未来工具 meta 的 alwaysAvailable 标注偏离 ALWAYS_AVAILABLE_TOOLS，本测试会失败，
 * 提醒维护者保持声明式 meta 与旧权限边界一致（或有意变更时同步两侧）。
 *
 * 用独立 ToolRegistry 实例（不依赖全局单例），避免全量测试时其他测试文件
 * reset 全局 ToolRegistry 导致的隔离问题。
 */
import { describe, it, expect } from 'vitest'
import { ALL_TOOLS } from '../agent'
import { ToolRegistry } from '@worldsmith/agent-core'
import type { ToolDefinition as AgentCoreToolDefinition } from '@worldsmith/agent-core'
import { ALWAYS_AVAILABLE_TOOLS } from '../skills/registry'

describe('alwaysAvailable meta 等价性', () => {
  it('getAlwaysAvailable() 双向等价于 ALWAYS_AVAILABLE_TOOLS', () => {
    // 用独立 ToolRegistry 实例，模拟 initToolMetaRegistry(ALL_TOOLS) 的注册效果
    // 类型断言：worldsmith-agent 的 ToolDefinition（meta 可选）→ agent-core 的 ToolDefinition（meta 必填），
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

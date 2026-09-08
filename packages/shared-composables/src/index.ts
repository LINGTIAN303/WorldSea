/**
 * @worldsea/shared-composables
 *
 * 端无关共享 composables 集合。
 * 三端（Web / Tauri / CLI）共用的 Agent、长任务、实体、UI 相关 composables
 * 集中于此，通过依赖注入接收端特定实现（如 IAgentBackend）。
 */

// Agent 核心 composables（含长任务子模块）
export * from './agent/index'

// 实体相关
export * from './entity/index'

// UI 通用 composables
export * from './ui/index'

// Companion Mode 纯函数模块（场景/触发/提示词）
export * from './companion/index'

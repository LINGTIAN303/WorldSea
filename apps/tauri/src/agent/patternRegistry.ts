// 模式注册表 — 前端 TS 清单（C0-3 / C0-11 / C0-15 / M1-8）
//
// 与后端 `crates/agent-commands/src/pattern_registry.rs` 同构（序列化同步）。
// 新增模式改 2 处：本文件追加一条 + 后端注册表追加一条。
// 用途：A1 `/` 命令菜单（按 capability 分组）、迹线详图入口（detailComponent）、
// 事件通道过滤（eventFamily）。前端不按模式写死——从注册表读元数据（契约发现）。

export type PatternCapability = 'explore' | 'collaborate' | 'plan' | 'review'

/** 配置面默认值（与后端 PatternConfig 同构） */
export interface PatternConfig {
  maxIterations?: number
  beamWidth?: number
  maxRounds?: number
}

/** 注册项 — 五触点检查单（命令 / 事件族 / 物 / 配置 / 详图） */
export interface PatternRegistryEntry {
  patternId: string
  name: string
  capability: PatternCapability
  entryCommand: string | null
  runCommand: string
  eventFamily: string[]
  artifactKind: string
  configDefaults: PatternConfig
  detailComponent: string | null
}

export const patternRegistry: PatternRegistryEntry[] = [
  {
    patternId: 'plan',
    name: '规划执行',
    capability: 'plan',
    entryCommand: '/plan',
    runCommand: 'orchestrator_run_plan',
    eventFamily: ['plan_created', 'plan_step_update', 'plan_replanned', 'reflection'],
    artifactKind: 'plan',
    configDefaults: { maxIterations: 50 },
    detailComponent: null,
  },
  {
    patternId: 'tot',
    name: '思维树探索',
    capability: 'explore',
    entryCommand: '/tot',
    runCommand: 'orchestrator_run_tot',
    eventFamily: [
      'thought_node_created',
      'thought_node_scored',
      'branch_explored',
      'tot_goal_reached',
      'tot_terminated',
    ],
    artifactKind: 'exploration',
    configDefaults: { beamWidth: 3 },
    detailComponent: 'ThoughtTree',
  },
  {
    patternId: 'got',
    name: '思维图聚合',
    capability: 'explore',
    entryCommand: '/got',
    runCommand: 'orchestrator_run_got',
    eventFamily: [
      'thought_node_created',
      'thought_node_scored',
      'branch_explored',
      'thoughts_aggregated',
      'tot_goal_reached',
      'tot_terminated',
    ],
    artifactKind: 'aggregation',
    configDefaults: { beamWidth: 3 },
    detailComponent: 'ThoughtTree',
  },
  {
    patternId: 'supervisor',
    name: '监督委派',
    capability: 'collaborate',
    entryCommand: '/supervisor',
    runCommand: 'orchestrator_run_supervisor',
    eventFamily: ['task_assigned', 'sub_agent_started', 'sub_agent_completed', 'sub_agent_error'],
    artifactKind: 'delegation',
    configDefaults: { maxRounds: 1 },
    detailComponent: 'SubAgentTree',
  },
  {
    patternId: 'multi_agent',
    name: '多智能体协作',
    capability: 'collaborate',
    entryCommand: '/multi',
    runCommand: 'orchestrator_run_multi',
    eventFamily: [
      'round_started',
      'message_sent',
      'blackboard_updated',
      'round_completed',
      'converged',
    ],
    artifactKind: 'convergence',
    configDefaults: { maxRounds: 10 },
    detailComponent: 'MultiAgentBoard',
  },
]

/** 按 id 查注册项（返回 null 表示未注册） */
export function getPattern(patternId: string): PatternRegistryEntry | null {
  return patternRegistry.find((e) => e.patternId === patternId) ?? null
}

/** 按能力语义分组（C14：命令菜单按 explore/collaborate/plan/review 渲染） */
export function groupPatternsByCapability(): Record<PatternCapability, PatternRegistryEntry[]> {
  const groups: Record<PatternCapability, PatternRegistryEntry[]> = {
    explore: [],
    collaborate: [],
    plan: [],
    review: [],
  }
  for (const entry of patternRegistry) {
    groups[entry.capability].push(entry)
  }
  return groups
}
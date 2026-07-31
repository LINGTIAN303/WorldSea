export type DispatchMode = 'sequential' | 'concurrent' | 'streaming'

export type AgentType =
  // 开发型
  | 'terminal-worker'
  | 'review-worker'
  | 'research-worker'
  | 'test-worker'
  | 'doc-worker'
  | 'git-worker'
  // 创作型
  | 'creation-worker'
  | 'consistency-worker'
  | 'batch-creation-worker'

export interface OrchestratorConfig {
  maxConcurrency: number
  defaultTimeout: number
  rateLimitPerMinute: number
}

export interface SubAgentTask {
  id: string
  type: AgentType
  prompt: string
  skillIds?: string[]
  timeout?: number
  images?: { data: string; mimeType: string }[]
  /** 创作编排上下文，子 Agent 完成后自动回调更新 Pipeline 步骤状态 */
  pipelineContext?: { pipelineId: string; stepId: string }
}

export interface SubAgentResult {
  taskId: string
  success: boolean
  output: string
  duration: number
}

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'

export interface AgentInfo {
  id: string
  type: AgentType
  status: AgentStatus
  startedAt: number | null
  completedAt: number | null
  error: string | null
}

export const AGENT_TYPE_CONFIG: Record<AgentType, {
  icon: string
  name: string
  skillIds: string[]
}> = {
  'terminal-worker': {
    icon: '💻',
    name: '终端 Agent',
    skillIds: ['terminal-launcher', 'terminal-operator', 'fs-operator', 'sys-inspector'],
  },
  'review-worker': {
    icon: '🔍',
    name: '审查 Agent',
    skillIds: ['code-reviewer', 'security-scanner'],
  },
  'research-worker': {
    icon: '🌐',
    name: '研究 Agent',
    skillIds: ['web-cli-operator', 'find-skills'],
  },
  'test-worker': {
    icon: '🧪',
    name: '测试 Agent',
    skillIds: ['test-automator'],
  },
  'doc-worker': {
    icon: '📝',
    name: '文档 Agent',
    skillIds: ['doc-generator'],
  },
  'git-worker': {
    icon: '🔀',
    name: 'Git Agent',
    skillIds: ['git-operator'],
  },
  // 创作型
  'creation-worker': {
    icon: '🎨',
    name: '创作 Agent',
    skillIds: ['worldbuilding', 'content-craft'],
  },
  'consistency-worker': {
    icon: '✅',
    name: '校验 Agent',
    skillIds: ['worldbuilding'],
  },
  'batch-creation-worker': {
    icon: '📦',
    name: '批量创作 Agent',
    skillIds: ['content-craft'],
  },
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrency: 3,
  defaultTimeout: 120000,
  rateLimitPerMinute: 30,
}

import type { GroupChatBudget, GroupChatCostTracker, GroupChatCostEntry } from './types'
import { calculateCost } from '@worldsea/agent-runtime'

export class CostTrackerImpl {
  private tracker: GroupChatCostTracker
  private budget: GroupChatBudget
  private defaultModelId: string
  private agentModelMap: Record<string, string> = {}

  constructor(budget: GroupChatBudget, defaultModelId: string) {
    this.budget = budget
    this.defaultModelId = defaultModelId
    this.tracker = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      perAgentCost: {},
      remainingBudget: budget.maxCostUsd,
      budgetPercentUsed: 0,
    }
  }

  registerAgentModel(agentId: string, modelId: string): void {
    this.agentModelMap[agentId] = modelId
  }

  private getModelForAgent(agentId: string): string {
    return this.agentModelMap[agentId] || this.defaultModelId
  }

  recordUsage(agentId: string, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number): void {
    const modelId = this.getModelForAgent(agentId)
    const breakdown = calculateCost(modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens)

    this.tracker.totalInputTokens += inputTokens
    this.tracker.totalOutputTokens += outputTokens
    this.tracker.totalCostUsd += breakdown.total

    if (!this.tracker.perAgentCost[agentId]) {
      this.tracker.perAgentCost[agentId] = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const entry = this.tracker.perAgentCost[agentId]
    entry.inputTokens += inputTokens
    entry.outputTokens += outputTokens
    entry.costUsd += breakdown.total

    this.tracker.remainingBudget = Math.max(0, this.budget.maxCostUsd - this.tracker.totalCostUsd)
    this.tracker.budgetPercentUsed = this.budget.maxCostUsd > 0
      ? Math.min(100, (this.tracker.totalCostUsd / this.budget.maxCostUsd) * 100)
      : 0
  }

  isBudgetExceeded(): boolean {
    return this.tracker.totalCostUsd >= this.budget.maxCostUsd
  }

  isBudgetWarning(): boolean {
    return this.tracker.budgetPercentUsed >= this.budget.warnAtPercent
  }

  isPerAgentBudgetExceeded(agentId: string): boolean {
    if (!this.budget.perAgentBudget) return false
    const entry = this.tracker.perAgentCost[agentId]
    if (!entry) return false
    return entry.costUsd >= this.budget.perAgentBudget
  }

  getSnapshot(): GroupChatCostTracker {
    const perAgentCopy: Record<string, GroupChatCostEntry> = {}
    for (const [key, entry] of Object.entries(this.tracker.perAgentCost)) {
      perAgentCopy[key] = { ...entry }
    }
    return { ...this.tracker, perAgentCost: perAgentCopy }
  }

  updateDefaultModel(modelId: string): void {
    this.defaultModelId = modelId
  }

  reset(budget: GroupChatBudget, defaultModelId: string): void {
    this.budget = budget
    this.defaultModelId = defaultModelId
    this.tracker = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      perAgentCost: {},
      remainingBudget: budget.maxCostUsd,
      budgetPercentUsed: 0,
    }
  }

  estimateTotalCost(agentCount: number, estimatedRounds: number): { minCost: number; maxCost: number } {
    const avgInputPerRound = 2000
    const avgOutputPerRound = 300
    const growthFactor = 1.15

    let totalInput = 0
    let totalOutput = 0
    for (let r = 1; r <= estimatedRounds; r++) {
      const roundInput = Math.round(avgInputPerRound * Math.pow(growthFactor, r)) * agentCount
      totalInput += roundInput
      totalOutput += avgOutputPerRound * agentCount
    }

    const minBreakdown = calculateCost(this.defaultModelId, totalInput * 0.5, totalOutput * 0.5, 0, 0)
    const maxBreakdown = calculateCost(this.defaultModelId, totalInput, totalOutput, 0, 0)

    return { minCost: minBreakdown.total, maxCost: maxBreakdown.total }
  }
}
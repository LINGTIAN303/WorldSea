/**
 * Provider 池管理
 *
 * ProviderSlot 是 AgentProfile 和 ProviderConfig 之间的间接层。
 * 一个 Pool 包含多个 Entry（API 连接配置），通过负载均衡策略选择使用哪个。
 *
 * 典型场景：
 * - 同一厂商多个 API Key 分摊速率限制
 * - 同厂商不同模型供不同 Agent 使用
 * - 多个自定义端点实例
 */

import type { ProviderConfig } from '../providers/config'
import { loadApiKey } from '../providers/key-store'
import type { ProviderSlot, ProviderSlotEntry } from './types'

interface SlotRuntime {
  slot: ProviderSlot
  rrIndex: number
  lastUsed: Map<string, number>
}

export class ProviderPool {
  private slots: Map<string, SlotRuntime> = new Map()

  register(slot: ProviderSlot): void {
    this.slots.set(slot.id, {
      slot,
      rrIndex: 0,
      lastUsed: new Map(),
    })
  }

  unregister(slotId: string): void {
    this.slots.delete(slotId)
  }

  update(slot: ProviderSlot): void {
    const existing = this.slots.get(slot.id)
    if (existing) {
      existing.slot = slot
    } else {
      this.register(slot)
    }
  }

  async resolve(slotId: string): Promise<ProviderConfig> {
    const runtime = this.slots.get(slotId)
    if (!runtime || runtime.slot.entries.length === 0) {
      throw new Error(`ProviderSlot "${slotId}" not found or empty`)
    }
    const entry = this.selectEntry(runtime)
    this.recordUsage(runtime, entry.id)
    return this.entryToConfig(entry)
  }

  private selectEntry(runtime: SlotRuntime): ProviderSlotEntry {
    const { slot } = runtime
    if (slot.entries.length === 1) return slot.entries[0]

    switch (slot.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(runtime)
      case 'random':
        return this.selectRandom(slot.entries)
      case 'least-recent':
        return this.selectLeastRecent(runtime)
      default:
        return slot.entries[0]
    }
  }

  private selectRoundRobin(runtime: SlotRuntime): ProviderSlotEntry {
    const index = runtime.rrIndex % runtime.slot.entries.length
    runtime.rrIndex = index + 1
    return runtime.slot.entries[index]
  }

  private selectRandom(entries: ProviderSlotEntry[]): ProviderSlotEntry {
    const totalWeight = entries.reduce((sum, e) => sum + (e.weight ?? 1), 0)
    let remaining = Math.random() * totalWeight
    for (const entry of entries) {
      remaining -= (entry.weight ?? 1)
      if (remaining <= 0) return entry
    }
    return entries[entries.length - 1]
  }

  private selectLeastRecent(runtime: SlotRuntime): ProviderSlotEntry {
    let oldest = runtime.slot.entries[0]
    let oldestTime = runtime.lastUsed.get(oldest.id) ?? 0
    for (const entry of runtime.slot.entries) {
      const usedAt = runtime.lastUsed.get(entry.id) ?? 0
      if (usedAt < oldestTime) {
        oldest = entry
        oldestTime = usedAt
      }
    }
    return oldest
  }

  private recordUsage(runtime: SlotRuntime, entryId: string): void {
    runtime.lastUsed.set(entryId, Date.now())
  }

  private async entryToConfig(entry: ProviderSlotEntry): Promise<ProviderConfig> {
    switch (entry.mode) {
      case 'cloud': {
        if (!entry.provider) {
          throw new Error(`ProviderSlotEntry "${entry.id}": cloud mode requires a provider (e.g. "openai", "anthropic")`)
        }
        const apiKey = entry.apiKeyId
          ? await loadApiKey(entry.apiKeyId)
          : ''
        return {
          mode: 'cloud',
          provider: entry.provider,
          modelId: entry.modelId,
          apiKey,
        }
      }
      case 'local':
        return {
          mode: 'local',
          endpoint: entry.baseUrl ?? 'http://localhost:11434',
          apiType: entry.localApiType ?? 'ollama',
          modelId: entry.modelId,
        }
      case 'custom': {
        if (!entry.baseUrl) {
          throw new Error(`ProviderSlotEntry "${entry.id}": custom mode requires a baseUrl`)
        }
        const apiKey = entry.apiKeyId
          ? await loadApiKey(entry.apiKeyId)
          : ''
        return {
          mode: 'custom',
          baseUrl: entry.baseUrl,
          apiKey,
          apiType: entry.apiType ?? 'openai-compatible',
          modelId: entry.modelId,
          contextWindow: entry.contextWindow,
          maxTokens: entry.maxTokens,
        }
      }
    }
  }
}

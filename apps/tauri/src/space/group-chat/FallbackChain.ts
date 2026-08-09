import { getModelInfo } from '@worldsmith/agent-runtime'

const FALLBACK_CHAINS: Record<string, string[]> = {
  anthropic: [
    'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022',
  ],
  openai: [
    'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5', 'gpt-4o', 'gpt-4o-mini',
  ],
  google: [
    'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro-preview-05-06', 'gemini-2.5-flash',
  ],
  deepseek: [
    'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-reasoner', 'deepseek-chat',
  ],
  groq: [
    'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
  zhipu: [
    'glm-5.1', 'glm-5', 'glm-4.5', 'glm-4.7-flash',
  ],
  qwen: [
    'qwen3.7-max', 'qwen3.6-plus', 'qwen3.6-flash',
  ],
  minimax: [
    'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5', 'minimax-vl-01',
  ],
  kimi: [
    'kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-128k',
  ],
  agnes: [
    'agnes-2.0-flash', 'agnes-1.5-flash',
  ],
}

export class FallbackChainImpl {
  private agentDegradationCount: Record<string, number> = {}
  private readonly MAX_DEGRADATIONS = 2

  getProviderForModel(modelId: string): string | null {
    const info = getModelInfo(modelId)
    return info?.provider ?? null
  }

  getFallback(modelId: string, agentId?: string): string | null {
    const provider = this.getProviderForModel(modelId)
    if (!provider) return null

    const chain = FALLBACK_CHAINS[provider]
    if (!chain) return null

    const currentIdx = chain.indexOf(modelId)
    if (currentIdx === -1) return chain.length > 0 ? chain[chain.length - 1] : null

    if (agentId) {
      const count = this.agentDegradationCount[agentId] || 0
      if (count >= this.MAX_DEGRADATIONS) return null
    }

    const nextIdx = currentIdx + 1
    if (nextIdx >= chain.length) return null

    return chain[nextIdx]
  }

  recordDegradation(agentId: string): void {
    this.agentDegradationCount[agentId] = (this.agentDegradationCount[agentId] || 0) + 1
  }

  getFullChain(modelId: string): string[] {
    const provider = this.getProviderForModel(modelId)
    if (!provider) return [modelId]
    return FALLBACK_CHAINS[provider] || [modelId]
  }

  getChainDisplay(modelId: string): { id: string; name: string; isCurrent: boolean }[] {
    const chain = this.getFullChain(modelId)
    return chain.map(id => {
      const info = getModelInfo(id)
      return {
        id,
        name: info?.name || id,
        isCurrent: id === modelId,
      }
    })
  }

  reset(): void {
    this.agentDegradationCount = {}
  }
}
import { getModelInfo } from '@worldsmith/agent-runtime'

const FALLBACK_CHAINS: Record<string, string[]> = {
  anthropic: [
    'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-haiku-4-5-20251001',
  ],
  openai: [
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini',
  ],
  google: [
    'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview',
  ],
  deepseek: [
    'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp',
  ],
  groq: [
    'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
  openrouter: ['openai/gpt-4o'],
  zhipu: [
    'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-4.7-flash',
  ],
  qwen: [
    'qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.7-flash', 'qwen3.6-plus',
  ],
  minimax: [
    'MiniMax-M3', 'MiniMax-M2.7',
  ],
  kimi: [
    'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5',
  ],
  agnes: [
    'agnes-2.5-pro', 'agnes-2.5-flash', 'agnes-2.0-flash', 'agnes-1.5-flash',
  ],
  sensenova: [
    'sensenova-6.5-pro', 'sensenova-6.5-turbo', 'sensenova-6.7-flash-lite',
  ],
  doubao: [
    'doubao-seed-evolving', 'doubao-seed-1.8', 'doubao-seed-2.1-pro', 'doubao-seed-2.1-turbo', 'doubao-seed-2.0-pro', 'doubao-seed-2.0-lite',
  ],
  xai: [
    'grok-4.6', 'grok-4.5',
  ],
  mistral: [
    'mistral-medium-3-5', 'mistral-large-latest', 'mistral-small-2603', 'devstral',
  ],
  stepfun: [
    'step-3.7-flash', 'step-3.5-flash', 'step-3.5-flash-2603',
  ],
  mimo: ['mimo-v2.5-pro', 'mimo-v2.5'],
  siliconflow: ['deepseek-ai/DeepSeek-V4-Flash'],
  tencentcloud: ['hy3'],
  longcat: ['longcat-2.0'],
  dots: ['dots-3-note-preview'],
  xfyun: ['spark-ultra'],
  modelscope: ['deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
  kling: ['kling-v2'],
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
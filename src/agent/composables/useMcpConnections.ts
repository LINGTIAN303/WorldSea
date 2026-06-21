import { ref } from 'vue'
import type { MCPConnectionConfig, MCPConnectionState } from '@agent/index'
import { useAgent } from './useAgent'

const STORAGE_KEY = 'agent_mcp_connections'
const connections = ref<MCPConnectionConfig[]>([])
const loaded = ref(false)

/** 内置默认 MCP 连接：开箱即用，用户可禁用/删除 */
export const DEFAULT_MCP_CONNECTIONS: MCPConnectionConfig[] = [
  {
    id: 'firecrawl-keyless',
    name: 'Firecrawl Keyless',
    transport: 'streamable-http',
    url: 'https://mcp.firecrawl.dev/v2/mcp',
    enabled: true,
  },
]

/**
 * 合并默认配置与用户存储配置。
 * - 默认配置作为基础层提供
 * - 用户存储配置按 id 覆盖默认配置（包括 enabled=false 的禁用状态）
 * - 被用户显式删除的默认服务，通过存储一个 enabled=false 的同 id 配置来保持移除
 */
function mergeWithDefaults(stored: MCPConnectionConfig[]): MCPConnectionConfig[] {
  const map = new Map<string, MCPConnectionConfig>()
  for (const cfg of DEFAULT_MCP_CONNECTIONS) {
    map.set(cfg.id, { ...cfg })
  }
  for (const cfg of stored) {
    if (!cfg?.id) continue
    map.set(cfg.id, { ...cfg })
  }
  return Array.from(map.values())
}

function loadFromStorage(): MCPConnectionConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const stored = raw ? JSON.parse(raw) : []
    return mergeWithDefaults(Array.isArray(stored) ? stored : [])
  } catch { return [...DEFAULT_MCP_CONNECTIONS] }
}

function saveToStorage(configs: MCPConnectionConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
  } catch {}
}

export function useMcpConnections() {
  function getAgentMethods() {
    try {
      return useAgent()
    } catch {
      return null
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    const agent = getAgentMethods()
    if (!agent) return
    loaded.value = true
    const configs = loadFromStorage()
    for (const config of configs) {
      if (config.enabled) {
        try { await agent.addMCPConnection(config) } catch {}
      }
    }
    connections.value = agent.getMCPConnections()
  }

  async function addConnection(config: MCPConnectionConfig): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    await agent.addMCPConnection(config)
    const configs = loadFromStorage().filter(c => c.id !== config.id)
    configs.push(config)
    saveToStorage(configs)
    connections.value = agent.getMCPConnections()
  }

  async function removeConnection(serverId: string): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    await agent.removeMCPConnection(serverId)
    const configs = loadFromStorage()
    const idx = configs.findIndex(c => c.id === serverId)
    if (idx !== -1) {
      // 删除用户自己添加的配置
      configs.splice(idx, 1)
    }
    // 对于默认配置，写入 enabled=false 占位，避免下次启动被合并回来
    const isDefault = DEFAULT_MCP_CONNECTIONS.some(c => c.id === serverId)
    if (isDefault && !configs.some(c => c.id === serverId)) {
      const defaultCfg = DEFAULT_MCP_CONNECTIONS.find(c => c.id === serverId)!
      configs.push({ ...defaultCfg, enabled: false })
    }
    saveToStorage(configs)
    connections.value = agent.getMCPConnections()
  }

  async function toggleConnection(serverId: string): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    const configs = loadFromStorage()
    let cfg = configs.find(c => c.id === serverId)
    if (!cfg) {
      // 可能是默认配置尚未写入存储：基于默认配置创建条目
      const defaultCfg = DEFAULT_MCP_CONNECTIONS.find(c => c.id === serverId)
      if (!defaultCfg) return
      cfg = { ...defaultCfg }
      configs.push(cfg)
    }
    cfg.enabled = !cfg.enabled
    saveToStorage(configs)
    if (cfg.enabled) {
      try { await agent.addMCPConnection(cfg) } catch {}
    } else {
      await agent.removeMCPConnection(serverId)
    }
    connections.value = agent.getMCPConnections()
  }

  async function refreshConnections(): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    connections.value = agent.getMCPConnections()
  }

  return {
    connections,
    ensureLoaded,
    addConnection,
    removeConnection,
    toggleConnection,
    refreshConnections,
  }
}

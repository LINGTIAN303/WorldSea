/** MCP 连接管理（端无关：options.getAgent 注入解耦），详细见 docs/details/注释/packages/shared-composables/agent/useMcpConnections.md */

import { ref } from 'vue'
import type { MCPConnectionConfig, MCPConnectionState } from '@agent/index'

const connections = ref<MCPConnectionState[]>([])
const loaded = ref(false)
/** 本次进程内「启动自动重连失败」列表（enabled 但未连接；App 启动消费一次后清空，T09②） */
const autoReconnectFailed = ref<Array<{ id: string; name: string }>>([])

/**
 * useMcpConnections 选项
 *
 * 配置唯一事实源 = Rust 全局配置文件 mcp.json（H6-③ 配置化拍板 2026-08-30：
 * `<app_data>/worldsea/mcp.json`，用户与 Agent 均可编辑，官方预设全部移除）。
 * 本层只维护 Vue 展示缓存与交互编排——**不再有 localStorage 镜像与内置默认
 * 连接**（旧 agent_mcp_connections key 与 DEFAULT_MCP_CONNECTIONS 已废弃）；
 * 启动重连由 Rust auto_connect_all 直接读配置文件完成，前端 ensureLoaded 只取状态。
 */
export interface UseMcpConnectionsOptions {
  /** Agent 获取函数（注入式），未提供或抛错时降级为 null */
  getAgent?: () => any
}

export function useMcpConnections(options: UseMcpConnectionsOptions = {}) {
  const { getAgent } = options

  function getAgentMethods() {
    if (!getAgent) return null
    try {
      return getAgent()
    } catch {
      return null
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    const agent = getAgentMethods()
    if (!agent) return
    loaded.value = true
    // Rust 启动时已按配置文件 auto_connect_all，这里只取「配置+状态」合并视图
    connections.value = await agent.getMCPConnections()
    // M6（2026-09-17 三域对齐 dsh）：绑定 Rust 状态机事件（连接/重连/失败/断开时实时刷新）
    agent.onMCPStatusChanged?.(() => {
      void refreshConnections()
    })
    void agent.ensureMCPStatusListener?.()
    // T09②（2026-09-01）：启动自动重连失败检测——enabled 但未连上即属于
    // 启动重连失败（服务器未起/网络/鉴权等）。供应用根组件消费并提示一次。
    autoReconnectFailed.value = connections.value
      .filter((c) => c.config.enabled && c.status !== 'connected')
      .map((c) => ({ id: c.id, name: c.config.name }))
  }

  /** 消费并清空「启动自动重连失败」列表（App 启动提示一次后置空，避免重复打扰） */
  function takeAutoReconnectFailed(): Array<{ id: string; name: string }> {
    const list = autoReconnectFailed.value
    autoReconnectFailed.value = []
    return list
  }

  async function addConnection(config: MCPConnectionConfig): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    try {
      await agent.addMCPConnection(config)
    } catch (e) {
      // cmd_mcp_connect 在连接失败时直接返回、不落盘；这里补一次 save，
      // 让配置以启用态保留 → 进入「连接失败」组并保留重试入口（C-2，2026-09-17 UI 优化）
      try { await agent.saveMCPConnection({ ...config, enabled: true }) } catch {}
      throw e
    }
    connections.value = await agent.getMCPConnections()
  }

  async function removeConnection(serverId: string): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    await agent.removeMCPConnection(serverId)
    connections.value = await agent.getMCPConnections()
  }

  /** 启停切换：禁用=保存配置(enabled=false)+断开（配置保留）；启用=保存并连接 */
  async function toggleConnection(serverId: string): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    const current = connections.value.find((c) => c.id === serverId)
    if (!current) return
    const next: MCPConnectionConfig = { ...current.config, enabled: !current.config.enabled }
    if (next.enabled) {
      // 启用：连接即持久化；失败时保持启用态并补存配置（落「连接失败」组可重试），
      // 不再静默回写禁用（C-2，2026-09-17）
      try {
        await agent.addMCPConnection(next)
      } catch (e) {
        try { await agent.saveMCPConnection(next) } catch {}
        throw e
      }
    } else {
      await agent.saveMCPConnection(next)
      try { await agent.disconnectMCPConnection(serverId) } catch {}
    }
    connections.value = await agent.getMCPConnections()
  }

  /** 仅保存不连接（编辑已禁用服务器时使用，避免意外发起连接） */
  async function saveConnection(config: MCPConnectionConfig): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    await agent.saveMCPConnection(config)
    connections.value = await agent.getMCPConnections()
  }

  /** 重试连接（「连接失败」组）：取当前配置重新 connect（cmd_mcp_connect 幂等 upsert） */
  async function retryConnection(serverId: string): Promise<void> {
    const current = connections.value.find((c) => c.id === serverId)
    if (!current) return
    await addConnection({ ...current.config, enabled: true })
  }

  async function refreshConnections(): Promise<void> {
    const agent = getAgentMethods()
    if (!agent) return
    connections.value = await agent.getMCPConnections()
  }

  return {
    connections,
    ensureLoaded,
    takeAutoReconnectFailed,
    addConnection,
    removeConnection,
    toggleConnection,
    saveConnection,
    retryConnection,
    refreshConnections,
  }
}

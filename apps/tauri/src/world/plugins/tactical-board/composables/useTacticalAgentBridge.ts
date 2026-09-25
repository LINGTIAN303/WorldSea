import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'

// 部署单位所需统计信息
export interface DeployStats {
  hp: number
  attack: number
  defense: number
  speed: number
  moveRange: number
  attackRange: number
}

// 部署单位所需实体信息
export interface DeployEntity {
  id: string
  name: string
  type?: string
}

// Agent 桥接处理函数集合：父组件提供具体实现
export interface TacticalAgentHandlers {
  onDeployEntity: (entity: DeployEntity, team: string, stats: DeployStats) => void
  onMoveUnit: (x: number, y: number) => void
  onSimulateTurn: (full: boolean) => void
  // 返回当前战斗状态（用于 get_battle_state 调试输出）
  getBattleState: () => unknown
}

/**
 * 战术板 Agent 桥接
 *
 * 将原 useAgentPluginBridge 中针对 'tactical-board' 的事件分发逻辑封装为独立 composable，
 * 父组件只需提供四个业务处理函数，无需关心事件解析细节。
 */
export function useTacticalAgentBridge(handlers: TacticalAgentHandlers) {
  useAgentPluginBridge('tactical-board', (event) => {
    const { action, payload } = event
    switch (action) {
      case 'deploy_unit': {
        const team = (payload.team as string) || 'ally'
        const stats = payload.stats as DeployStats | undefined
        const entity = payload.entity as DeployEntity | undefined
        if (entity && stats) {
          handlers.onDeployEntity(entity, team, stats)
        }
        break
      }
      case 'move_unit': {
        const { x, y } = payload as { x: number; y: number }
        if (typeof x === 'number' && typeof y === 'number') {
          handlers.onMoveUnit(x, y)
        }
        break
      }
      case 'get_battle_state': {
        console.log('[TacticalBoard] battle state:', JSON.stringify(handlers.getBattleState()))
        break
      }
      case 'simulate_turn': {
        handlers.onSimulateTurn(payload?.full === true)
        break
      }
      default:
        console.log(`[Agent→tactical-board] unknown action: ${action}`, payload)
    }
  })
}

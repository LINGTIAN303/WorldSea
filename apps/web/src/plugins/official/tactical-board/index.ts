import type { PluginAPIType } from '@worldsmith/entity-core'
import TacticalBoardView from './TacticalBoardView.vue'

export const manifest = {
  id: 'official.tactical-board',
  name: '战术棋盘',
  version: '1.0.0',
  description: '棋盘式战术推演，在网格上布置实体作为棋子',
  author: 'WorldSmith',
  agentSkills: ['tactical-planner'],
  agentCapabilities: [
    { action: 'deploy_unit', description: '部署单位', params: ['unitId', 'position', 'formation'] },
    { action: 'move_unit', description: '移动单位', params: ['unitId', 'newPosition'] },
    { action: 'get_battle_state', description: '获取战场状态' },
    { action: 'simulate_turn', description: '模拟战斗回合', params: ['actions'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑战术棋盘' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityType({
    type: 'tactical-board',
    label: '战术棋盘',
    icon: 'tactical-board',
    fields: [
      { key: 'gridType', label: '网格类型', type: 'select', options: ['square', 'hex'] },
      { key: 'gridSize', label: '网格规格', type: 'text' },
      { key: 'terrain', label: '地形数据', type: 'textarea' },
      { key: 'units', label: '单位数据', type: 'textarea' },
      { key: 'combatStats', label: '战斗统计', type: 'textarea' },
      { key: 'coverImage', label: '封面图', type: 'image' },
      { key: 'battleState', label: '战斗状态', type: 'textarea' },
    ],
  })

  api.registerView({
    id: 'tactical-board',
    label: '战术棋盘',
    icon: 'tactical-board',
    component: TacticalBoardView,
  })
}

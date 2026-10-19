import type { WorldPluginApi } from '../../api'
import TacticalBoardView from './TacticalBoardView.vue'

export const manifest = {
  id: 'official.tactical-board',
  name: '战术棋盘',
  version: '1.0.0',
  description: '棋盘式战术推演，在网格上布置实体作为棋子',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'tactical-board',
    label: '战术棋盘',
    icon: 'tactical-board',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'gridType', label: '网格类型', fieldType: 'select', options: ['square', 'hex'].map(s => ({ value: s, label: s })) },
      { key: 'gridSize', label: '网格规格', fieldType: 'text' },
      { key: 'terrain', label: '地形数据', fieldType: 'textarea' },
      { key: 'units', label: '单位数据', fieldType: 'textarea' },
      { key: 'combatStats', label: '战斗统计', fieldType: 'textarea' },
      { key: 'battleState', label: '战斗状态', fieldType: 'textarea' },
    ],
  })

  api.registerView({
    id: 'tactical-board',
    label: '战术棋盘',
    icon: 'tactical-board',
    component: TacticalBoardView,
  })
}

export default { manifest, apply }

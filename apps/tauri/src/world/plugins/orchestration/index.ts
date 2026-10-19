import type { WorldPluginApi } from '../../api'
import OrchestrationView from './OrchestrationView.vue'

export const manifest = {
  id: 'official.orchestration',
  name: '创作编排',
  version: '2.0.0',
  description: '创作编排面板。将复杂创作目标拆解为有序创作计划（Pipeline），支持步骤库、步骤连接、模板复用。',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'pipeline',
    label: '创作计划',
    icon: 'lightning',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
    ],
    ownFields: [
      { key: 'steps', fieldType: 'text', label: '步骤 (JSON)', required: true },
      { key: 'connections', fieldType: 'text', label: '连接 (JSON)' },
      { key: 'status', fieldType: 'select', label: '状态', options: ['draft', 'ready', 'running', 'paused', 'completed', 'failed'].map(s => ({ value: s, label: s })), defaultValue: 'draft' },
      { key: 'currentStepId', fieldType: 'text', label: '当前步骤' },
    ],
  })

  api.registerView({
    id: 'orchestration',
    label: '创作编排',
    icon: 'lightning',
    component: OrchestrationView,
    // 全屏画布：工具条悬浮胶囊，不占 44px，hover 顶部浮现
    toolbar: 'overlay',
  })
}

export default { manifest, apply }

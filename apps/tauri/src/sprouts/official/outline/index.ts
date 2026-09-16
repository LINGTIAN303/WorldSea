import type { PluginAPIType } from '@worldsea/entity-core'
import OutlineView from './OutlineView.vue'
import BoardView from './board/BoardView.vue'

export const manifest = {
  id: 'official.outline',
  name: '大纲',
  version: '2.0.0',
  description: '大纲管理与章节规划',
  author: 'WorldSea',
  agentSkills: ['writing'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建大纲节点', params: ['title'] },
    { action: 'update_entity', description: '更新大纲节点', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑大纲节点' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'outline_node',
    label: '大纲节点',
    icon: 'outline',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
      { traitId: 'narrative' },
      { traitId: 'deteriorable', fieldOverrides: {
        condition: { label: '状态', options: ['未写', '草稿', '完成'].map(s => ({ value: s, label: s })) },
      } },
    ],
    ownFields: [
      { key: 'parentId', label: '父节点ID', fieldType: 'text' },
      { key: 'storylines', label: '所属线索', fieldType: 'text' },
      { key: 'manuscriptId', label: '关联章节ID', fieldType: 'text' },
    ],
  })

  // ── 白板（2026-09-16 批次 1）─────────────────────────────
  // 白板实体：容器/组件/视口都落在 properties（照 drawing 画板芽先例）；
  // 节点内容仍由 outline_node 派生，白板只记「哪个节点、什么表现形式、放在哪」。
  // 规格：docs/plans/2026-09-15-大纲芽重构-理论基线与现状.md §8.10.2
  api.registerEntityV2({
    type: 'outline_board',
    label: '大纲白板',
    icon: 'outline',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
    ],
    // identifiable 已提供 name/description，故此处只列白板专有字段
    ownFields: [
      { key: 'viewport', label: '视口', fieldType: 'text' },
      { key: 'layout', label: '布局体', fieldType: 'text' },
      { key: 'thumbnail', label: '缩略图', fieldType: 'text' },
      { key: 'snap', label: '吸附模式', fieldType: 'text' },
      { key: 'gridEnabled', label: '网格', fieldType: 'boolean' },
    ],
  })

  api.registerView({ id: 'outline', label: '大纲', icon: 'outline', component: OutlineView })

  // 白板视图与树视图**并存**（树 = 结构保真视图，白板 = 表现自由视图；09-15 文档 §8.10.5-F）
  api.registerView({
    id: 'outline-board',
    label: '大纲白板',
    icon: 'outline',
    component: BoardView,
  })
}

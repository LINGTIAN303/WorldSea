import type { WorldPluginApi } from '../../api'
import ManuscriptView from './ManuscriptView.vue'

export const manifest = {
  id: 'official.manuscript',
  domain: 'narrative',
  entityTypes: ['book', 'manuscript'],
  name: '正文写作',
  version: '2.0.0',
  description: '正文写作与章节管理',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  // 书籍实体（2026-09-14）：正文写作的顶层容器——先建书、书内建章（properties.bookId 归属），
  // 点击书籍才进入章节编辑器。无 bookId 的旧章节归「未归书」虚拟组，零迁移。
  api.registerEntityV2({
    type: 'book',
    label: '书籍',
    icon: 'book',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
    ],
    ownFields: [],
  })

  api.registerEntityV2({
    type: 'manuscript',
    label: '正文',
    icon: 'manuscript',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
      { traitId: 'narrative' },
      { traitId: 'deteriorable', fieldOverrides: {
        condition: { label: '状态', options: ['草稿', '修订中', '终稿'].map(s => ({ value: s, label: s })) },
      } },
    ],
    ownFields: [
      { key: 'outlineNodeId', label: '关联大纲节点ID', fieldType: 'text' },
      { key: 'volumeName', label: '所属卷名', fieldType: 'text' },
      { key: 'bookId', label: '所属书籍ID', fieldType: 'text' },
      { key: 'entityMentions', label: '提及实体ID列表', fieldType: 'text' },
      { key: 'snapshots', label: '版本快照', fieldType: 'text' },
    ],
  })

  api.registerView({ id: 'manuscript', label: '正文写作', icon: 'manuscript', component: ManuscriptView })
}

export default { manifest, apply }

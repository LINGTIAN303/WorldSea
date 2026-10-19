import type { WorldPluginApi } from '../../api'
import ConceptView from './ConceptView.vue'

export const manifest = {
  id: 'official.concepts',
  domain: 'knowledge',
  name: '概念/设定库',
  version: '2.0.0',
  description: '世界观中的概念、规则、百科条目',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'concept',
    label: '概念',
    icon: 'concept',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'conceptType', label: '类型', fieldType: 'select',
        options: ['概念', '规则', '魔法', '科技', '文化', '历史', '宗教', '生物', '语言', '社会制度', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'definition', label: '定义', fieldType: 'textarea' },
      { key: 'aliases', label: '别名/同义词', fieldType: 'tags' },
    ],
  })

  api.registerView({
    id: 'concepts',
    label: '概念/设定库',
    icon: 'concept',
    component: ConceptView,
  })
}

export default { manifest, apply }

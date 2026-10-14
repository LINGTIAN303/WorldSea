import type { FieldSchema } from '@worldsea/entity-core'
import type { WorldPluginApi } from '../../api'
import CharacterList from './CharacterList.vue'

/** 角色 ownFields（批8：表单/详情/schema 覆盖统一真源；autoLink 护栏测试直连此导出） */
export const characterOwnFields: FieldSchema[] = [
  { key: 'age', label: '年龄', fieldType: 'text' },
  { key: 'gender', label: '性别', fieldType: 'text' },
  { key: 'race', label: '种族', fieldType: 'text', autoLink: { targetType: 'species', relationType: 'belongs_to' } },
  { key: 'occupation', label: '职业', fieldType: 'text' },
  { key: 'affiliation', label: '所属势力', fieldType: 'text', autoLink: { targetType: 'organization', relationType: 'belongs_to' } },
  { key: 'role', label: '角色', fieldType: 'select', options: ['主角', '反派', '配角', '导师', '信使', '其他'].map(s => ({ value: s, label: s })) },
  { key: 'appearance', label: '外貌特征', fieldType: 'textarea' },
  { key: 'personality', label: '性格', fieldType: 'textarea' },
  { key: 'background', label: '背景故事', fieldType: 'textarea' },
]

export const manifest = {
  id: 'official.characters',
  name: '角色',
  version: '2.0.0',
  description: '管理世界观中的角色、NPC、主角等人物',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'character',
    label: '角色',
    icon: 'character',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'physical' },
      { traitId: 'ageable' },
      { traitId: 'ownable' },
    ],
    ownFields: characterOwnFields,
  })

  api.registerView({ id: 'characters', label: '角色', icon: 'character', component: CharacterList })
}

export default { manifest, apply }

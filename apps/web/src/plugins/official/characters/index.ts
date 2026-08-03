import type { PluginAPIType } from '@worldsmith/entity-core'
import CharacterList from './CharacterList.vue'

export const manifest = {
  id: 'official.characters',
  name: '角色',
  version: '2.0.0',
  description: '管理世界观中的角色、NPC、主角等人物',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding', 'roleplay'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建角色', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新角色属性', params: ['entityId', 'changes'] },
    { action: 'generate_dialogue', description: '生成角色对话', params: ['characterId', 'context'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑角色' },
    { name: 'relations:read', description: '查询关联关系' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
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
    ownFields: [
      { key: 'age', label: '年龄', type: 'text' },
      { key: 'gender', label: '性别', type: 'text' },
      { key: 'race', label: '种族', type: 'text', autoLink: { targetType: 'species', relationType: 'belongs_to' } },
      { key: 'occupation', label: '职业', type: 'text' },
      { key: 'affiliation', label: '所属势力', type: 'text', autoLink: { targetType: 'organization', relationType: 'belongs_to' } },
      { key: 'role', label: '角色', type: 'select', options: ['主角', '反派', '配角', '导师', '信使', '其他'] },
      { key: 'personality', label: '性格', type: 'textarea' },
      { key: 'background', label: '背景故事', type: 'textarea' },
    ],
  })

  api.registerView({ id: 'characters', label: '角色', icon: 'character', component: CharacterList })
}

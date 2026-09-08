import type { PluginAPIType } from '@worldsea/entity-core'
import LanguageView from './LanguageView.vue'

export const manifest = {
  id: 'official.languages',
  name: '语言/文字',
  version: '2.0.0',
  description: '管理世界观中的语言、文字系统',
  author: 'WorldSea',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建语言', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新语言属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑语言' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'language',
    label: '语言',
    icon: 'language',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'langType', label: '语言类型', fieldType: 'select',
        options: ['自然语言', '人造语言', '古代语言', '暗语/密语', '手语', '心灵感应', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'scriptType', label: '文字类型', fieldType: 'select',
        options: ['表音文字', '表意文字', '音节文字', '象形文字', '符文', '无文字', '混合'].map(s => ({ value: s, label: s })) },
      { key: 'languageFamily', label: '语系', fieldType: 'text' },
      { key: 'scope', label: '使用范围', fieldType: 'select',
        options: ['全球通用', '区域通用', '种族语言', '少数族群', '已灭绝', '特定群体'].map(s => ({ value: s, label: s })) },
      { key: 'maturity', label: '成熟度', fieldType: 'select',
        options: ['完整语言', '基础词汇表', '仅有短语', '发展中'].map(s => ({ value: s, label: s })) },
      { key: 'phonology', label: '音系特点', fieldType: 'textarea' },
      { key: 'grammar', label: '语法特点', fieldType: 'textarea' },
      { key: 'vocabulary', label: '词汇示例', fieldType: 'textarea' },
      { key: 'sampleText', label: '文字示例', fieldType: 'textarea' },
    ],
  })

  api.registerView({ id: 'languages', label: '语言/文字', icon: 'language', component: LanguageView })
}

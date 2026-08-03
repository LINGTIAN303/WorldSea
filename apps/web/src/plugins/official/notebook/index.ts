import type { PluginAPIType } from '@worldsmith/entity-core'
import NotebookView from './NotebookView.vue'

export const manifest = {
  id: 'official.notebook',
  name: '笔记本',
  version: '2.0.0',
  description: '自由笔记与知识管理',
  author: 'WorldSmith',
  agentSkills: ['writing', 'worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建笔记', params: ['title'] },
    { action: 'update_entity', description: '更新笔记', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑笔记' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'notebook',
    label: '笔记',
    icon: 'notebook',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
      { traitId: 'narrative' },
    ],
    ownFields: [
      { key: 'noteType', label: '笔记类型', type: 'select', options: ['markdown', 'code', 'canvas', 'reference'] },
      { key: 'backlinks', label: '反向链接', type: 'text' },
      { key: 'forwardLinks', label: '正向链接', type: 'text' },
      { key: 'linkedEntities', label: '关联实体', type: 'text' },
      { key: 'codeLanguage', label: '代码语言', type: 'text' },
      { key: 'codeOutput', label: '代码输出', type: 'text' },
      { key: 'folderId', label: '所属文件夹', type: 'text' },
    ],
  })

  api.registerView({ id: 'notebook', label: '笔记本', icon: 'notebook', component: NotebookView })
}

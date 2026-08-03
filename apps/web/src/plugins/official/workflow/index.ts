import type { PluginAPIType } from '@worldsmith/entity-core'
import WorkflowView from './WorkflowView.vue'

export const manifest = {
  id: 'official.workflow',
  name: '创作编排',
  version: '2.0.0',
  description: '创作编排面板。将复杂创作目标拆解为有序步骤（Pipeline），支持 Agent 自动提议、逐步执行、用户审阅介入、模板复用。',
  author: 'WorldSmith',
  agentSkills: ['creation-orchestrator'],
  agentCapabilities: [
    { action: 'pipeline_create', description: '创建创作计划', params: ['name', 'description', 'steps', 'connections', 'tags'] },
    { action: 'pipeline_list', description: '列出创作计划' },
    { action: 'pipeline_get', description: '获取创作计划详情', params: ['pipelineId'] },
    { action: 'pipeline_update', description: '更新创作计划（步骤、连接、状态等）', params: ['pipelineId', 'changes'] },
    { action: 'pipeline_delete', description: '删除创作计划', params: ['pipelineId'] },
    { action: 'pipeline_run_step', description: '执行单个创作步骤', params: ['pipelineId', 'stepId'] },
    { action: 'pipeline_propose', description: '根据目标自动提议创作计划', params: ['goal'] },
    { action: 'pipeline_template_list', description: '列出可用的创作模板' },
    { action: 'pipeline_template_apply', description: '套用创作模板生成计划', params: ['templateId'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑创作计划' },
    { name: 'relations:read', description: '查询关联关系' },
    { name: 'relations:write', description: '创建和编辑关系' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityType({
    type: 'pipeline',
    label: '创作计划',
    icon: 'lightning',
    fields: [
      { key: 'name', type: 'text', label: '名称', required: true },
      { key: 'description', type: 'text', label: '描述' },
      { key: 'steps', type: 'text', label: '步骤 (JSON)', required: true },
      { key: 'connections', type: 'text', label: '连接 (JSON)' },
      { key: 'status', type: 'select', label: '状态', options: ['draft', 'ready', 'running', 'paused', 'completed', 'failed'], defaultValue: 'draft' },
      { key: 'tags', type: 'textarea', label: '标签' },
      { key: 'currentStepId', type: 'text', label: '当前步骤' },
    ],
  })

  api.registerView({
    id: 'workflow',
    label: '创作编排',
    icon: 'lightning',
    component: WorkflowView,
  })
}

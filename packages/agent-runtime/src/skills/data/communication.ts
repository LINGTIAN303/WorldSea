// 技能元数据（沟通协作类）。
// 2026-09-21 世界观芽工具整合（批 3）：26 项芽所属技能已退役——其「使用方法」迁入
// worldview 工具（tools/worldview/guides.ts，见 docs/plans/2026-09-21-世界观芽工具整合.md）；
// 本文件仅保留挂账的 creation-orchestrator（单独议，见 05-instructions类技能评估.md）。
// 此前存量处置：vision-analyzer（S4 退役）；timeline-architect / graph-explorer /
// mindmap-builder / manuscript-author（批 3 随芽技能退役移除）。
import type { SkillMeta } from '../registry'
import { getSkillVisibility } from './visibility'

export const COMMUNICATION_SKILLS: SkillMeta[] = [
  {
    id: 'creation-orchestrator',
    name: '创作编排',
    icon: 'lightning',
    description: '创作编排面板。管理创作 Pipeline（创作计划），将复杂创作目标拆解为有序步骤并逐步执行。支持 Agent 自动提议 Pipeline、逐步执行创作任务、用户审阅介入、模板复用。关键词：创作、编排、Pipeline、计划、步骤、批量创作、一致性校验。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('creation-orchestrator'),
    version: '1.0.0',
    promptFile: 'creation-orchestrator/instructions.md',
    baseTools: [],
    allowedTools: [
      'pipeline_create', 'pipeline_update', 'pipeline_delete',
      'pipeline_list', 'pipeline_get',
      'pipeline_run_step', 'pipeline_propose',
      'pipeline_template_list', 'pipeline_template_apply',
    ],
    examples: [
      '帮我从零设计一个中世纪王国，包含地理、物种、文化、势力',
      '创建一个角色关系网络的创作计划',
      '把当前 Pipeline 保存为模板',
      '用「魔法体系」模板创建一个新的创作计划',
    ],
    triggers: ['创作', '编排', 'Pipeline', '计划', '步骤', '批量创作', '一致性校验'],
    tags: ['创作', '编排', 'Pipeline', '计划', '步骤'],
    priority: 7,
    outputPreferences: [
      { channel: 'chat', condition: '创作步骤执行结果报告时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出 Pipeline 列表 / 模板列表时' },
    ],
  },
]

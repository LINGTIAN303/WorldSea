// 技能元数据（分析类），来源 registry.ts SKILL_REGISTRY 拆分，见 docs/details/注释/packages/agent-runtime/skills-registry.md
import type { SkillMeta } from '../registry'
import { getSkillVisibility } from './visibility'

export const ANALYSIS_SKILLS: SkillMeta[] = [
  // 2026-09-18 S4 存量处置：deep-thinking / task-execution / knowledge-explorer 三件已退役
  // （T1：能力已由 plan_* 原生工具与 kb/web 工具面承载；见 docs/plans/2026-09-17-三域对齐dsh/04-存量处置查清清单.md）
  {
    id: 'web-scout',
    name: '联网搜索',
    icon: 'globe',
    description: '联网搜索与网页阅读。关键词：搜索、查找、联网、网页、互联网、最新、资料、参考。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('web-scout'),
    version: '1.0.0',
    promptFile: 'web-scout/SKILL.md',
    baseTools: [],
    allowedTools: ['web_search', 'web_fetch'],
    examples: ['搜索中世纪城堡的建筑特点', '阅读这个网页的完整内容', '查找文艺复兴时期的历史事件'],
    triggers: ['搜索', '查找', '联网', '网页', '互联网'],
    relatedPlugins: ['notebook'],
    pluginTools: [
      { pluginId: 'notebook', tools: ['notebook'] },
    ],
    tags: ['搜索', '联网', '网页', '资料'],
    priority: 10,
    outputPreferences: [
      { channel: 'chat', condition: '搜索结果摘要时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '对比多个搜索结果时' },
      { channel: 'plugin', plugin: 'notebook', condition: '收集资料需保存时' },
    ],
  },
  // 2026-09-18 S4 存量处置（T1+T2）：memory / knowledge-base / project-io 三件已退役
  // （能力分别由 Rust 原生 memory_* 、桥 kb_* 9 件、桥 project_* 2 件 + consistency_check 承载）
  {
    id: 'output-orchestrator',
    name: '输出编排',
    icon: 'target',
    description: '输出路由与编排。根据内容类型和技能偏好，智能选择输出通道和组件。关键词：输出、展示、渲染、写入、表格、图表、流程图、笔记、导出。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('output-orchestrator'),
    version: '1.0.0',
    promptFile: 'output-orchestrator/SKILL.md',
    baseTools: [],
    allowedTools: ['ui_create_surface', 'ui_update_components', 'ui_update_data', 'ui_delete_surface', 'plugin_write', 'notebook_create', 'notebook_update', 'notebook_link', 'code_execute', 'file_write', 'file_analyze', 'a2ui_show_entity', 'a2ui_show_relation'],
    examples: ['用表格展示这些数据', '把分析结果写入笔记本', '生成流程图'],
    references: ['references/output-channel-guide.md', 'references/component-catalog.md'],
    triggers: ['输出', '展示', '渲染', '写入', '表格', '图表'],
    relatedPlugins: ['manuscript', 'notebook', 'outline', 'items', 'apparel'],
    pluginTools: [
      { pluginId: 'manuscript', tools: ['manuscript'] },
      { pluginId: 'notebook', tools: ['notebook'] },
      { pluginId: 'outline', tools: ['outline'] },
    ],
    tags: ['输出', '渲染', '展示', '编排'],
    priority: 10,
    outputPreferences: [
      { channel: 'a2ui', component: 'EditableTable', condition: '结构化数据对比时' },
      { channel: 'a2ui', component: 'ChartView', condition: '数值可视化时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '流程/关系图时' },
      { channel: 'plugin', plugin: 'notebook', condition: '需持久保存的内容' },
      { channel: 'plugin', plugin: 'manuscript', condition: '正文/剧情内容' },
      { channel: 'file', condition: '需导出为文件时' },
      { channel: 'chat', condition: '简短文本回复' },
    ],
  },
  {
    id: 'module-builder',
    name: '模块构建师',
    icon: 'module-builder',
    description: '自定义模块构建助手。帮助用户在编辑器中拼装组件、配置布局、优化交互、创建/删除模块。支持表格/图表/表单/列表/卡片等组件类型。关键词：自定义模块、拼装、组件、布局、槽位、编辑器、创建模块。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('module-builder'),
    version: '1.0.0',
    promptFile: 'module-builder/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: ['module_builder'],
    examples: ['帮我创建一个角色管理模块', '给这个模块加个搜索框', '推荐一个数据分析布局'],
    triggers: ['自定义模块', '拼装', '组件', '布局', '槽位', '编辑器'],
    relatedPlugins: ['module-builder'],
    tags: ['自定义', '组件', '模块', '布局'],
    priority: 6,
    outputPreferences: [
      { channel: 'chat', condition: '布局建议和方案说明时' },
      { channel: 'a2ui', component: 'ConfirmBar', condition: '需要用户确认操作时' },
    ],
  },
]

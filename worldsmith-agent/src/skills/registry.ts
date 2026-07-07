export interface OutputPreference {
  channel: 'chat' | 'a2ui' | 'plugin' | 'file'
  component?: string
  plugin?: string
  condition?: string
}

export interface PluginToolBinding {
  pluginId: string
  tools: string[]
  capabilities?: string[]
}

export interface SkillMeta {
  id: string
  name: string
  icon: string
  description: string
  category: 'domain' | 'action' | 'persona'
  enabled: boolean
  promptFile?: string
  allowedTools: string[]
  baseTools: string[]
  examples?: string[]
  references?: string[]
  triggers?: string[]
  outputPreferences?: OutputPreference[]
  relatedPlugins?: string[]
  pluginTools?: PluginToolBinding[]
  tags?: string[]
  priority?: number
  autoActivate?: boolean
  visibility: SkillVisibility
  version: string
  capabilities?: import('../toolbus/capability-types').SkillCapabilityBinding
  schemaContext?: import('../toolbus/capability-types').SkillSchemaContext
}

export type SkillVisibility = 'always' | 'advanced' | 'developer' | 'hidden'

export const SKILL_META_REQUIRED_FIELDS: (keyof SkillMeta)[] = [
  'id', 'name', 'icon', 'description', 'category', 'enabled',
  'visibility', 'version', 'promptFile', 'allowedTools', 'baseTools',
]

const SKILL_DEVELOPER_TOOLS = [
  'code-reviewer', 'test-automator', 'doc-generator', 'security-scanner', 'sys-inspector',
]

const SKILL_ADVANCED_TOOLS = [
  'pkg-manager', 'git-operator', 'web-cli-operator', 'terminal-operator', 'terminal-launcher',
]

function getSkillVisibility(skillId: string): SkillVisibility {
  if (SKILL_DEVELOPER_TOOLS.includes(skillId)) return 'developer'
  if (SKILL_ADVANCED_TOOLS.includes(skillId)) return 'advanced'
  return 'always'
}

/**
 * Skill 注册中心
 *
 * 定义所有 WorldSmith Skill 的元数据和工具权限。
 * 核心功能：
 * - ALWAYS_AVAILABLE_TOOLS: 所有技能下始终可用的工具白名单
 * - SKILL_REGISTRY: 所有技能的静态配置数组
 * - resolveToolNames: 根据激活技能合并可用工具集
 * - buildSkillIndexPrompt: 生成 Skill 列表的系统提示词
 * - buildOutputGuidePrompt: 生成输出通道偏好的提示词
 * - validateRegistryConsistency: 注册表一致性校验
 */

export const ALWAYS_AVAILABLE_TOOLS = [
  'entity_list', 'entity_get', 'content_search', 'relation_list',
  'entity_suggest_field', 'entity_smart_fill', 'entity_get_context',
  'daily_report', 'consistency_check',
  'memory_store', 'memory_recall', 'memory_delete',
  'kb_write', 'kb_read', 'kb_list', 'kb_search', 'kb_delete', 'kb_extract', 'kb_reflect', 'kb_link', 'kb_init',
  'project_export', 'project_import',
  'load_skill',
  'output_table', 'output_choice', 'output_code', 'output_entity_card',
  'output_alert', 'output_stat', 'output_list', 'output_progress',
  'output_comparison', 'output_timeline', 'output_image', 'output_accordion',
  'vision_analyze', 'list_vision_images',
  'image_generate', 'image_gen_config', 'image_list', 'image_show',
  'read_file', 'clipboard_read', 'clipboard_write', 'notify',
  // 编码 Agent 标准工具集
  'read_file', 'write_file', 'edit_file', 'search_files', 'list_directory',
  'execute_command', 'shell_session', 'web_search', 'web_fetch',
]

export const SKILL_REGISTRY: SkillMeta[] = [
  {
    id: 'worldbuilding',
    name: '世界观构建',
    icon: 'globe',
    description: '世界观构建与一致性验证。覆盖：region/organization/culture/species/language/conflict/event/building/concept/combat_stat。支持 20+ 种实体类型的全域设定。关键词：世界观、设定、完善、补充、推演、一致性、缺失、地理、势力、历史、文化、语言、冲突、建筑、概念。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('worldbuilding'),
    version: '2.0.0',
    promptFile: 'worldbuilding/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search', 'relation_list'],
    allowedTools: ['entity_create', 'entity_update', 'entity_delete', 'relation_create', 'relation_delete', 'schema_validate', 'consistency_check', 'algo_run', 'a2ui_show_entity', 'a2ui_show_relation'],
    examples: ['帮我完善这个世界观的地理设定', '检查世界观一致性', '推演缺失的势力关系', '设计一个完整的文化体系'],
    references: ['references/worldbuilding-checklist.md'],
    triggers: ['完善', '补充', '推演', '一致性', '缺失', '世界观', '设定', '文化', '语言', '冲突'],
    relatedPlugins: ['notebook', 'mindmap', 'graph', 'culture', 'languages', 'conflict', 'buildings', 'concepts'],
    pluginTools: [
      { pluginId: 'notebook', tools: ['notebook'] },
      { pluginId: 'mindmap', tools: ['mindmap'] },
      { pluginId: 'graph', tools: ['graph'] },
    ],
    tags: ['设定', '地理', '势力', '文化', '世界观', '物种', '语言', '冲突'],
    priority: 10,
    outputPreferences: [
      { channel: 'a2ui', component: 'EditableTable', condition: '输出实体对比/属性列表时' },
      { channel: 'a2ui', component: 'EntityCard', condition: '展示单个实体详情时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示实体关系网络时' },
      { channel: 'plugin', plugin: 'notebook', condition: '生成诊断报告/检查清单时' },
      { channel: 'chat', condition: '简短回答/确认信息' },
    ],
  },
  {
    id: 'content-craft',
    name: '内容创作',
    icon: 'magic',
    description: '批量生成实体、扩写描述、补充属性、生成关系网络。覆盖：character/region/item/weapon/apparel/plant/building/magic/combat_stat/concept/culture/language/conflict。支持 20+ 种实体类型的批量创作。关键词：生成、批量、扩写、补充、创建、丰富、角色卡、物品卡、武器卡。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('content-craft'),
    version: '2.0.0',
    promptFile: 'content-craft/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search', 'relation_list'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'a2ui_show_entity', 'ui_create_surface', 'ui_update_components', 'ui_update_data', 'file_write', 'memory_store'],
    examples: ['批量生成10个角色', '扩写所有区域的描述', '补充缺失的属性字段', '生成一套完整的装备系列'],
    references: ['references/content-templates.md'],
    triggers: ['生成', '批量', '扩写', '补充', '创建', '丰富', '装备', '系列'],
    relatedPlugins: ['notebook', 'manuscript', 'items', 'apparel', 'inspiration'],
    pluginTools: [
      { pluginId: 'notebook', tools: ['notebook'] },
      { pluginId: 'manuscript', tools: ['manuscript'] },
      { pluginId: 'items', tools: ['entity_type'] },
      { pluginId: 'apparel', tools: ['entity_type'] },
    ],
    tags: ['生成', '批量', '创作', '角色', '区域', '物品', '武器'],
    priority: 9,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示生成结果时' },
      { channel: 'a2ui', component: 'SuggestionPicker', condition: '提供生成选项让用户选择时' },
      { channel: 'plugin', plugin: 'notebook', condition: '批量生成记录需保存时' },
      { channel: 'chat', condition: '简短确认信息' },
    ],
  },
  {
    id: 'roleplay',
    name: '角色推演',
    icon: 'culture',
    description: '角色推演与对话模拟。覆盖：character/organization/species/conflict。支持角色弧光、多角色互动、冲突推演、成长轨迹分析。关键词：推演、对话、冲突、成长、角色、互动、模拟、人格、动机、弧光。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('roleplay'),
    version: '2.0.0',
    promptFile: 'roleplay/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'relation_list'],
    allowedTools: ['entity_update', 'relation_create', 'a2ui_show_entity', 'ui_create_surface', 'ui_update_components', 'algo_run', 'image_generate'],
    examples: ['推演角色A和角色B的对话', '模拟这个角色的成长弧光', '分析角色间的潜在冲突', '基于角色背景生成互动场景'],
    references: ['references/roleplay-patterns.md'],
    triggers: ['推演', '对话', '冲突', '成长', '角色', '互动', '弧光', '模拟'],
    relatedPlugins: ['manuscript', 'outline', 'characters', 'conflict'],
    pluginTools: [
      { pluginId: 'manuscript', tools: ['manuscript'] },
      { pluginId: 'outline', tools: ['outline'] },
      { pluginId: 'characters', tools: ['entity_type'] },
    ],
    tags: ['推演', '对话', '模拟', '角色互动'],
    priority: 8,
    outputPreferences: [
      { channel: 'chat', condition: '对话模拟/剧情输出时' },
      { channel: 'a2ui', component: 'EntityCard', condition: '展示角色状态变化时' },
      { channel: 'plugin', plugin: 'manuscript', condition: '剧情内容需写入正文时' },
    ],
  },
  {
    id: 'analysis-engine',
    name: '算法分析',
    icon: 'search',
    description: '算法分析引擎。图算法/几何/地形/CRDT/CAD/数值统计。关键词：算法、分析、路径、地形、图、几何、空间、布局、网络、碰撞、地形生成、统计、聚类、中心性。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('analysis-engine'),
    version: '1.0.0',
    promptFile: 'analysis-engine/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: [
      'algo_list', 'algo_run',
      'schema_validate', 'consistency_check',
      'ui_create_surface', 'ui_update_components', 'ui_update_data',
    ],
    examples: ['分析角色关系网络的重要性', '生成地形高度图', '计算两个区域的最短路径'],
    references: ['references/algo-catalog.md'],
    triggers: ['算法', '分析', '路径', '地形', '图', '几何', '空间', '布局'],
    relatedPlugins: ['graph', 'notebook', 'combat_stats'],
    pluginTools: [
      { pluginId: 'graph', tools: ['graph'] },
      { pluginId: 'notebook', tools: ['notebook'] },
    ],
    tags: ['算法', '分析', '图论', '几何', '地形', 'CRDT', '空间', '统计'],
    priority: 7,
    outputPreferences: [
      { channel: 'a2ui', component: 'ChartView', condition: '输出数值分析结果时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '输出关系/路径图时' },
      { channel: 'a2ui', component: 'SvgCanvas', condition: '输出地形/几何可视化时' },
      { channel: 'plugin', plugin: 'notebook', condition: '生成分析报告时' },
    ],
  },
  {
    id: 'retrofit-architect',
    name: '安全改造',
    icon: 'settings',
    description: '安全改造引擎。添加/删除/修改字段、实体类型、视图、主题、布局。关键词：改造、修改结构、添加字段、删除类型、主题、布局、Schema。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('retrofit-architect'),
    version: '1.0.0',
    promptFile: 'retrofit-architect/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: [
      'retrofit_begin_session', 'retrofit_submit_intent', 'retrofit_confirm_and_stage',
      'retrofit_apply_next', 'retrofit_verify_and_accept', 'retrofit_request_repair',
      'retrofit_redirect', 'retrofit_rollback_last', 'retrofit_abort',
      'retrofit_session_phase', 'retrofit_detect_conflicts', 'retrofit_end_session',
      'retrofit_patch_diff', 'retrofit_patch_apply',
      'retrofit_apply', 'retrofit_undo',
      'schema_register_entity_type', 'schema_unregister_entity_type',
      'schema_get_entity_type', 'schema_list_entity_types', 'schema_update_entity_type',
      'schema_register_validation', 'schema_register_view', 'schema_validate', 'schema_export',
      'ui_create_surface', 'ui_update_components', 'ui_update_data', 'ui_delete_surface',
    ],
    examples: ['添加一个新的实体类型', '修改角色类型的字段', '更换项目主题配色'],
    references: ['references/retrofit-phases.md', 'references/retrofit-intent-types.md'],
    triggers: ['改造', '修改结构', '添加字段', '删除类型', '主题', '布局', 'Schema'],
    relatedPlugins: ['notebook', 'module-builder'],
    pluginTools: [
      { pluginId: 'notebook', tools: ['notebook'] },
      { pluginId: 'module-builder', tools: ['module_builder'] },
    ],
    tags: ['改造', 'Schema', '结构', '迁移', '重构'],
    priority: 6,
    outputPreferences: [
      { channel: 'a2ui', component: 'ConfirmBar', condition: '需要用户确认改造计划时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '展示改造影响范围时' },
      { channel: 'chat', condition: '决策树/方案说明时' },
      { channel: 'plugin', plugin: 'notebook', condition: '记录改造历史时' },
      { channel: 'plugin', plugin: 'module-builder', condition: '输出改造后的模块视图变更时' },
    ],
  },
  {
    id: 'persona-possess',
    name: '人格附体',
    icon: 'character',
    description: '人格附体（视频模式专用）。AI以实体身份第一人称反应。覆盖：character/species/organization/region/item/event/faction。仅视频模式自动触发。',
    category: 'persona',
    enabled: true,
    visibility: getSkillVisibility('persona-possess'),
    version: '1.0.0',
    promptFile: 'persona-possess/SKILL.md',
    baseTools: ['entity_get', 'relation_list'],
    allowedTools: ['entity_create', 'entity_update'],
    examples: ['(视频模式自动触发)', '(人格附体响应)'],
    references: ['references/persona-types.md'],
    triggers: [],
    tags: ['视频模式', '人格附体', '第一人称'],
    priority: 1,
    autoActivate: true,
    relatedPlugins: ['manuscript'],
    pluginTools: [
      { pluginId: 'manuscript', tools: ['manuscript'] },
    ],
    outputPreferences: [
      { channel: 'chat', condition: '第一人称反应输出时' },
      { channel: 'plugin', plugin: 'manuscript', condition: '角色独白需写入正文时' },
    ],
  },
  {
    id: 'deep-thinking',
    name: '深度思考',
    icon: 'brain',
    description: '深度推理模式。强制工具验证、结构化推理链、置信度标注、创作落地。自动激活于深度思考聊天模式。不可手动激活。',
    category: 'action',
    enabled: true,
    visibility: 'hidden' as SkillVisibility,
    version: '2.0.0',
    promptFile: 'deep-thinking/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'entity_get_context', 'content_search', 'relation_list', 'kb_search', 'kb_list', 'kb_read', 'kb_extract', 'web_search', 'web_fetch', 'memory_recall'],
    allowedTools: [
      // 证据收集
      'entity_suggest_field', 'entity_smart_fill',
      'kb_reflect', 'kb_link',
      'vision_analyze', 'list_vision_images',
      'read_file', 'search_files', 'list_directory',
      // 推理分析
      'algo_run',
      'consistency_check', 'schema_validate',
      'graph',
      // 创作操作
      'entity_create', 'entity_update', 'entity_delete',
      'relation_create', 'relation_delete',
      'kb_write', 'kb_delete', 'kb_init',
      'memory_store', 'memory_delete',
      'image_generate',
      'persona_update',
      'load_skill',
      'schema_register_entity_type', 'schema_unregister_entity_type',
      'schema_get_entity_type', 'schema_list_entity_types', 'schema_update_entity_type',
      'schema_register_validation', 'schema_register_view', 'schema_export',
      'ui_create_surface', 'ui_update_components', 'ui_update_data',
      'a2ui_show_entity', 'a2ui_show_relation',
      'write_file', 'edit_file', 'execute_command',
      'project_export', 'project_import',
    ],
    examples: ['(深度思考模式自动激活)'],
    triggers: [],
    tags: ['深度思考', '推理', '验证', '结构化', '创作落地'],
    priority: 0,
    autoActivate: false,
    outputPreferences: [
      { channel: 'a2ui', component: 'List', condition: '子问题清单' },
      { channel: 'a2ui', component: 'EditableTable', condition: '证据汇总表' },
      { channel: 'a2ui', component: 'Comparison', condition: '多假设对比' },
      { channel: 'a2ui', component: 'Accordion', condition: '推理详情' },
      { channel: 'a2ui', component: 'Alert', condition: '最终结论+置信度' },
    ],
  },
  {
    id: 'task-execution',
    name: '任务执行',
    icon: 'play',
    description: '自主任务执行模式。用户给出高层目标，Agent 自主规划、连续执行、验证、重试，直到任务完成。区别于深度思考的分析推理，本模式专注于动手把事做完。自动激活于任务执行聊天模式。不可手动激活。',
    category: 'action',
    enabled: true,
    visibility: 'hidden' as SkillVisibility,
    version: '1.0.0',
    promptFile: 'task-execution/SKILL.md',
    baseTools: ['plan_create', 'plan_update', 'task_complete', 'read_file', 'search_files', 'list_directory', 'entity_list', 'entity_get', 'content_search', 'kb_search', 'kb_read', 'memory_recall'],
    allowedTools: [
      // 规划与控制工具
      'plan_create', 'plan_update', 'task_complete',
      // 文件与代码
      'read_file', 'write_file', 'edit_file', 'search_files', 'list_directory', 'execute_command',
      // 实体与关系
      'entity_create', 'entity_update', 'entity_delete',
      'relation_create', 'relation_delete',
      'entity_suggest_field', 'entity_smart_fill', 'entity_get_context',
      // 知识与记忆
      'kb_write', 'kb_delete', 'kb_init', 'kb_extract',
      'memory_store', 'memory_delete',
      // 输出
      'output_alert', 'output_list', 'output_code',
      // 外部信息
      'web_search', 'web_fetch',
      // 其他
      'load_skill',
      'project_export', 'project_import',
    ],
    examples: ['(任务执行模式自动激活)'],
    triggers: [],
    tags: ['任务执行', '自主', '规划', '验证', '重试', 'agentic'],
    priority: 0,
    autoActivate: false,
    outputPreferences: [
      { channel: 'a2ui', component: 'Alert', condition: '任务完成总结' },
      { channel: 'a2ui', component: 'List', condition: '执行结果清单' },
    ],
  },
  {
    id: 'knowledge-explorer',
    name: '知识探索',
    icon: 'compass',
    description: '知识挖掘模式。强制多源搜索、溯源标注、知识缺口识别。自动激活于知识探索聊天模式。不可手动激活。',
    category: 'action',
    enabled: true,
    visibility: 'hidden' as SkillVisibility,
    version: '1.0.0',
    promptFile: 'knowledge-explorer/SKILL.md',
    baseTools: ['kb_search', 'kb_list', 'kb_read', 'kb_write', 'kb_extract', 'entity_list', 'entity_get', 'content_search', 'relation_list', 'web_search', 'web_fetch'],
    allowedTools: [
      'kb_link', 'kb_reflect', 'kb_delete',
      'entity_create', 'entity_update', 'relation_create',
      'algo_run',
      'ui_create_surface', 'ui_update_components', 'ui_update_data',
      'a2ui_show_entity', 'a2ui_show_relation',
    ],
    examples: ['(知识探索模式自动激活)'],
    triggers: [],
    tags: ['知识探索', '搜索', '溯源', '知识库'],
    priority: 0,
    autoActivate: false,
    outputPreferences: [
      { channel: 'a2ui', component: 'EditableTable', condition: '搜索结果汇总' },
      { channel: 'a2ui', component: 'EntityCard', condition: '关键实体卡片' },
      { channel: 'a2ui', component: 'List', condition: '带溯源标注的结论' },
      { channel: 'a2ui', component: 'Accordion', condition: '知识缺口与建议' },
    ],
  },
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
  {
    id: 'memory',
    name: '长期记忆',
    icon: 'concept',
    description: '长期记忆管理。跨会话保存/检索偏好、设定、决策。关键词：记住、回忆、记忆、偏好、保存、遗忘。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('memory'),
    version: '1.0.0',
    promptFile: 'memory/SKILL.md',
    baseTools: [],
    allowedTools: [],
    examples: ['记住我喜欢简洁风格', '回忆关于魔法系统的设定', '列出所有记忆'],
    triggers: ['记住', '回忆', '记忆', '偏好'],
    tags: ['记忆', '偏好', '会话'],
    priority: 8,
    outputPreferences: [
      { channel: 'chat', condition: '记忆操作确认时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出记忆列表时' },
    ],
  },
  {
    id: 'knowledge-base',
    name: '知识库',
    icon: 'book',
    description: '知识库管理。Agent 自主管理专属知识空间，跨会话积累和检索知识。覆盖：用户画像、项目设定、实体洞察、决策记录、反思整合。关键词：知识库、记住、知识、积累、洞察、反思、整理。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('knowledge-base'),
    version: '1.0.0',
    promptFile: 'knowledge-base/SKILL.md',
    baseTools: [],
    allowedTools: [],
    examples: ['将魔法系统规则写入知识库', '搜索关于角色关系的知识', '整理知识库，压缩旧内容'],
    triggers: ['知识库', '知识', '积累', '洞察', '反思', '整理'],
    tags: ['知识库', '知识', '积累', '反思'],
    priority: 9,
    outputPreferences: [
      { channel: 'chat', condition: '知识操作确认时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出知识列表时' },
    ],
  },
  {
    id: 'project-io',
    name: '项目导入导出',
    icon: 'item',
    description: '项目数据导入导出。备份/恢复/迁移。关键词：导出、导入、备份、恢复、迁移。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('project-io'),
    version: '1.0.0',
    promptFile: 'project-io/SKILL.md',
    baseTools: [],
    allowedTools: [],
    examples: ['导出当前项目数据', '导入项目数据'],
    triggers: ['导出', '导入', '备份', '恢复'],
    tags: ['导出', '导入', '备份', '迁移'],
    priority: 7,
    outputPreferences: [
      { channel: 'a2ui', component: 'ConfirmBar', condition: '导入导出需确认时' },
      { channel: 'chat', condition: '操作报告时' },
    ],
  },
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
  {
    id: 'terminal-operator',
    name: '终端操作',
    icon: 'keyboard',
    description: '通过终端执行系统级命令和脚本',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('terminal-operator'),
    version: '1.0.0',
    promptFile: 'terminal-operator/instructions.md',
    baseTools: [],
    allowedTools: ['execute_command', 'shell_session', 'native_fetch', 'dialog_open', 'dialog_save', 'dialog_message', 'dialog_ask', 'open_url'],
    tags: ['终端', '命令', 'Shell'],
    priority: 5,
  },
  {
    id: 'fs-operator',
    name: '文件操作',
    icon: 'folder',
    description: '本地文件系统操作',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('fs-operator'),
    version: '1.0.0',
    promptFile: 'fs-operator/instructions.md',
    baseTools: [],
    allowedTools: ['read_file', 'write_file', 'edit_file', 'search_files', 'list_directory', 'execute_command'],
    tags: ['文件', '目录', '文件系统'],
    priority: 5,
  },
  {
    id: 'coding',
    name: '编码',
    icon: 'zap',
    description: '编码 Agent 标准工具集，对齐 Claude Code / Cline / Cursor 的工具接口。支持文件读写编辑、代码搜索、Shell 会话、联网搜索等完整编码能力',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('coding'),
    version: '1.0.0',
    promptFile: 'coding/SKILL.md',
    baseTools: [],
    allowedTools: ['read_file', 'write_file', 'edit_file', 'search_files', 'list_directory', 'execute_command', 'shell_session', 'web_search', 'web_fetch'],
    tags: ['编码', '编程', '代码', '开发'],
    priority: 8,
  },
  {
    id: 'pkg-manager',
    name: '包管理',
    icon: 'item',
    description: '依赖包安装与脚本运行',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('pkg-manager'),
    version: '1.0.0',
    promptFile: 'pkg-manager/instructions.md',
    baseTools: [],
    allowedTools: ['pkg_install', 'pkg_run', 'pkg_info'],
    tags: ['包管理', '依赖', 'NPM'],
    priority: 5,
  },
  {
    id: 'git-operator',
    name: 'Git 操作',
    icon: 'link',
    description: 'Git 版本控制与 GitHub CLI',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('git-operator'),
    version: '1.0.0',
    promptFile: 'git-operator/instructions.md',
    baseTools: [],
    allowedTools: ['git_status', 'git_log', 'git_diff', 'git_commit', 'git_branch', 'execute_command'],
    tags: ['Git', '版本控制', 'GitHub'],
    priority: 5,
  },
  {
    id: 'sys-inspector',
    name: '系统信息',
    icon: 'keyboard',
    description: '系统信息查询',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('sys-inspector'),
    version: '1.0.0',
    promptFile: 'sys-inspector/instructions.md',
    baseTools: [],
    allowedTools: ['sys_info', 'sys_processes', 'sys_disk'],
    tags: ['系统', '诊断', '进程'],
    priority: 3,
  },
  {
    id: 'web-cli-operator',
    name: 'CLI 联网',
    icon: 'globe',
    description: '通过 CLI 工具联网搜索和获取信息，无需 API Key。关键词：搜索、联网、网页、互联网、DNS、ping、howdoi。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('web-cli-operator'),
    version: '1.0.0',
    promptFile: 'web-cli-operator/instructions.md',
    baseTools: [],
    allowedTools: ['web_search_cli', 'web_fetch_cli', 'web_qa_cli', 'web_dns_cli', 'web_ping_cli'],
    tags: ['CLI', '联网', 'DNS', 'ping'],
    priority: 4,
  },
  {
    id: 'code-reviewer',
    name: '代码审查',
    icon: 'search',
    description: '代码质量审查与最佳实践检查。关键词：审查、review、代码质量、重构、优化、规范、lint。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('code-reviewer'),
    version: '1.0.0',
    promptFile: 'code-reviewer/instructions.md',
    baseTools: [],
    allowedTools: ['file_read', 'content_search', 'execute_command', 'read_file', 'search_files', 'entity_list', 'entity_get'],
    tags: ['审查', '代码', '质量', '重构'],
    priority: 4,
  },
  {
    id: 'test-automator',
    name: '测试自动化',
    icon: 'magic',
    description: '测试用例生成、运行与覆盖率分析。关键词：测试、test、单元测试、集成测试、覆盖率、TDD、BDD。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('test-automator'),
    version: '1.0.0',
    promptFile: 'test-automator/instructions.md',
    baseTools: [],
    allowedTools: ['file_read', 'file_write', 'execute_command', 'pkg_run', 'pkg_install', 'read_file', 'search_files'],
    tags: ['测试', 'TDD', '覆盖率'],
    priority: 4,
  },
  {
    id: 'doc-generator',
    name: '文档生成',
    icon: 'edit',
    description: '自动生成 API 文档、README、变更日志等。关键词：文档、doc、README、API文档、注释、变更日志。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('doc-generator'),
    version: '1.0.0',
    promptFile: 'doc-generator/instructions.md',
    baseTools: [],
    allowedTools: ['file_read', 'file_write', 'content_search', 'read_file', 'write_file', 'list_directory', 'search_files'],
    tags: ['文档', 'API', 'README'],
    priority: 4,
  },
  {
    id: 'security-scanner',
    name: '安全扫描',
    icon: 'shield',
    description: '依赖漏洞扫描与代码安全审计。关键词：安全、漏洞、audit、CVE、XSS、注入、密钥泄露。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('security-scanner'),
    version: '1.0.0',
    promptFile: 'security-scanner/instructions.md',
    baseTools: [],
    allowedTools: ['file_read', 'content_search', 'execute_command', 'read_file', 'search_files', 'web_search_cli'],
    tags: ['安全', '漏洞', '审计'],
    priority: 4,
  },
  {
    id: 'skill-creator',
    name: 'Skill 创建器',
    icon: 'character',
    description: '引导创建自定义 Skill 的元技能。关键词：创建 Skill、新建技能、自定义技能、Skill 开发。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('skill-creator'),
    version: '1.0.0',
    promptFile: 'skill-creator/instructions.md',
    baseTools: [],
    allowedTools: ['file_read', 'file_write', 'read_file', 'write_file', 'list_directory', 'content_search', 'entity_list', 'entity_get'],
    tags: ['Skill', '创建', '元技能'],
    priority: 2,
  },
  {
    id: 'find-skills',
    name: 'Skills 发现',
    icon: 'search',
    description: '发现和安装社区 Skills。关键词：找 Skill、安装技能、社区技能、推荐 Skill、awesome-agent-skills。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('find-skills'),
    version: '1.0.0',
    promptFile: 'find-skills/instructions.md',
    baseTools: [],
    allowedTools: ['web_search_cli', 'web_fetch_cli', 'read_file', 'write_file', 'list_directory', 'content_search'],
    tags: ['发现', '社区', '安装'],
    priority: 2,
  },
  {
    id: 'terminal-launcher',
    name: '终端启动器',
    icon: 'arrow-up',
    description: '智能终端启动器，自动识别 Tauri 桌面模式或 Web 应用模式，按正确模式调用终端能力。关键词：终端、terminal、启动终端、打开终端、执行命令、模式检测。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('terminal-launcher'),
    version: '1.0.0',
    promptFile: 'terminal-launcher/instructions.md',
    baseTools: [],
    allowedTools: ['detect_terminal_mode', 'start_server', 'launch_terminal', 'launch_terminal_script'],
    tags: ['终端', '启动', 'Tauri', '模式检测'],
    priority: 5,
  },
  {
    id: 'agent-orchestrator',
    name: 'Agent 调度器',
    icon: 'target',
    description: '多 Agent 调度与协调。让主 Agent 可以调度子 Agent 执行任务，支持终端执行、代码审查、研究调研、测试、文档生成、Git 操作等。关键词：子Agent、调度、并行、串行、委派、分工、多Agent。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('agent-orchestrator'),
    version: '1.0.0',
    promptFile: 'agent-orchestrator/instructions.md',
    baseTools: [],
    allowedTools: ['list_sub_agent_types', 'dispatch_sub_agent', 'get_sub_agent_status', 'cancel_sub_agent'],
    tags: ['调度', '多Agent', '并行', '委派'],
    priority: 6,
  },
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
  {
    id: 'vision-analyzer',
    name: '视觉分析',
    icon: 'eye',
    description: '图片视觉分析。当用户发送图片需要识别、描述、分析时自动触发。支持跨厂商调用视觉模型——即使当前主模型不支持视觉，也能通过此工具调用支持视觉的模型来分析图片。关键词：图片、视觉、识图、看图、照片、截图、图像。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('vision-analyzer'),
    version: '1.0.0',
    promptFile: 'vision-analyzer/instructions.md',
    baseTools: [],
    allowedTools: ['vision_analyze', 'list_vision_images'],
    triggers: ['图片', '视觉', '识图', '看图', '照片', '截图', '图像'],
    tags: ['视觉', '图片', '识图', '分析'],
    priority: 10,
    outputPreferences: [
      { channel: 'chat', condition: '图片分析结果和描述时' },
    ],
  },
  {
    id: 'timeline-architect',
    name: '时间线编排',
    icon: 'timeline',
    description: '时间线事件管理与可视化编排。支持双模式（水平甘特图/垂直树形）、泳道分组（角色/地点/纪元/标签）、折叠展开、缩放导航、拖拽改时间、冲突检测、因果图。对应 timeline 插件。关键词：时间线、事件、因果、年代、冲突检测、泳道、甘特图、缩放、并行、布局、分组。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('timeline-architect'),
    version: '2.0.0',
    promptFile: 'timeline-architect/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'consistency_check'],
    examples: ['在时间线上添加一个新事件', '按角色分组查看并行事件', '检测时间线的冲突', '切换为水平甘特图模式', '缩放到纪元视图', '拖拽调整事件时间'],
    triggers: ['时间线', '事件', '因果', '年代', '时间冲突', '泳道', '甘特图', '并行', '缩放', '布局', '分组'],
    relatedPlugins: ['timeline'],
    pluginTools: [
      { pluginId: 'timeline', tools: ['timeline'], capabilities: ['创建事件', '排序', '冲突检测', '布局切换', '泳道分组', '缩放导航', '折叠展开'] },
    ],
    tags: ['时间线', '事件', '因果', '时序', '泳道', '甘特图', '并行'],
    priority: 8,
    outputPreferences: [
      { channel: 'a2ui', component: 'EditableTable', condition: '列出事件列表时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示因果图时' },
      { channel: 'a2ui', component: 'output_timeline', condition: '展示时间线可视化时' },
      { channel: 'plugin', plugin: 'timeline', condition: '直接操作时间线视图时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'graph-explorer',
    name: '图谱探索',
    icon: 'graph',
    description: '全局关系图谱探索与分析。支持路径查找、聚类分析、节点高亮、快照导出、子图搜索、类型过滤。对应 graph 插件。关键词：图谱、关系网络、聚类、路径、连接、子图、社区。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('graph-explorer'),
    version: '1.0.0',
    promptFile: 'graph-explorer/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'relation_list'],
    allowedTools: ['algo_run'],
    examples: ['找到角色A到角色B的关系路径', '分析世界的关系网络聚类', '高亮与王国相关的所有实体'],
    triggers: ['图谱', '关系网络', '聚类', '路径', '连接', '关系图', '子图', '社区'],
    relatedPlugins: ['graph'],
    pluginTools: [
      { pluginId: 'graph', tools: ['graph'], capabilities: ['节点管理', '路径查询', '聚类分析', '子图搜索', '类型过滤'] },
    ],
    tags: ['图谱', '关系', '网络', '路径', '聚类'],
    priority: 9,
    outputPreferences: [
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示关系子图时' },
      { channel: 'plugin', plugin: 'graph', condition: '需要交互式图谱操作时' },
      { channel: 'chat', condition: '文字分析报告' },
    ],
  },
  {
    id: 'mindmap-builder',
    name: '思维导图',
    icon: 'map',
    description: '思维导图构建与管理。支持节点增删改、自动布局、树结构导出。对应 mindmap 插件。关键词：思维导图、脑图、节点、分支、导出。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('mindmap-builder'),
    version: '1.0.0',
    promptFile: 'mindmap-builder/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: ['entity_create', 'entity_update', 'entity_delete', 'relation_create'],
    examples: ['创建一个世界观思维导图', '给脑图添加一个分支节点', '重新布局思维导图'],
    triggers: ['思维导图', '脑图', '节点', '分支', '导图'],
    relatedPlugins: ['mindmap'],
    pluginTools: [
      { pluginId: 'mindmap', tools: ['mindmap'], capabilities: ['节点管理', '布局', '导出', '批量创建', '搜索'] },
    ],
    tags: ['思维导图', '脑图', '结构', '可视化'],
    priority: 7,
    outputPreferences: [
      { channel: 'plugin', plugin: 'mindmap', condition: '直接在导图画布上操作时' },
      { channel: 'chat', condition: '文字描述节点结构' },
    ],
  },
  {
    id: 'manuscript-author',
    name: '正文创作',
    icon: 'manuscript',
    description: '正文编辑器操作助手。支持章节创建/编辑/导出、实体引用插入、AI辅助写作。对应 manuscript 插件。关键词：正文、章节、写作、导出、引用。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('manuscript-author'),
    version: '1.0.0',
    promptFile: 'manuscript-author/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'file_write'],
    examples: ['创建一个新章节', '导出正文为PDF', '在正文中插入角色引用'],
    triggers: ['正文', '章节', '写作', '导出', '引用', '文稿'],
    relatedPlugins: ['manuscript'],
    pluginTools: [
      { pluginId: 'manuscript', tools: ['manuscript'], capabilities: ['章节管理', '内容编辑', '导出', '排序', '拆分'] },
    ],
    tags: ['正文', '章节', '写作', '导出'],
    priority: 9,
    outputPreferences: [
      { channel: 'plugin', plugin: 'manuscript', condition: '直接操作正文编辑器时' },
      { channel: 'chat', condition: '章节摘要或写作建议' },
    ],
  },
  {
    id: 'outline-architect',
    name: '大纲架构',
    icon: 'outline',
    description: '大纲与叙事结构管理。支持节点创建/移动/关联实体、树结构操作、导出。对应 outline 插件。关键词：大纲、叙事、结构、节点、层级。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('outline-architect'),
    version: '1.0.0',
    promptFile: 'outline-architect/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: ['entity_create', 'entity_update', 'entity_delete', 'relation_create'],
    examples: ['创建三幕式叙事大纲', '移动大纲节点', '关联角色到大纲节点'],
    triggers: ['大纲', '叙事', '结构', '节点', '层级', '幕'],
    relatedPlugins: ['outline'],
    pluginTools: [
      { pluginId: 'outline', tools: ['outline'], capabilities: ['节点管理', '层级操作', '实体关联', '删除', '批量创建'] },
    ],
    tags: ['大纲', '叙事', '结构', '故事线'],
    priority: 8,
    outputPreferences: [
      { channel: 'plugin', plugin: 'outline', condition: '直接操作大画面板时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出大纲树结构时' },
      { channel: 'chat', condition: '叙事建议' },
    ],
  },
  {
    id: 'notebook-curator',
    name: '笔记本管理',
    icon: 'manuscript',
    description: '笔记本整理与知识管理。支持笔记创建/编辑/链接、代码执行、导出。对应 notebook 插件。关键词：笔记、知识库、代码、链接、搜索。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('notebook-curator'),
    version: '1.0.0',
    promptFile: 'notebook-curator/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'file_write'],
    examples: ['创建一份世界观研究笔记', '建立笔记之间的双向链接', '在笔记中执行代码片段'],
    triggers: ['笔记', '知识库', '代码', '链接', '搜索', '记录'],
    relatedPlugins: ['notebook'],
    pluginTools: [
      { pluginId: 'notebook', tools: ['notebook'], capabilities: ['笔记管理', '代码执行', '双向链接', '搜索', '删除'] },
    ],
    tags: ['笔记', '知识库', '链接', '代码'],
    priority: 9,
    outputPreferences: [
      { channel: 'plugin', plugin: 'notebook', condition: '直接写入笔记本时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出笔记列表时' },
      { channel: 'chat', condition: '笔记摘要' },
    ],
  },
  {
    id: 'tactical-planner',
    name: '战术规划',
    icon: 'war',
    description: '战术面板操作助手。支持单位部署/移动、战场模拟、战斗日志导出。对应 tactical-board 插件。关键词：战术、布阵、战斗、模拟、部署。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('tactical-planner'),
    version: '1.0.0',
    promptFile: 'tactical-planner/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create'],
    examples: ['部署战斗单位', '模拟一回合战斗', '导出战斗日志'],
    triggers: ['战术', '布阵', '战斗', '模拟', '部署', '战场'],
    relatedPlugins: ['tactical-board'],
    pluginTools: [
      { pluginId: 'tactical-board', tools: ['tactical'], capabilities: ['单位管理', '战斗模拟', '日志导出', '撤销', '地形'] },
    ],
    tags: ['战术', '战斗', '布阵', '模拟'],
    priority: 7,
    outputPreferences: [
      { channel: 'plugin', plugin: 'tactical-board', condition: '直接操作战术面板时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出单位列表时' },
      { channel: 'chat', condition: '战斗分析报告' },
    ],
  },
  {
    id: 'magic-system-designer',
    name: '魔法系统设计',
    icon: 'magic',
    description: '魔法技能树设计与验证。支持技能节点创建/编辑、树结构验证、平衡性检查。对应 magic 插件。关键词：魔法、技能树、平衡、节点。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('magic-system-designer'),
    version: '1.0.0',
    promptFile: 'magic-system-designer/SKILL.md',
    baseTools: ['entity_list', 'entity_get'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create'],
    examples: ['创建一个新的魔法技能节点', '验证技能树的平衡性', '导出技能树数据'],
    triggers: ['魔法', '技能树', '平衡', '节点', '技能'],
    relatedPlugins: ['magic'],
    pluginTools: [
      { pluginId: 'magic', tools: ['magic'], capabilities: ['技能节点管理', '平衡验证', '导出', '删除', '依赖检查'] },
    ],
    tags: ['魔法', '技能树', '平衡', '设计'],
    priority: 7,
    outputPreferences: [
      { channel: 'plugin', plugin: 'magic', condition: '直接操作技能树视图时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示技能树结构时' },
      { channel: 'chat', condition: '设计建议' },
    ],
  },
  {
    id: 'character-profile',
    name: '角色档案',
    icon: 'character',
    description: '角色档案管理与深度分析。支持角色创建/属性编辑/关系网络/人物弧光追踪。覆盖 12 种关系类型（认识/盟友/敌对/师徒/配偶/亲属/属于/居住/拥有/参与/关联/兄弟姐妹）。对应 characters 插件。关键词：角色、人物、关系、家族、师徒、盟友、敌对、性格、背景。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('character-profile'),
    version: '1.0.0',
    promptFile: 'character-profile/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'entity_delete', 'relation_create', 'relation_list', 'relation_delete', 'a2ui_show_entity', 'algo_run'],
    examples: ['创建一个新角色并设置关系网络', '分析角色的社交影响力', '查找角色之间的隐藏关系链'],
    triggers: ['角色', '人物', '关系', '家族', '师徒', '性格', '背景', '人物弧光'],
    relatedPlugins: ['characters', 'mindmap'],
    pluginTools: [
      { pluginId: 'characters', tools: ['entity_type'], capabilities: ['角色管理', '关系查询', '角色搜索'] },
    ],
    tags: ['角色', '人物', '关系', '家族', '师徒', '盟友'],
    priority: 10,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示角色详情时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示角色关系网络时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出角色列表时' },
      { channel: 'plugin', plugin: 'characters', condition: '直接在角色列表中操作时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'culture-customs',
    name: '文化习俗',
    icon: 'culture',
    description: '文化习俗设计与推演。支持节日/仪式/禁忌/婚丧/饮食/服饰/艺术/建筑风格等文化细节的创建与管理。可关联地域、种族、组织和起源事件。对应 culture 插件。关键词：文化、习俗、节日、仪式、禁忌、婚俗、饮食、服饰。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('culture-customs'),
    version: '1.0.0',
    promptFile: 'culture-customs/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'relation_list', 'consistency_check'],
    examples: ['设计一个独特的文化节', '创建种族的婚礼仪式', '推演文化的历史起源'],
    triggers: ['文化', '习俗', '节日', '仪式', '禁忌', '婚俗', '饮食'],
    relatedPlugins: ['culture', 'timeline'],
    pluginTools: [
      { pluginId: 'culture', tools: ['entity_type'], capabilities: ['文化管理', '类型过滤'] },
    ],
    tags: ['文化', '习俗', '节日', '仪式', '禁忌'],
    priority: 7,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示文化详情时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出文化条目时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'language-system',
    name: '语言体系',
    icon: 'language',
    description: '语言与文字系统设计。支持自然语言/人造语言/古代语言/密语的创建，包括语系分支、音系、语法、词汇、文字示例。可关联使用者种族、通行区域、语系分支。对应 languages 插件。关键词：语言、文字、语系、音系、语法、词汇、象形文字、符文。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('language-system'),
    version: '1.0.0',
    promptFile: 'language-system/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'relation_list', 'algo_run'],
    examples: ['设计一种古老的符文语言', '构建语系分支树', '为种族创建独特的语言体系'],
    triggers: ['语言', '文字', '语系', '音系', '语法', '词汇', '符文'],
    relatedPlugins: ['languages', 'mindmap'],
    pluginTools: [
      { pluginId: 'languages', tools: ['entity_type'], capabilities: ['语言管理', '语系树'] },
    ],
    tags: ['语言', '文字', '语系', '音系', '语法'],
    priority: 6,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示语言详情时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示语系分支树时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'conflict-history',
    name: '冲突编年',
    icon: 'combat',
    description: '冲突与战争史编撰。支持全面战争/局部冲突/内战/起义等多种冲突类型的创建，记录参战势力、指挥官、战场、关联事件、传奇兵器。可构建子战役层级。对应 conflict 插件。关键词：冲突、战争、战役、内战、起义、侵略、指挥官、伤亡。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('conflict-history'),
    version: '1.0.0',
    promptFile: 'conflict-history/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'relation_list', 'consistency_check'],
    examples: ['编撰一场古代大战', '创建冲突的参战势力关系', '分析战争对世界观的影响'],
    triggers: ['冲突', '战争', '战役', '内战', '起义', '指挥官', '伤亡'],
    relatedPlugins: ['conflict', 'timeline'],
    pluginTools: [
      { pluginId: 'conflict', tools: ['entity_type'], capabilities: ['冲突管理', '参与方查询'] },
    ],
    tags: ['冲突', '战争', '战役', '历史'],
    priority: 7,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示冲突详情时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出冲突列表时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示参战势力关系时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'building-geography',
    name: '建筑地理',
    icon: 'building',
    description: '建筑与地理场所设计。支持 16 种建筑类型（宫殿/城堡/神殿/军事要塞/学院等）、10 种建筑风格、内部布局与连接关系设计。可关联地域、组织、拥有者、常驻者、存放道具、事件发生地。对应 buildings 插件。关键词：建筑、场所、城堡、宫殿、神殿、要塞、学院、布局、通道。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('building-geography'),
    version: '1.0.0',
    promptFile: 'building-geography/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'entity_delete', 'relation_create', 'relation_list', 'algo_run'],
    examples: ['设计一座城堡的内部布局', '创建建筑之间的通道连接', '查找两个建筑之间的最短路径'],
    triggers: ['建筑', '场所', '城堡', '宫殿', '布局', '通道', '地理'],
    relatedPlugins: ['buildings', 'graph'],
    pluginTools: [
      { pluginId: 'buildings', tools: ['entity_type'], capabilities: ['建筑管理', '布局查询'] },
    ],
    tags: ['建筑', '场所', '城堡', '布局', '地理'],
    priority: 7,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示建筑详情时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示建筑连接图时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'item-encyclopedia',
    name: '道具百科',
    icon: 'item',
    description: '道具与物品百科全书。支持 16 种道具类型、5 级稀有度、持有链流转记录、关联道具网络。覆盖武器/防具/法器/药水/神器等。对应 items 插件。关键词：道具、物品、武器、法器、宝物、药水、稀有度、持有链。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('item-encyclopedia'),
    version: '1.0.0',
    promptFile: 'item-encyclopedia/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'relation_list', 'a2ui_show_entity'],
    examples: ['创建一件传说级武器', '追踪道具的历史持有者', '设计道具之间的相生相克关系'],
    triggers: ['道具', '物品', '武器', '法器', '宝物', '药水', '稀有度'],
    relatedPlugins: ['items'],
    pluginTools: [
      { pluginId: 'items', tools: ['entity_type'], capabilities: ['道具管理', '持有链'] },
    ],
    tags: ['道具', '物品', '武器', '法器', '宝物'],
    priority: 8,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示道具详情时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出道具列表时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'lore-concepts',
    name: '设定百科',
    icon: 'concept',
    description: '世界观概念与设定百科。支持 11 种概念类型（规则/魔法/科技/文化/宗教/社会制度等），构建概念引用、矛盾、上下位层级、灵感来源网络。对应 concepts 插件。关键词：概念、设定、百科、规则、魔法体系、社会制度、世界观。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('lore-concepts'),
    version: '1.0.0',
    promptFile: 'lore-concepts/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'entity_delete', 'relation_create', 'relation_list', 'algo_run', 'consistency_check'],
    examples: ['创建魔法体系的核心规则', '构建概念的上下位层级', '检查设定之间的矛盾'],
    triggers: ['概念', '设定', '百科', '规则', '魔法体系', '世界观'],
    relatedPlugins: ['concepts', 'graph'],
    pluginTools: [
      { pluginId: 'concepts', tools: ['entity_type'], capabilities: ['概念管理', '关联网络'] },
    ],
    tags: ['概念', '设定', '百科', '规则'],
    priority: 8,
    outputPreferences: [
      { channel: 'a2ui', component: 'EntityCard', condition: '展示概念详情时' },
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示概念关系网络时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'combat-system',
    name: '战力体系',
    icon: 'combat',
    description: '战力体系设计与数值平衡。支持境界制/等级制/数值制三种体系，设计层级排序、晋升条件、瓶颈、战力表现。可关联角色境界、所需技能、修炼圣地、突破道具。对应 combat_stats 插件。关键词：战力、境界、等级、数值、晋升、突破、修炼。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('combat-system'),
    version: '1.0.0',
    promptFile: 'combat-system/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'relation_list', 'algo_run', 'consistency_check'],
    examples: ['设计修仙境界体系', '比较不同战力层级的数值', '关联角色到对应境界'],
    triggers: ['战力', '境界', '等级', '数值', '晋升', '突破', '修炼'],
    relatedPlugins: ['combat_stats'],
    pluginTools: [
      { pluginId: 'combat_stats', tools: ['entity_type'], capabilities: ['战力管理', '数值对比'] },
    ],
    tags: ['战力', '境界', '等级', '数值'],
    priority: 7,
    outputPreferences: [
      { channel: 'a2ui', component: 'EditableTable', condition: '列出战力层级时' },
      { channel: 'a2ui', component: 'ChartView', condition: '数值对比可视化时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'inspiration-curator',
    name: '灵感素材',
    icon: 'inspiration',
    description: '创作灵感与素材收集管理。支持图片/视频/文章/音乐/概念/角色/场景/对话 9 种素材类型，建立灵感与实体的关联。对应 inspiration 插件。关键词：灵感、素材、参考、图片、收集、创意、moodboard。',
    category: 'domain',
    enabled: true,
    visibility: getSkillVisibility('inspiration-curator'),
    version: '1.0.0',
    promptFile: 'inspiration-curator/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['entity_create', 'entity_update', 'relation_create', 'web_search', 'web_fetch', 'image_generate'],
    examples: ['收集一组中世纪城堡参考图', '创建灵感与角色的关联', '搜索特定风格的素材'],
    triggers: ['灵感', '素材', '参考', '收集', '创意', 'moodboard'],
    relatedPlugins: ['inspiration'],
    pluginTools: [
      { pluginId: 'inspiration', tools: ['entity_type'], capabilities: ['素材管理', '素材搜索'] },
    ],
    tags: ['灵感', '素材', '参考', '收集'],
    priority: 6,
    outputPreferences: [
      { channel: 'a2ui', component: 'EditableTable', condition: '列出素材列表时' },
      { channel: 'a2ui', component: 'output_image', condition: '展示参考图片时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'relation-explorer',
    name: '关系探索',
    icon: 'link',
    description: '跨实体关系深度探索与构建。支持 20+ 种关系类型的创建、查询、路径分析、关系网络可视化。关键词：关系、关联、连接、关系网、关系链、双向链接、关系类型。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('relation-explorer'),
    version: '1.0.0',
    promptFile: 'relation-explorer/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'relation_list'],
    allowedTools: ['relation_create', 'relation_delete', 'algo_run', 'a2ui_show_relation', 'ui_create_surface', 'ui_update_components'],
    examples: ['查找两个角色的所有关系路径', '分析实体的关系网络结构', '批量创建实体之间的关系'],
    triggers: ['关系', '关联', '连接', '关系网', '关系链', '关系类型'],
    relatedPlugins: ['graph'],
    pluginTools: [
      { pluginId: 'graph', tools: ['graph'], capabilities: ['图谱查询', '路径分析', '聚类'] },
    ],
    tags: ['关系', '关联', '图谱', '网络'],
    priority: 9,
    outputPreferences: [
      { channel: 'a2ui', component: 'MermaidRender', condition: '展示关系子图时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '列出关系列表时' },
      { channel: 'plugin', plugin: 'graph', condition: '需要交互式图谱操作时' },
      { channel: 'chat', condition: '简短确认' },
    ],
  },
  {
    id: 'smart-fill',
    name: '智能填充',
    icon: 'magic',
    description: '实体字段智能建议与一键填充。支持字段级接续预览、实体级批量填充、上下文感知生成、对话式协同创作。关键词：填充、建议、补全、自动、续写、ghost text、AI建议、智能。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('smart-fill'),
    version: '1.0.0',
    promptFile: 'smart-fill/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search', 'entity_get_context'],
    allowedTools: ['entity_suggest_field', 'entity_smart_fill', 'entity_get_context', 'relation_list', 'schema_get_entity_type', 'memory_recall', 'a2ui_show_entity', 'ui_create_surface', 'ui_update_components', 'ui_update_data'],
    examples: ['帮我填充这个角色的空字段', '为这个建筑生成描述', '接续预览角色性格描述', '与AI聊聊这段设定'],
    triggers: ['填充', '建议', '补全', '自动', '续写', 'AI建议', '智能'],
    tags: ['填充', '建议', '补全', '续写', '智能'],
    priority: 9,
    outputPreferences: [
      { channel: 'a2ui', component: 'SuggestionPicker', condition: '提供多个建议值让用户选择时' },
      { channel: 'a2ui', component: 'EntityCard', condition: '展示填充结果预览时' },
      { channel: 'a2ui', component: 'Comparison', condition: '左右对比原始 vs 填充后时' },
      { channel: 'chat', condition: '字段建议值直接输出时' },
    ],
  },
  {
    id: 'data-analyst',
    name: '数据分析',
    icon: 'chart',
    description: '项目数据深度分析。实体统计、属性分布、关系密度、一致性审计、趋势分析。生成可视化报告。关键词：统计、分析、分布、趋势、报告、数据、审计、密度。',
    category: 'action',
    enabled: true,
    visibility: getSkillVisibility('data-analyst'),
    version: '1.0.0',
    promptFile: 'data-analyst/SKILL.md',
    baseTools: ['entity_list', 'entity_get', 'content_search'],
    allowedTools: ['relation_list', 'algo_run', 'consistency_check', 'schema_validate', 'ui_create_surface', 'ui_update_components', 'ui_update_data'],
    examples: ['统计各类型实体的分布', '分析关系网络的密度和聚类', '生成世界观完整性审计报告'],
    triggers: ['统计', '分析', '分布', '趋势', '报告', '数据', '审计'],
    relatedPlugins: ['notebook'],
    pluginTools: [
      { pluginId: 'notebook', tools: ['notebook'], capabilities: ['分析报告保存'] },
    ],
    tags: ['统计', '分析', '分布', '报告', '审计'],
    priority: 8,
    outputPreferences: [
      { channel: 'a2ui', component: 'ChartView', condition: '数值分布可视化时' },
      { channel: 'a2ui', component: 'EditableTable', condition: '统计数据汇总时' },
      { channel: 'a2ui', component: 'Comparison', condition: '多维度对比分析时' },
      { channel: 'plugin', plugin: 'notebook', condition: '分析报告需持久保存时' },
    ],
  },
]

/**
 * 返回始终可用工具列表的副本
 *
 * 始终可用工具不依赖于任何技能激活状态，所有技能均可访问这些基础工具。
 * 返回的是数组浅拷贝，避免外部修改影响内部状态。
 */
export function getAlwaysAvailableTools(): string[] {
  return [...ALWAYS_AVAILABLE_TOOLS]
}

export function getEnabledSkills(): SkillMeta[] {
  const disabled = loadDisabledSkills()
  return SKILL_REGISTRY.filter(s => !disabled.includes(s.id))
}

export function getAllSkills(): SkillMeta[] {
  const disabled = loadDisabledSkills()
  return SKILL_REGISTRY.map(s => ({
    ...s,
    enabled: !disabled.includes(s.id),
  }))
}

export function toggleSkill(skillId: string): boolean {
  const disabled = loadDisabledSkills()
  const idx = disabled.indexOf(skillId)
  if (idx >= 0) {
    disabled.splice(idx, 1)
  } else {
    disabled.push(skillId)
  }
  saveDisabledSkills(disabled)
  return idx < 0
}

function loadDisabledSkills(): string[] {
  try {
    const raw = localStorage.getItem('agent_disabled_skills')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveDisabledSkills(ids: string[]): void {
  try {
    localStorage.setItem('agent_disabled_skills', JSON.stringify(ids))
  } catch {}
}

export function findSkillById(id: string): SkillMeta | undefined {
  return SKILL_REGISTRY.find(s => s.id === id)
}

export function findSkillByToolName(toolName: string): SkillMeta | undefined {
  return SKILL_REGISTRY.find(s => s.allowedTools.includes(toolName))
}

export const CAPABILITY_TO_TOOL: Record<string, string> = {
  'ui.output.table': 'output_table',
  'ui.output.choice': 'output_choice',
  'ui.output.code': 'output_code',
  'ui.output.entity-card': 'output_entity_card',
  'ui.output.alert': 'output_alert',
  'ui.output.stat': 'output_stat',
  'ui.output.list': 'output_list',
  'ui.output.progress': 'output_progress',
  'ui.output.comparison': 'output_comparison',
  'ui.output.timeline': 'output_timeline',
  'ui.output.image': 'output_image',
  'ui.output.accordion': 'output_accordion',
}

/**
 * 根据激活的技能 ID 列表合并可用工具集
 *
 * 合并逻辑：
 * 1. 以 ALWAYS_AVAILABLE_TOOLS 为基础工具集
 * 2. 遍历每个激活技能，累加其 baseTools
 * 3. 若技能配置了 capabilities，则通过 CAPABILITY_TO_TOOL
 *    映射表将 internal/cli/mcp 能力转换为对应工具名
 * 4. 否则累加 allowedTools
 * 5. 返回去重后的工具名称数组
 *
 * @param activeSkillIds - 当前激活的技能 ID 数组
 * @returns 合并后的可用工具名称数组
 */
export function resolveToolNames(activeSkillIds: string[]): string[] {
  const tools = new Set(ALWAYS_AVAILABLE_TOOLS)
  for (const id of activeSkillIds) {
    const skill = SKILL_REGISTRY.find(s => s.id === id)
    if (!skill) continue
    for (const t of skill.baseTools) tools.add(t)
    if (skill.capabilities) {
      for (const t of skill.capabilities.internal) tools.add(CAPABILITY_TO_TOOL[t] || t)
      for (const t of skill.capabilities.cli) tools.add(CAPABILITY_TO_TOOL[t] || t)
      for (const t of skill.capabilities.mcp) tools.add(CAPABILITY_TO_TOOL[t] || t)
    } else {
      for (const t of skill.allowedTools) tools.add(t)
    }
  }
  return [...tools]
}

export function getVisibleSkills(developerMode: boolean, advancedMode: boolean): SkillMeta[] {
  const enabled = getEnabledSkills()
  return enabled.filter(s => {
    if (s.visibility === 'hidden') return false
    if (s.visibility === 'always') return true
    if (s.visibility === 'advanced' && (advancedMode || developerMode)) return true
    if (s.visibility === 'developer' && developerMode) return true
    return false
  })
}

/**
 * 生成技能列表的系统提示词
 *
 * 按 category 分组列出当前可见的技能：
 * - domain → 世界观领域
 * - action → 通用操作
 * - persona → 人格/角色
 *
 * 各类别内按 priority 降序排列。若存在因 developer/advanced 模式隐藏的技能，
 * 会在末尾附加隐藏提示信息。
 *
 * @param developerMode - 是否开启开发者模式（显示 developer 级别技能）
 * @param advancedMode - 是否开启高级模式（显示 advanced 级别技能）
 * @returns 格式化的技能索引提示词文本
 */
export function buildSkillIndexPrompt(developerMode = false, advancedMode = false): string {
  const visible = getVisibleSkills(developerMode, advancedMode)
  const domainSkills = visible.filter(s => s.category === 'domain')
  const actionSkills = visible.filter(s => s.category === 'action')
  const personaSkills = visible.filter(s => s.category === 'persona')

  const sections: string[] = [
    '## 可用技能 (Available Skills)',
    '',
    '你可以通过调用 `load_skill` 工具激活技能。当用户任务匹配技能描述时，主动激活对应技能。',
    '激活技能后，你将获得该技能的详细工作流程、质量标准和专业方法论。',
  ]

  if (domainSkills.length > 0) {
    sections.push('', '### 世界观领域', '')
    for (const s of domainSkills.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
      sections.push(`- **${s.id}**: ${s.description}`)
    }
  }

  if (actionSkills.length > 0) {
    sections.push('', '### 通用操作', '')
    for (const s of actionSkills.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
      sections.push(`- **${s.id}**: ${s.description}`)
    }
  }

  if (personaSkills.length > 0) {
    sections.push('', '### 人格 / 角色', '')
    for (const s of personaSkills) {
      sections.push(`- **${s.id}**: ${s.description}`)
    }
  }

  const hiddenCount = getEnabledSkills().length - visible.length
  if (hiddenCount > 0) {
    sections.push('', `> ${hiddenCount} 个开发者/高级工具已隐藏，可在设置中开启。`)
  }

  return sections.join('\n')
}

/**
 * 生成输出通道偏好的提示词
 *
 * 收集所有激活技能的 outputPreferences，按通道（chat/a2ui/plugin/file）
 * 生成带条件的输出偏好指南。若激活技能无输出偏好配置则返回空字符串。
 *
 * @param activeSkillIds - 当前激活的技能 ID 数组
 * @returns 格式化的输出偏好指南文本，无偏好时返回空字符串
 */
export function buildOutputGuidePrompt(activeSkillIds: string[]): string {
  const skills = activeSkillIds
    .map(id => findSkillById(id))
    .filter((s): s is SkillMeta => s != null)

  const prefs = skills.flatMap(s => s.outputPreferences || [])
  if (prefs.length === 0) return ''

  const channelMap: Record<string, string> = {
    chat: '💬 聊天文本',
    a2ui: '🧩 A2UI 组件',
    plugin: '🔌 插件写入',
    file: '📁 文件导出',
  }

  const lines = [
    '## 输出指南 (Output Guide)',
    '',
    '根据当前激活的技能，你的输出应遵循以下偏好：',
    '',
  ]

  for (const pref of prefs) {
    let line = `- ${channelMap[pref.channel] || pref.channel}`
    if (pref.component) line += ` → ${pref.component}`
    if (pref.plugin) line += ` → ${pref.plugin} 插件`
    if (pref.condition) line += `（当${pref.condition}）`
    lines.push(line)
  }

  lines.push('', '当不确定输出形式时，优先使用首选通道。复杂输出可组合多个通道。')
  return lines.join('\n')
}

/**
 * 校验技能注册表一致性
 *
 * 检查项包括：
 * - 必填字段是否缺失（基于 SKILL_META_REQUIRED_FIELDS）
 * - version 字段是否符合 semver 格式
 * - visibility 字段是否存在
 * - visibility 值与 getSkillVisibility() 的一致性
 * - persona 类别技能必须使用 always 可见性
 * - 是否存在重复的技能 ID
 *
 * @returns 警告信息数组，无问题返回空数组
 */
export function validateRegistryConsistency(): string[] {
  const warnings: string[] = []

  for (const skill of SKILL_REGISTRY) {
    const missingFields = SKILL_META_REQUIRED_FIELDS.filter(f => {
      const v = skill[f]
      if (typeof v === 'string') return !v
      if (Array.isArray(v)) return false
      return v === undefined || v === null
    })
    if (missingFields.length > 0) {
      warnings.push(`[${skill.id}] Missing required fields: ${missingFields.join(', ')}`)
    }

    if (!skill.version) {
      warnings.push(`[${skill.id}] Missing version field`)
    } else if (!/^\d+\.\d+\.\d+/.test(skill.version)) {
      warnings.push(`[${skill.id}] Invalid version format: "${skill.version}", expected semver`)
    }

    if (!skill.visibility) {
      warnings.push(`[${skill.id}] Missing visibility field`)
    }

    const expectedVisibility = getSkillVisibility(skill.id)
    if (skill.visibility && skill.visibility !== expectedVisibility) {
      warnings.push(`[${skill.id}] Visibility mismatch: registry has "${skill.visibility}", expected "${expectedVisibility}"`)
    }

    if (skill.category === 'persona' && skill.visibility !== 'always') {
      warnings.push(`[${skill.id}] Persona skills should always have visibility: "always"`)
    }
  }

  const ids = SKILL_REGISTRY.map(s => s.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length > 0) {
    warnings.push(`Duplicate skill IDs: ${[...new Set(dupes)].join(', ')}`)
  }

  return warnings
}

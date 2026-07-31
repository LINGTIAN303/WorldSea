/**
 * 插件能力桥接模块
 *
 * 连接 Skill 系统与插件系统，提供：
 * - 插件能力注册与查询
 * - 根据激活的 Skill ID 解析关联的插件工具
 * - 构建注入提示词的插件能力描述
 *
 * 预定义的内置插件能力列表 (WORLD_SMITH_PLUGIN_CAPABILITIES) 在模块加载时自动注册。
 */

import { findSkillById } from './registry'

/** 插件能力的单条声明 */
export interface PluginCapabilityDeclaration {
  action: string
  description: string
  params?: string[]
}

/** 插件的完整能力描述 */
export interface PluginCapability {
  pluginId: string
  pluginName: string
  entityTypes: string[]
  agentSkills: string[]
  capabilities: PluginCapabilityDeclaration[]
}

/** 插件能力注册中心（内存级） */
const capabilityRegistry = new Map<string, PluginCapability>()

/** 注册一个插件的能力信息 */
export function registerPluginCapability(cap: PluginCapability): void {
  capabilityRegistry.set(cap.pluginId, cap)
}

/** 根据插件 ID 查询其能力信息 */
export function getPluginCapability(pluginId: string): PluginCapability | undefined {
  return capabilityRegistry.get(pluginId)
}

/** 获取所有已注册的插件能力 */
export function getAllPluginCapabilities(): PluginCapability[] {
  return Array.from(capabilityRegistry.values())
}

/**
 * 根据激活的 Skill ID 列表，解析出关联的插件能力
 * 遍历每个 Skill 的 relatedPlugins 字段，去重合并
 */
export function resolveRelatedPlugins(skillIds: string[]): PluginCapability[] {
  const plugins = new Map<string, PluginCapability>()
  for (const id of skillIds) {
    const skill = findSkillById(id)
    if (!skill?.relatedPlugins) continue
    for (const pluginId of skill.relatedPlugins) {
      const cap = capabilityRegistry.get(pluginId)
      if (cap) plugins.set(pluginId, cap)
    }
  }
  return Array.from(plugins.values())
}

/**
 * 根据激活的 Skill ID 列表，解析出所有关联的插件专属工具名称
 * 从 Skill 的 pluginTools 绑定中提取
 */
export function resolvePluginToolNames(skillIds: string[]): string[] {
  const tools = new Set<string>()
  for (const id of skillIds) {
    const skill = findSkillById(id)
    if (!skill?.pluginTools) continue
    for (const binding of skill.pluginTools) {
      for (const tool of binding.tools) {
        tools.add(tool)
      }
    }
  }
  return Array.from(tools)
}

/**
 * 构建注入系统提示词的插件能力描述
 * 列出当前激活技能关联的所有插件及其能力，供 LLM 参考
 */
export function buildPluginCapabilityPrompt(skillIds: string[]): string {
  const plugins = resolveRelatedPlugins(skillIds)
  if (plugins.length === 0) return ''

  const lines = [
    '## 插件能力 (Plugin Capabilities)',
    '',
    '以下插件已绑定到当前激活的技能，你可以通过对应工具操作它们：',
    '',
  ]

  for (const p of plugins) {
    lines.push(`### ${p.pluginName} (\`${p.pluginId}\`)`)
    if (p.capabilities.length > 0) {
      for (const cap of p.capabilities) {
        const params = cap.params ? `(${cap.params.join(', ')})` : ''
        // 将 xxx_action_name 格式转为 domain(action='action_name') 调用格式
        const domain = p.pluginId.replace(/-/g, '_')
        const actionName = cap.action.includes('_') ? cap.action.substring(cap.action.indexOf('_') + 1) : cap.action
        const callFormat = `${domain}(action='${actionName}')`
        lines.push(`- **${callFormat}**${params}: ${cap.description}`)
      }
    }
    if (p.entityTypes.length > 0) {
      lines.push(`- 管理实体类型: ${p.entityTypes.join(', ')}`)
    }
    lines.push('')
  }

  lines.push('使用域级工具（如 `timeline(action="create_event")`）可向这些插件发送操作指令。')
  return lines.join('\n')
}

/**
 * 内置插件能力列表
 * 定义所有 WorldSmith 官方插件的 Agent 可操作能力
 */
export const WORLD_SMITH_PLUGIN_CAPABILITIES: PluginCapability[] = [
  {
    pluginId: 'timeline',
    pluginName: '时间线',
    entityTypes: ['timeline_event'],
    agentSkills: ['timeline-architect', 'worldbuilding', 'roleplay'],
    capabilities: [
      { action: 'timeline_create_event', description: '创建时间线事件（支持设置日期范围、年代、重要性、状态、地点、父级事件、标签）', params: ['name', 'date', 'dateEnd', 'description', 'era', 'importance', 'status', 'location', 'parentId', 'tags'] },
      { action: 'timeline_update_event', description: '更新事件属性（名称、日期、描述、年代、重要性、状态、地点等）', params: ['eventId', 'changes'] },
      { action: 'timeline_sort_events', description: '按时间排序事件（chronological 正序 / reverse 倒序）', params: ['method'] },
      { action: 'timeline_detect_conflicts', description: '检测时间线中的时间冲突（可配置阈值天数）', params: ['threshold'] },
      { action: 'timeline_get_events', description: '获取时间线事件列表（支持按年代、关键词、重要性过滤，可设上限）', params: ['era', 'keyword', 'importance', 'limit'] },
      { action: 'timeline_export_timeline', description: '导出时间线数据（json / csv / mermaid 格式）', params: ['format'] },
      { action: 'timeline_set_layout_mode', description: '切换时间线布局模式（水平甘特图 / 垂直树形）', params: ['mode'] },
      { action: 'timeline_set_group_mode', description: '设置泳道分组模式（按角色/地点/纪元/标签）', params: ['groupBy'] },
      { action: 'timeline_zoom', description: '缩放时间线视图', params: ['level'] },
      { action: 'timeline_toggle_collapse', description: '折叠/展开事件节点', params: ['eventId', 'collapsed'] },
    ],
  },
  {
    pluginId: 'graph',
    pluginName: '关系图谱',
    entityTypes: ['entity', 'relation'],
    agentSkills: ['graph-explorer', 'worldbuilding', 'analysis-engine', 'deep-thinking'],
    capabilities: [
      { action: 'graph_get_nodes', description: '获取图谱节点列表（按实体类型过滤、关键词搜索）', params: ['type', 'keyword'] },
      { action: 'graph_get_edges', description: '获取图谱边列表（按源/目标节点、关系类型过滤）', params: ['sourceId', 'targetId', 'type'] },
      { action: 'graph_find_path', description: '查找两节点间最短路径（揭示隐含关系链）', params: ['sourceId', 'targetId'] },
      { action: 'graph_cluster_analysis', description: '聚类分析（louvain社区发现 / label_propagation标签传播 / k_means聚类）', params: ['method'] },
      { action: 'graph_highlight_nodes', description: '高亮指定节点（用于可视化聚焦）', params: ['nodeIds'] },
      { action: 'graph_export_snapshot', description: '导出图谱快照（png / svg / json 格式）', params: ['format'] },
      { action: 'graph_filter_by_type', description: '按实体类型过滤图谱显示', params: ['types'] },
      { action: 'graph_search_subgraph', description: '搜索以某节点为中心的子图', params: ['centerId', 'depth'] },
    ],
  },
  {
    pluginId: 'mindmap',
    pluginName: '思维导图',
    entityTypes: ['mindmap_node'],
    agentSkills: ['mindmap-builder', 'worldbuilding', 'content-craft'],
    capabilities: [
      { action: 'mindmap_create_node', description: '创建节点（支持父节点、标签文本、样式配置）', params: ['parentId', 'label', 'style'] },
      { action: 'mindmap_update_node', description: '更新节点（修改标签、样式、折叠状态）', params: ['nodeId', 'changes'] },
      { action: 'mindmap_delete_node', description: '删除节点（含子节点级联删除）', params: ['nodeId'] },
      { action: 'mindmap_get_structure', description: '获取整棵树结构（含所有节点层级与样式）' },
      { action: 'mindmap_auto_layout', description: '自动布局（tree树形 / radial径向 / fishbone鱼骨图）', params: ['algorithm'] },
      { action: 'mindmap_export_image', description: '导出为图片（png / svg 格式）', params: ['format'] },
      { action: 'mindmap_batch_create', description: '批量创建节点（从结构化数据快速构建导图）', params: ['structure'] },
      { action: 'mindmap_search_node', description: '按关键词搜索节点', params: ['keyword'] },
    ],
  },
  {
    pluginId: 'manuscript',
    pluginName: '正文编辑器',
    entityTypes: ['manuscript_chapter'],
    agentSkills: ['manuscript-author', 'content-craft', 'roleplay', 'persona-possess'],
    capabilities: [
      { action: 'manuscript_create_chapter', description: '创建章节（含标题、初始内容、所属卷、草稿状态）', params: ['title', 'content', 'volumeName', 'status'] },
      { action: 'manuscript_update_chapter', description: '更新章节内容或状态（draft/writing/review/done）', params: ['chapterId', 'content', 'status'] },
      { action: 'manuscript_list_chapters', description: '列出所有章节（可按卷名过滤）', params: ['volumeName'] },
      { action: 'manuscript_get_chapter_content', description: '获取章节完整内容（含富文本与实体引用）', params: ['chapterId'] },
      { action: 'manuscript_insert_mention', description: '在章节中插入实体引用（@提及，支持位置偏移）', params: ['chapterId', 'entityId', 'position'] },
      { action: 'manuscript_export_document', description: '导出文档（html / pdf / markdown / docx 格式，可选章节范围）', params: ['format', 'chapters'] },
      { action: 'manuscript_reorder_chapters', description: '调整章节顺序', params: ['chapterIds'] },
      { action: 'manuscript_split_chapter', description: '拆分章节为多个子章节', params: ['chapterId', 'splitPoints'] },
    ],
  },
  {
    pluginId: 'outline',
    pluginName: '大纲编辑器',
    entityTypes: ['outline_node'],
    agentSkills: ['outline-architect', 'content-craft', 'roleplay'],
    capabilities: [
      { action: 'outline_create_node', description: '创建大纲节点（act幕 / sequence序列 / scene场景 / beat节拍）', params: ['title', 'parentId', 'type'] },
      { action: 'outline_update_node', description: '更新节点（标题、类型、描述、状态）', params: ['nodeId', 'changes'] },
      { action: 'outline_move_node', description: '移动节点到新父节点下指定位置', params: ['nodeId', 'newParentId', 'position'] },
      { action: 'outline_get_structure', description: '获取大纲完整树结构（含所有层级与关联实体）' },
      { action: 'outline_link_entity', description: '关联实体到大纲节点（角色/地点/事件等）', params: ['nodeId', 'entityId'] },
      { action: 'outline_export_outline', description: '导出大纲（text / json / markdown 格式）', params: ['format'] },
      { action: 'outline_delete_node', description: '删除大纲节点（含子节点级联删除）', params: ['nodeId'] },
      { action: 'outline_batch_create', description: '批量创建大纲节点（从结构化模板快速搭建）', params: ['structure'] },
    ],
  },
  {
    pluginId: 'notebook',
    pluginName: '笔记本',
    entityTypes: ['notebook_note'],
    agentSkills: ['notebook-curator', 'web-scout', 'analysis-engine', 'output-orchestrator'],
    capabilities: [
      { action: 'notebook_create_note', description: '创建笔记（Markdown 格式，支持 log/research/diagnosis/code 类型，可指定文件夹与标签）', params: ['content', 'noteType', 'folderId', 'tags'] },
      { action: 'notebook_update_note', description: '更新笔记内容与标签', params: ['noteId', 'content', 'tags'] },
      { action: 'notebook_list_notes', description: '列出笔记（按文件夹过滤、关键词搜索）', params: ['folderId', 'keyword'] },
      { action: 'notebook_execute_code', description: '在笔记中执行代码单元格（支持 Python/JS）', params: ['noteId', 'code'] },
      { action: 'notebook_create_backlink', description: '创建笔记间双向链接（构建知识网络）', params: ['sourceId', 'targetId'] },
      { action: 'notebook_export_note', description: '导出笔记（markdown / html / pdf 格式）', params: ['noteId', 'format'] },
      { action: 'notebook_search_notes', description: '全文搜索笔记内容', params: ['query', 'noteType'] },
      { action: 'notebook_delete_note', description: '删除笔记', params: ['noteId'] },
    ],
  },
  {
    pluginId: 'tactical-board',
    pluginName: '战术面板',
    entityTypes: ['tactical_unit', 'tactical_deployment'],
    agentSkills: ['tactical-planner', 'roleplay'],
    capabilities: [
      { action: 'tactical_deploy_unit', description: '部署单位到指定坐标与阵型', params: ['unitId', 'position', 'formation'] },
      { action: 'tactical_move_unit', description: '移动战斗单位到新坐标', params: ['unitId', 'newPosition'] },
      { action: 'tactical_get_battle_state', description: '获取当前战场状态（全部单位、部署、地形）' },
      { action: 'tactical_simulate_turn', description: '模拟一回合战斗（含攻击/移动/技能/防御行动）', params: ['actions'] },
      { action: 'tactical_export_battle_log', description: '导出战斗日志（json / markdown / html 格式）', params: ['format'] },
      { action: 'tactical_undo_move', description: '撤销上一步移动', params: ['unitId'] },
      { action: 'tactical_get_unit_stats', description: '获取单位详细属性（HP/MP/攻防速/技能列表）', params: ['unitId'] },
      { action: 'tactical_set_terrain', description: '设置战场地形', params: ['terrainData'] },
    ],
  },
  {
    pluginId: 'magic',
    pluginName: '魔法技能树',
    entityTypes: ['magic_skill'],
    agentSkills: ['magic-system-designer', 'content-craft'],
    capabilities: [
      { action: 'magic_create_skill_node', description: '创建技能节点（名称、父节点、技能点花费、描述、效果配置）', params: ['name', 'parentId', 'cost', 'description', 'effects'] },
      { action: 'magic_update_skill_node', description: '更新技能节点（名称、花费、描述、效果）', params: ['nodeId', 'changes'] },
      { action: 'magic_get_skill_tree', description: '获取完整技能树结构（含所有节点层级与效果）' },
      { action: 'magic_validate_tree', description: '验证技能树平衡性（检查花费/效果/依赖合理性）' },
      { action: 'magic_export_skill_tree', description: '导出技能树（json / png / svg 格式）', params: ['format'] },
      { action: 'magic_delete_skill_node', description: '删除技能节点（含子节点级联删除）', params: ['nodeId'] },
      { action: 'magic_check_dependencies', description: '检查技能前置依赖是否满足', params: ['nodeId'] },
    ],
  },
  {
    pluginId: 'module-builder',
    pluginName: '模块构建器',
    entityTypes: ['custom_module'],
    agentSkills: ['module-builder', 'retrofit-architect'],
    capabilities: [
      { action: 'module_builder_add_component', description: '向模块添加UI组件（表格/图表/表单/列表/卡片等）', params: ['moduleId', 'componentType', 'config'] },
      { action: 'module_builder_remove_component', description: '从模块移除组件', params: ['moduleId', 'componentId'] },
      { action: 'module_builder_update_config', description: '更新组件配置（样式/数据源/交互行为）', params: ['moduleId', 'componentId', 'config'] },
      { action: 'module_builder_suggest_layout', description: '根据用途建议布局方案（仪表盘/编辑器/管理器/分析面板）', params: ['moduleId', 'purpose'] },
      { action: 'module_builder_create_module', description: '创建新的自定义模块', params: ['name', 'description', 'layout'] },
      { action: 'module_builder_delete_module', description: '删除模块', params: ['moduleId'] },
      { action: 'module_builder_list_modules', description: '列出所有自定义模块', params: [] },
      { action: 'module_builder_reorder_components', description: '重新排列组件顺序', params: ['moduleId', 'componentIds'] },
    ],
  },
  {
    pluginId: 'characters',
    pluginName: '人物志',
    entityTypes: ['character'],
    agentSkills: ['character-profile', 'content-craft', 'roleplay', 'worldbuilding'],
    capabilities: [
      { action: 'character_list', description: '列出所有角色（支持按角色类型/势力/种族过滤）', params: ['role', 'affiliation', 'race'] },
      { action: 'character_get_detail', description: '获取角色完整信息（属性/关系/故事线）', params: ['characterId'] },
      { action: 'character_create', description: '创建角色（名称/年龄/性别/种族/职业/势力/角色定位/外貌/性格/背景）', params: ['name', 'description', 'age', 'gender', 'race', 'occupation', 'affiliation', 'role'] },
      { action: 'character_update', description: '更新角色属性', params: ['characterId', 'changes'] },
      { action: 'character_get_relations', description: '获取角色的所有关系（认识/盟友/敌对/师徒/配偶/亲属/属于等12种关系）', params: ['characterId', 'relationType'] },
      { action: 'character_search', description: '按名称/职业/势力/标签搜索角色', params: ['keyword'] },
    ],
  },
  {
    pluginId: 'culture',
    pluginName: '文化/习俗',
    entityTypes: ['culture'],
    agentSkills: ['culture-customs', 'worldbuilding'],
    capabilities: [
      { action: 'culture_list', description: '列出文化条目（按类型过滤：节日/仪式/禁忌/婚丧/饮食/服饰/艺术/建筑）', params: ['cultureType'] },
      { action: 'culture_create', description: '创建文化条目（名称/类型/周期/起源/参与者/意义/做法）', params: ['name', 'cultureType', 'cycle', 'origin', 'participants', 'significance'] },
      { action: 'culture_update', description: '更新文化条目属性', params: ['cultureId', 'changes'] },
      { action: 'culture_get_detail', description: '获取文化条目详情', params: ['cultureId'] },
    ],
  },
  {
    pluginId: 'languages',
    pluginName: '语言/文字',
    entityTypes: ['language'],
    agentSkills: ['language-system', 'worldbuilding'],
    capabilities: [
      { action: 'language_list', description: '列出语言（按语言类型/使用范围/成熟度过滤）', params: ['langType', 'scope', 'maturity'] },
      { action: 'language_create', description: '创建语言（名称/类型/文字类型/语系/范围/成熟度/音系/语法/词汇）', params: ['name', 'langType', 'scriptType', 'languageFamily', 'scope'] },
      { action: 'language_update', description: '更新语言属性', params: ['languageId', 'changes'] },
      { action: 'language_get_family_tree', description: '获取语系分支结构', params: ['languageId'] },
    ],
  },
  {
    pluginId: 'conflict',
    pluginName: '冲突/战争',
    entityTypes: ['conflict'],
    agentSkills: ['conflict-history', 'worldbuilding', 'roleplay'],
    capabilities: [
      { action: 'conflict_list', description: '列出冲突（按类型/规模过滤：全面战争/局部冲突/内战/起义等）', params: ['conflictType', 'scale'] },
      { action: 'conflict_create', description: '创建冲突（名称/类型/规模/起止时间/起因/结果/伤亡/和约）', params: ['name', 'conflictType', 'scale', 'startDate', 'endDate', 'cause', 'result'] },
      { action: 'conflict_update', description: '更新冲突属性', params: ['conflictId', 'changes'] },
      { action: 'conflict_get_participants', description: '获取冲突参与方（参战势力/指挥官/战场/关联事件/传奇兵器）', params: ['conflictId'] },
    ],
  },
  {
    pluginId: 'buildings',
    pluginName: '建筑/地点细节',
    entityTypes: ['building'],
    agentSkills: ['building-geography', 'worldbuilding'],
    capabilities: [
      { action: 'building_list', description: '列出建筑（按类型/风格/现状过滤）', params: ['buildingType', 'style', 'status'] },
      { action: 'building_create', description: '创建建筑（名称/类型/层数/面积/风格/年代/建造者/现状/建材/意义）', params: ['name', 'buildingType', 'style', 'era', 'builder', 'status'] },
      { action: 'building_update', description: '更新建筑属性', params: ['buildingId', 'changes'] },
      { action: 'building_get_layout', description: '获取建筑内部布局与连接关系（通道/包含/存放道具）', params: ['buildingId'] },
    ],
  },
  {
    pluginId: 'items',
    pluginName: '道具总类',
    entityTypes: ['item'],
    agentSkills: ['item-encyclopedia', 'content-craft'],
    capabilities: [
      { action: 'item_list', description: '列出道具（按类型/稀有度/状况过滤）', params: ['itemType', 'rarity', 'condition'] },
      { action: 'item_create', description: '创建道具（名称/类型/材质/来源/制作者/能力/稀有度/状况/意义）', params: ['name', 'itemType', 'material', 'origin', 'rarity'] },
      { action: 'item_update', description: '更新道具属性', params: ['itemId', 'changes'] },
      { action: 'item_get_chain', description: '获取道具持有链（历史持有者/流转记录）', params: ['itemId'] },
    ],
  },
  {
    pluginId: 'concepts',
    pluginName: '概念/设定库',
    entityTypes: ['concept'],
    agentSkills: ['lore-concepts', 'worldbuilding'],
    capabilities: [
      { action: 'concept_list', description: '列出概念（按类型过滤：概念/规则/魔法/科技/文化/历史/宗教/社会制度）', params: ['conceptType'] },
      { action: 'concept_create', description: '创建概念（名称/类型/定义/别名/描述）', params: ['name', 'conceptType', 'definition', 'aliases'] },
      { action: 'concept_update', description: '更新概念属性', params: ['conceptId', 'changes'] },
      { action: 'concept_get_network', description: '获取概念关联网络（引用/矛盾/上下位/灵感来源）', params: ['conceptId'] },
    ],
  },
  {
    pluginId: 'combat_stats',
    pluginName: '战力',
    entityTypes: ['combat_stat'],
    agentSkills: ['combat-system', 'analysis-engine'],
    capabilities: [
      { action: 'combat_stat_list', description: '列出战力条目（按体系/文化圈过滤）', params: ['system', 'culture'] },
      { action: 'combat_stat_create', description: '创建战力体系（名称/体系/层级/境界/晋升条件/瓶颈/战力表现）', params: ['name', 'system', 'tier', 'realm', 'promotion'] },
      { action: 'combat_stat_update', description: '更新战力属性', params: ['statId', 'changes'] },
      { action: 'combat_stat_compare', description: '比较多个战力条目', params: ['statIds'] },
    ],
  },
  {
    pluginId: 'apparel',
    pluginName: '服饰/装备',
    entityTypes: ['apparel'],
    agentSkills: ['content-craft'],
    capabilities: [
      { action: 'apparel_list', description: '列出服饰（按类型/护甲等级/风格过滤）', params: ['apparelType', 'armorClass', 'style'] },
      { action: 'apparel_create', description: '创建服饰（名称/类型/护甲/材质/颜色/风格/防御/重量/耐久/产地/意义）', params: ['name', 'apparelType', 'material', 'style', 'defense'] },
      { action: 'apparel_update', description: '更新服饰属性', params: ['apparelId', 'changes'] },
    ],
  },
  {
    pluginId: 'inspiration',
    pluginName: '灵感/素材库',
    entityTypes: ['inspiration'],
    agentSkills: ['inspiration-curator', 'content-craft'],
    capabilities: [
      { action: 'inspiration_list', description: '列出素材（按类型过滤：图片/视频/文章/音乐/概念/角色/场景/对话）', params: ['materialType'] },
      { action: 'inspiration_create', description: '创建素材（名称/类型/来源/URL/创作笔记/主色调）', params: ['name', 'materialType', 'source', 'url', 'notes'] },
      { action: 'inspiration_update', description: '更新素材', params: ['inspirationId', 'changes'] },
      { action: 'inspiration_search', description: '搜索素材', params: ['keyword'] },
    ],
  },
]

// 模块加载时自动将所有内置插件能力注册到注册中心
WORLD_SMITH_PLUGIN_CAPABILITIES.forEach(cap => registerPluginCapability(cap))

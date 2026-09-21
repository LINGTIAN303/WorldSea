// 技能元数据（其他类），来源 registry.ts SKILL_REGISTRY 拆分，见 docs/details/注释/packages/agent-runtime/skills-registry.md
import type { SkillMeta } from '../registry'
import { getSkillVisibility } from './visibility'

export const OTHER_SKILLS: SkillMeta[] = [
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
  // 2026-09-18 S4 存量处置：smart-fill 技能已退役——
  // 前端智能填充对话（useSmartFillChat）改按工具名直取，其能力由
  // entity_suggest_field / entity_smart_fill / entity_get_context 等工具承载。
  //
  // 2026-09-18 S5 收口：relation-explorer 与 data-analyst 亦已退役——
  // S5 归属核验发现二者不在任何芽的 agentSkills 声明中（属遗漏的独立技能）；
  // 能力主体（entity_* / content_search / consistency_check）已可达，
  // 关系视角与数据分析约定见 WORLDSEA.md。
]

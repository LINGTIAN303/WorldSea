/** 全局关系定义 v1.0（从 20 个芽提取/去重/合并，按领域分组注册），详细见 docs/details/注释/packages/entity-core/relations/index.md */

import { defineRelation } from '../core/RelationshipRegistry'

/** options 字符串数组转契约 {value,label} 对象数组 */
const opt = (label: string) => ({ value: label, label })

// ─────────────────────────────────────────────
// 1. 人物关系域（Person Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'knows', label: '认识', inverseType: 'knows', inverseLabel: '认识',
  sourceTypes: ['character'], targetTypes: ['character'], symmetric: true, domain: 'person',
})

defineRelation({
  type: 'parent_of', label: '父母', inverseType: 'child_of', inverseLabel: '子女',
  sourceTypes: ['character'], targetTypes: ['character'], symmetric: false, domain: 'person',
})

defineRelation({
  type: 'ally_of', label: '盟友', inverseType: 'ally_of', inverseLabel: '盟友',
  sourceTypes: ['character'], targetTypes: ['character'], symmetric: true, domain: 'person',
})

defineRelation({
  type: 'rival_of', label: '对手', inverseType: 'rival_of', inverseLabel: '对手',
  sourceTypes: ['character'], targetTypes: ['character'], symmetric: true, domain: 'person',
})

defineRelation({
  type: 'spouse_of', label: '配偶', inverseType: 'spouse_of', inverseLabel: '配偶',
  sourceTypes: ['character'], targetTypes: ['character'], symmetric: true, domain: 'person',
})

defineRelation({
  type: 'sibling_of', label: '兄弟姐妹', inverseType: 'sibling_of', inverseLabel: '兄弟姐妹',
  sourceTypes: ['character'], targetTypes: ['character'], symmetric: true, domain: 'person',
})

defineRelation({
  type: 'mentor_of', label: '导师', inverseType: 'student_of', inverseLabel: '学生',
  sourceTypes: ['character'], targetTypes: ['character'], symmetric: false, domain: 'person',
})

defineRelation({
  type: 'belongs_to', label: '属于', inverseType: 'has_member', inverseLabel: '拥有成员',
  sourceTypes: ['character'], targetTypes: ['species', 'organization'], symmetric: false, domain: 'person',
})

defineRelation({
  type: 'resides_in', label: '居住于', inverseType: 'resident_of_place', inverseLabel: '居民',
  sourceTypes: ['character'], targetTypes: ['region'], symmetric: false, domain: 'person',
})

defineRelation({
  type: 'participated_in', label: '参与', inverseType: 'has_participant', inverseLabel: '参与者',
  sourceTypes: ['character'], targetTypes: ['event'], symmetric: false, domain: 'person',
})

defineRelation({
  type: 'associated_with', label: '关联', inverseType: 'associated_with', inverseLabel: '关联',
  sourceTypes: ['character'], targetTypes: ['concept'], symmetric: true, domain: 'person',
})

defineRelation({
  type: 'born_in', label: '诞生于', inverseType: 'birth_of', inverseLabel: '诞生事件',
  sourceTypes: ['character', 'species'], targetTypes: ['event'], symmetric: false, domain: 'person',
})

defineRelation({
  type: 'died_in', label: '消亡于', inverseType: 'death_of', inverseLabel: '消亡事件',
  sourceTypes: ['character', 'species'], targetTypes: ['event'], symmetric: false, domain: 'person',
})

// ─────────────────────────────────────────────
// 2. 组织关系域（Organization Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'member_of', label: '成员', inverseType: 'has_member', inverseLabel: '拥有成员',
  sourceTypes: ['character', 'species'], targetTypes: ['organization'], symmetric: false, domain: 'organization',
  properties: [
    { key: 'role', label: '角色', fieldType: 'select', options: ['首领', '核心成员', '普通成员', '荣誉成员', '叛逃者'].map(opt) },
    { key: 'since', label: '加入时间', fieldType: 'text' },
  ],
})

defineRelation({
  type: 'sub_organization', label: '下属势力', inverseType: 'parent_organization', inverseLabel: '上级势力',
  sourceTypes: ['organization'], targetTypes: ['organization'], symmetric: false, domain: 'organization',
})

defineRelation({
  type: 'allied_with', label: '盟友', inverseType: 'allied_with', inverseLabel: '盟友',
  sourceTypes: ['organization'], targetTypes: ['organization'], symmetric: true, domain: 'organization',
})

defineRelation({
  type: 'at_war_with', label: '交战', inverseType: 'at_war_with', inverseLabel: '交战',
  sourceTypes: ['organization'], targetTypes: ['organization'], symmetric: true, domain: 'organization',
})

defineRelation({
  type: 'hostile_to', label: '敌对', inverseType: 'hostile_to', inverseLabel: '敌对',
  sourceTypes: ['organization'], targetTypes: ['organization'], symmetric: true, domain: 'organization',
})

defineRelation({
  type: 'trade_with', label: '贸易', inverseType: 'trade_with', inverseLabel: '贸易',
  sourceTypes: ['organization'], targetTypes: ['organization'], symmetric: true, domain: 'organization',
})

defineRelation({
  type: 'controls', label: '控制', inverseType: 'controlled_by', inverseLabel: '被控制',
  sourceTypes: ['organization'], targetTypes: ['region'], symmetric: false, domain: 'organization',
})

defineRelation({
  type: 'involved_in', label: '参与', inverseType: 'has_org_participant', inverseLabel: '参与组织',
  sourceTypes: ['organization'], targetTypes: ['event'], symmetric: false, domain: 'organization',
})

// ─────────────────────────────────────────────
// 3. 地理关系域（Geography Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'located_in', label: '位于', inverseType: 'contains_location', inverseLabel: '包含地点',
  sourceTypes: ['region', 'building'], targetTypes: ['region'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'borders', label: '接壤', inverseType: 'borders', inverseLabel: '接壤',
  sourceTypes: ['region'], targetTypes: ['region'], symmetric: true, domain: 'geography',
})

defineRelation({
  type: 'route', label: '路线', inverseType: 'reverse_route', inverseLabel: '返程路线',
  sourceTypes: ['region'], targetTypes: ['region'], symmetric: false, domain: 'geography',
  properties: [
    { key: 'distance', label: '距离', fieldType: 'text' },
    { key: 'travelTime', label: '旅行时间', fieldType: 'text' },
    { key: 'dangerLevel', label: '危险等级', fieldType: 'select', options: ['安全', '低危', '中危', '高危', '致命'].map(opt) },
    { key: 'transport', label: '交通方式', fieldType: 'select', options: ['步行', '骑乘', '马车', '船只', '飞行', '传送'].map(opt) },
  ],
})

defineRelation({
  type: 'enclave_of', label: '飞地', inverseType: 'has_enclave', inverseLabel: '拥有飞地',
  sourceTypes: ['region'], targetTypes: ['region'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'capital_of', label: '首府', inverseType: 'has_capital', inverseLabel: '首府为',
  sourceTypes: ['region'], targetTypes: ['organization'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'notable_for', label: '著名事物', inverseType: 'notable_in', inverseLabel: '著名于',
  sourceTypes: ['region'], targetTypes: ['item', 'concept'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'connected_to', label: '连接', inverseType: 'connected_to', inverseLabel: '连接',
  sourceTypes: ['building'], targetTypes: ['building'], symmetric: true, domain: 'geography',
})

defineRelation({
  type: 'has_subregion', label: '包含子区域', inverseType: 'subregion_of', inverseLabel: '子区域',
  sourceTypes: ['region'], targetTypes: ['region'], symmetric: false, domain: 'geography',
})

// ─────────────────────────────────────────────
// 4. 所有权关系域（Ownership Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'owns', label: '拥有', inverseType: 'owned_by', inverseLabel: '被拥有',
  sourceTypes: ['character'], targetTypes: ['item'], symmetric: false, domain: 'ownership',
})

defineRelation({
  type: 'owned_by', label: '拥有者', inverseType: 'owns', inverseLabel: '拥有',
  sourceTypes: ['item', 'building'], targetTypes: ['character', 'organization'], symmetric: false, domain: 'ownership',
})

defineRelation({
  type: 'possessed_by', label: '持有者', inverseType: 'possesses', inverseLabel: '持有',
  sourceTypes: ['item'], targetTypes: ['character'], symmetric: false, domain: 'ownership',
  properties: [
    { key: 'since', label: '获得时间', fieldType: 'text' },
    { key: 'until', label: '失去时间', fieldType: 'text' },
    { key: 'circumstance', label: '获得方式', fieldType: 'text' },
  ],
})

defineRelation({
  type: 'current_holder', label: '当前持有者', inverseType: 'currently_holds', inverseLabel: '当前持有',
  sourceTypes: ['item'], targetTypes: ['character'], symmetric: false, domain: 'ownership',
})

defineRelation({
  type: 'past_holders', label: '历代持有者', inverseType: 'historically_held', inverseLabel: '曾持有',
  sourceTypes: ['item'], targetTypes: ['character'], symmetric: false, domain: 'ownership',
  properties: [{ key: 'period', label: '持有时期', fieldType: 'text' }],
})

defineRelation({
  type: 'kept_at', label: '存放地', inverseType: 'stores', inverseLabel: '存放',
  sourceTypes: ['item'], targetTypes: ['building', 'region'], symmetric: false, domain: 'ownership',
})

defineRelation({
  type: 'located_at', label: '位于', inverseType: 'location_of', inverseLabel: '所在地',
  sourceTypes: ['item'], targetTypes: ['region', 'building'], symmetric: false, domain: 'ownership',
})

defineRelation({
  type: 'worn_by', label: '穿着者', inverseType: 'wears', inverseLabel: '穿着',
  sourceTypes: ['item'], targetTypes: ['character'], symmetric: false, domain: 'ownership',
})

defineRelation({
  type: 'resident', label: '居住者', inverseType: 'resides_in_building', inverseLabel: '居住于',
  sourceTypes: ['building'], targetTypes: ['character'], symmetric: false, domain: 'ownership',
})

defineRelation({
  type: 'stored_at', label: '存放', inverseType: 'stores_item', inverseLabel: '存放物品',
  sourceTypes: ['building'], targetTypes: ['item'], symmetric: false, domain: 'ownership',
})

// ─────────────────────────────────────────────
// 5. 时间关系域（Temporal Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'causes', label: '导致', inverseType: 'caused_by', inverseLabel: '由...导致',
  sourceTypes: ['event'], targetTypes: ['event'], symmetric: false, domain: 'temporal',
})

defineRelation({
  type: 'parallel_to', label: '并行于', inverseType: 'parallel_to', inverseLabel: '并行于',
  sourceTypes: ['event'], targetTypes: ['event'], symmetric: true, domain: 'temporal',
})

defineRelation({
  type: 'happened_in', label: '发生在', inverseType: 'site_of_event', inverseLabel: '事件发生地',
  sourceTypes: ['event'], targetTypes: ['region'], symmetric: false, domain: 'temporal',
})

defineRelation({
  type: 'occurred_at', label: '发生地', inverseType: 'event_at_building', inverseLabel: '建筑事件',
  sourceTypes: ['event'], targetTypes: ['building'], symmetric: false, domain: 'temporal',
})

defineRelation({
  type: 'involves', label: '涉及', inverseType: 'involved_in_event', inverseLabel: '涉及事件',
  sourceTypes: ['event'], targetTypes: ['character', 'organization'], symmetric: false, domain: 'temporal',
})

defineRelation({
  type: 'parent_child', label: '父子', inverseType: 'child_parent', inverseLabel: '子父',
  sourceTypes: ['outline_node'], targetTypes: ['outline_node'], symmetric: false, domain: 'temporal',
})

// ─────────────────────────────────────────────
// 6. 物品关系域（Item Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'created_by', label: '制作者', inverseType: 'creator_of', inverseLabel: '创作了',
  sourceTypes: ['item'], targetTypes: ['character', 'organization'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'used_in', label: '用于', inverseType: 'uses_item', inverseLabel: '使用物品',
  sourceTypes: ['item'], targetTypes: ['event', 'magic'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'related_item', label: '关联物品', inverseType: 'related_item', inverseLabel: '关联物品',
  sourceTypes: ['item'], targetTypes: ['item'], symmetric: true, domain: 'item',
})

defineRelation({
  type: 'weapon_relation', label: '武器关联', inverseType: 'weapon_relation', inverseLabel: '武器关联',
  sourceTypes: ['item'], targetTypes: ['item'], symmetric: true, domain: 'item',
  properties: [{ key: 'relation', label: '关系', fieldType: 'select', options: ['配套', '克制', '进化', '融合'].map(opt) }],
})

defineRelation({
  type: 'related_apparel', label: '关联服饰', inverseType: 'related_apparel', inverseLabel: '关联服饰',
  sourceTypes: ['item'], targetTypes: ['item'], symmetric: true, domain: 'item',
})

defineRelation({
  type: 'enchanted_with', label: '附魔', inverseType: 'enchanting_item', inverseLabel: '附魔物品',
  sourceTypes: ['item'], targetTypes: ['magic'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'combat_bonus', label: '战力加成', inverseType: 'bonus_from_item', inverseLabel: '加成来源',
  sourceTypes: ['item'], targetTypes: ['combat_stat'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'key_battles', label: '关键战役', inverseType: 'weapon_in_battle', inverseLabel: '战役武器',
  sourceTypes: ['item'], targetTypes: ['event'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'legendary_item', label: '传奇兵器', inverseType: 'legend_in_conflict', inverseLabel: '冲突传奇',
  sourceTypes: ['conflict'], targetTypes: ['item'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'contains', label: '包含', inverseType: 'contained_in', inverseLabel: '包含于',
  sourceTypes: ['building'], targetTypes: ['item'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'materials_from', label: '制成物', inverseType: 'material_source', inverseLabel: '原料来源',
  sourceTypes: ['plant'], targetTypes: ['item'], symmetric: false, domain: 'item',
})

// ─────────────────────────────────────────────
// 7. 物种关系域（Species Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'originates_from', label: '起源地', inverseType: 'origin_of_species', inverseLabel: '物种起源',
  sourceTypes: ['species', 'plant'], targetTypes: ['region'], symmetric: false, domain: 'species',
})

defineRelation({
  type: 'related_species', label: '关联物种', inverseType: 'related_species', inverseLabel: '关联物种',
  sourceTypes: ['species'], targetTypes: ['species'], symmetric: true, domain: 'species',
  properties: [{ key: 'relation', label: '关系类型', fieldType: 'select', options: ['祖先', '进化', '杂交', '共生', '天敌'].map(opt) }],
})

defineRelation({
  type: 'individual', label: '代表人物', inverseType: 'representative_of_species', inverseLabel: '代表物种',
  sourceTypes: ['species'], targetTypes: ['character'], symmetric: false, domain: 'species',
})

defineRelation({
  type: 'speaks', label: '语言', inverseType: 'spoken_by_species', inverseLabel: '使用物种',
  sourceTypes: ['species'], targetTypes: ['concept'], symmetric: false, domain: 'species',
})

defineRelation({
  type: 'used_by', label: '使用者', inverseType: 'uses_plant', inverseLabel: '使用植物',
  sourceTypes: ['plant'], targetTypes: ['species', 'character'], symmetric: false, domain: 'species',
})

defineRelation({
  type: 'magic_material', label: '施法材料', inverseType: 'material_for_magic', inverseLabel: '法术材料',
  sourceTypes: ['plant'], targetTypes: ['magic'], symmetric: false, domain: 'species',
})

// ─────────────────────────────────────────────
// 8. 魔法关系域（Magic Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'mastered_by', label: '掌握者', inverseType: 'masters', inverseLabel: '掌握',
  sourceTypes: ['magic'], targetTypes: ['character'], symmetric: false, domain: 'magic',
})

defineRelation({
  type: 'racial_ability', label: '种族天赋', inverseType: 'species_ability', inverseLabel: '天赋种族',
  sourceTypes: ['magic'], targetTypes: ['species'], symmetric: false, domain: 'magic',
})

defineRelation({
  type: 'requires_item', label: '需要媒介', inverseType: 'required_for_magic', inverseLabel: '法术媒介',
  sourceTypes: ['magic'], targetTypes: ['item'], symmetric: false, domain: 'magic',
})

defineRelation({
  type: 'based_on', label: '基于', inverseType: 'basis_for', inverseLabel: '基础法术',
  sourceTypes: ['magic'], targetTypes: ['magic'], symmetric: false, domain: 'magic',
})

defineRelation({
  type: 'counters', label: '克制', inverseType: 'countered_by', inverseLabel: '被克制',
  sourceTypes: ['magic'], targetTypes: ['magic'], symmetric: false, domain: 'magic',
})

defineRelation({
  type: 'upgrades_to', label: '进阶为', inverseType: 'upgraded_from', inverseLabel: '进阶自',
  sourceTypes: ['magic'], targetTypes: ['magic'], symmetric: false, domain: 'magic',
})

// ─────────────────────────────────────────────
// 9. 概念关系域（Concept Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'references', label: '引用', inverseType: 'referenced_by', inverseLabel: '被引用',
  sourceTypes: ['concept'], targetTypes: ['concept'], symmetric: false, domain: 'concept',
})

defineRelation({
  type: 'contradicts', label: '矛盾', inverseType: 'contradicts', inverseLabel: '矛盾',
  sourceTypes: ['concept'], targetTypes: ['concept'], symmetric: true, domain: 'concept',
  properties: [{ key: 'explanation', label: '矛盾说明', fieldType: 'textarea' }],
})

defineRelation({
  type: 'broader_than', label: '上位概念', inverseType: 'narrower_than', inverseLabel: '下位概念',
  sourceTypes: ['concept'], targetTypes: ['concept'], symmetric: false, domain: 'concept',
})

defineRelation({
  type: 'inspired_by', label: '灵感来源', inverseType: 'inspiration_for', inverseLabel: '启发',
  sourceTypes: ['concept'], targetTypes: ['concept', 'character'], symmetric: false, domain: 'concept',
})

defineRelation({
  type: 'associated_with_concept', label: '关联概念', inverseType: 'associated_with_concept', inverseLabel: '关联概念',
  sourceTypes: ['character'], targetTypes: ['concept'], symmetric: true, domain: 'concept',
})

// ─────────────────────────────────────────────
// 10. 文化关系域（Culture Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'practiced_in', label: '流行地', inverseType: 'cultural_practice', inverseLabel: '文化习俗',
  sourceTypes: ['culture'], targetTypes: ['region'], symmetric: false, domain: 'culture',
})

defineRelation({
  type: 'practiced_by', label: '所属文化', inverseType: 'cultural_species', inverseLabel: '文化物种',
  sourceTypes: ['culture'], targetTypes: ['species'], symmetric: false, domain: 'culture',
})

defineRelation({
  type: 'promoted_by', label: '官方推行', inverseType: 'promotes_culture', inverseLabel: '推行文化',
  sourceTypes: ['culture'], targetTypes: ['organization'], symmetric: false, domain: 'culture',
})

defineRelation({
  type: 'origin_event', label: '起源事件', inverseType: 'origin_of_culture', inverseLabel: '文化起源',
  sourceTypes: ['culture'], targetTypes: ['event'], symmetric: false, domain: 'culture',
})

// ─────────────────────────────────────────────
// 11. 语言关系域（Language Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'spoken_by', label: '使用者', inverseType: 'speaks_language', inverseLabel: '说语言',
  sourceTypes: ['language'], targetTypes: ['species', 'character'], symmetric: false, domain: 'language',
})

defineRelation({
  type: 'spoken_in', label: '通行区域', inverseType: 'language_of_region', inverseLabel: '区域语言',
  sourceTypes: ['language'], targetTypes: ['region'], symmetric: false, domain: 'language',
})

defineRelation({
  type: 'language_branch', label: '语系分支', inverseType: 'branch_parent', inverseLabel: '语系父级',
  sourceTypes: ['language'], targetTypes: ['language'], symmetric: false, domain: 'language',
})

defineRelation({
  type: 'related_language', label: '关联语言', inverseType: 'related_language', inverseLabel: '关联语言',
  sourceTypes: ['language'], targetTypes: ['language'], symmetric: true, domain: 'language',
  properties: [{ key: 'relation', label: '关系', fieldType: 'select', options: ['同源', '借词', '混合', '变体', '祖先语言'].map(opt) }],
})

defineRelation({
  type: 'script_used_in', label: '文字用于', inverseType: 'uses_script', inverseLabel: '使用文字',
  sourceTypes: ['language'], targetTypes: ['concept'], symmetric: false, domain: 'language',
})

// ─────────────────────────────────────────────
// 12. 冲突关系域（Conflict Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'participant_force', label: '参战势力', inverseType: 'force_in_conflict', inverseLabel: '参战冲突',
  sourceTypes: ['conflict'], targetTypes: ['organization'], symmetric: false, domain: 'conflict',
})

defineRelation({
  type: 'participant_commander', label: '指挥官', inverseType: 'commander_in', inverseLabel: '指挥冲突',
  sourceTypes: ['conflict'], targetTypes: ['character'], symmetric: false, domain: 'conflict',
})

defineRelation({
  type: 'battlefield', label: '战场', inverseType: 'battlefield_of', inverseLabel: '战场冲突',
  sourceTypes: ['conflict'], targetTypes: ['region'], symmetric: false, domain: 'conflict',
})

defineRelation({
  type: 'sub_conflict', label: '子战役', inverseType: 'parent_conflict', inverseLabel: '父冲突',
  sourceTypes: ['conflict'], targetTypes: ['conflict'], symmetric: false, domain: 'conflict',
})

defineRelation({
  type: 'related_event', label: '关联事件', inverseType: 'event_in_conflict', inverseLabel: '冲突事件',
  sourceTypes: ['conflict'], targetTypes: ['event'], symmetric: false, domain: 'conflict',
})

// ─────────────────────────────────────────────
// 13. 战力关系域（Combat Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'current_realm', label: '当前境界', inverseType: 'realm_of', inverseLabel: '境界角色',
  sourceTypes: ['combat_stat'], targetTypes: ['character'], symmetric: false, domain: 'combat',
})

defineRelation({
  type: 'required_skill', label: '所需技能', inverseType: 'skill_for_realm', inverseLabel: '技能境界',
  sourceTypes: ['combat_stat'], targetTypes: ['magic'], symmetric: false, domain: 'combat',
})

defineRelation({
  type: 'training_ground', label: '修炼圣地', inverseType: 'training_realm', inverseLabel: '修炼境界',
  sourceTypes: ['combat_stat'], targetTypes: ['region'], symmetric: false, domain: 'combat',
})

defineRelation({
  type: 'breakthrough_item', label: '突破丹药/法器', inverseType: 'breakthrough_for', inverseLabel: '突破境界',
  sourceTypes: ['combat_stat'], targetTypes: ['item'], symmetric: false, domain: 'combat',
})

defineRelation({
  type: 'racial_cap', label: '种族战力上限', inverseType: 'cap_for_species', inverseLabel: '上限种族',
  sourceTypes: ['combat_stat'], targetTypes: ['species'], symmetric: false, domain: 'combat',
})

// ─────────────────────────────────────────────
// 14. 灵感关系域（Inspiration Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'inspires', label: '灵感来源', inverseType: 'inspired_by_item', inverseLabel: '启发',
  sourceTypes: ['inspiration'], targetTypes: ['character', 'region', 'event', 'item', 'concept', 'organization'], symmetric: false, domain: 'inspiration',
})

// ─────────────────────────────────────────────
// 15. 创作关系域（Narrative Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'draft_of', label: '草稿对应', inverseType: 'draft_for', inverseLabel: '草稿',
  sourceTypes: ['manuscript'], targetTypes: ['outline_node'], symmetric: false, domain: 'narrative',
})

defineRelation({
  type: 'appears_in', label: '出现于', inverseType: 'contains_node', inverseLabel: '包含节点',
  sourceTypes: ['outline_node'], targetTypes: ['manuscript'], symmetric: false, domain: 'narrative',
})

defineRelation({
  type: 'note_link', label: '笔记链接', inverseType: 'note_linked_from', inverseLabel: '笔记被链接',
  sourceTypes: ['notebook'], targetTypes: ['notebook'], symmetric: false, domain: 'narrative',
})

// ─────────────────────────────────────────────
// 16. 建筑关系域（Building Relations）
// ─────────────────────────────────────────────

defineRelation({
  type: 'belongs_to_org', label: '所属', inverseType: 'has_building', inverseLabel: '拥有建筑',
  sourceTypes: ['building'], targetTypes: ['organization'], symmetric: false, domain: 'building',
})

defineRelation({
  type: 'managed_by', label: '管理者', inverseType: 'manages', inverseLabel: '管理',
  sourceTypes: ['building'], targetTypes: ['character'], symmetric: false, domain: 'building',
})

defineRelation({
  type: 'famous_for', label: '著名事物', inverseType: 'famous_in_building', inverseLabel: '著名于',
  sourceTypes: ['building'], targetTypes: ['item', 'concept'], symmetric: false, domain: 'building',
})

defineRelation({
  type: 'event_location', label: '事件发生地', inverseType: 'building_event', inverseLabel: '建筑事件',
  sourceTypes: ['building'], targetTypes: ['event'], symmetric: false, domain: 'building',
})

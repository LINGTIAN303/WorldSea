/**
 * 关联选择器静态数据（pair → 关系类型候选 / 类型 → 属性表单 / 默认类型推断）。
 * 关系类型一律写字符串字面量（值与 entity-core RelationTypes 一致）：本文件会被 mock 了
 * `@worldsea/entity-core/core` 的测试图连带加载，root 入口 re-export 届时是空壳，引用常量会在
 * 模块求值期拿到 undefined——字面量免疫。按芽拆出的静态表见 faithRelationOptions.ts。
 */
export interface RelationProperty {
  key: string
  label: string
  type: 'text' | 'textarea'
  placeholder?: string
}

import { FAITH_GUESS_RELATION, FAITH_RELATION_PROPERTIES, FAITH_RELATION_TYPE_OPTIONS } from './faithRelationOptions'

export function guessRelationType(srcType: string, tgtType: string): string {
  const map: Record<string, string> = {
    [`character_item`]: 'owns',
    [`item_character`]: 'owned_by',
    [`character_region`]: 'resides_in',
    [`region_character`]: 'notable_for',
    [`character_organization`]: 'belongs_to',
    [`organization_character`]: 'member_of',
    [`character_event`]: 'participated_in',
    [`event_character`]: 'involved_in',
    [`character_concept`]: 'associated_with',
    [`event_region`]: 'occurred_at',
    [`organization_event`]: 'involved_in',
    [`item_region`]: 'located_at',
    [`organization_region`]: 'located_in',
    [`region_organization`]: 'controls',
    [`organization_item`]: 'owns',
    [`event_item`]: 'associated_with',
    [`item_event`]: 'used_in',
    [`concept_character`]: 'associated_with',
    [`concept_region`]: 'associated_with',
    [`concept_organization`]: 'associated_with',
    [`concept_event`]: 'associated_with',
    [`concept_item`]: 'associated_with',
    [`region_event`]: 'happens_in',
    [`creature_region`]: 'inhabits',
    [`region_creature`]: 'habitat_of',
    [`creature_item`]: 'drops',
    [`character_creature`]: 'hunts',
    [`creature_character`]: 'hunted_by',
    [`creature_species`]: 'belongs_to',
    [`creature_organization`]: 'belongs_to',
    [`character_building`]: 'resides_at',
    [`plant_region`]: 'grows_in',
    [`language_language`]: 'derived_from',
    [`species_species`]: 'evolved_from',
    [`species_region`]: 'inhabits',
    // 信仰芽（faith）配对（2026-10-30 信仰芽批）
    ...FAITH_GUESS_RELATION,
  }
  const pairKey = `${srcType}_${tgtType}`
  return map[pairKey] || 'associated_with'
}

export const RELATION_TYPE_OPTIONS: Record<string, Array<{ type: string; label: string }>> = {
  'character_organization': [
    { type: 'belongs_to', label: '属于' },
    { type: 'member_of', label: '成员' },
    { type: 'allied_with', label: '同盟' },
    { type: 'hostile_to', label: '敌对' },
    { type: 'associated_with', label: '关联' },
    { type: 'knows', label: '认识' },
  ],
  'organization_character': [
    { type: 'member_of', label: '成员' },
    { type: 'belongs_to', label: '属于' },
    { type: 'allied_with', label: '同盟' },
    { type: 'hostile_to', label: '敌对' },
    { type: 'associated_with', label: '关联' },
    { type: 'knows', label: '认识' },
  ],
  'character_region': [
    { type: 'resides_in', label: '居住于' },
    { type: 'located_in', label: '位于' },
    { type: 'notable_for', label: '著名于' },
    { type: 'associated_with', label: '关联' },
    { type: 'owns', label: '拥有' },
  ],
  'region_character': [
    { type: 'notable_for', label: '著名于' },
    { type: 'located_in', label: '位于' },
    { type: 'resides_in', label: '居住' },
    { type: 'associated_with', label: '关联' },
    { type: 'controls', label: '控制' },
  ],
  'character_event': [
    { type: 'participated_in', label: '参与' },
    { type: 'involved_in', label: '涉及' },
    { type: 'causes', label: '导致' },
    { type: 'associated_with', label: '关联' },
  ],
  'event_character': [
    { type: 'involved_in', label: '涉及' },
    { type: 'participated_in', label: '参与' },
    { type: 'causes', label: '导致' },
    { type: 'associated_with', label: '关联' },
  ],
  'character_character': [
    { type: 'parent_of', label: '父母' },
    { type: 'child_of', label: '子女' },
    { type: 'knows', label: '认识' },
    { type: 'allied_with', label: '盟友' },
    { type: 'hostile_to', label: '敌对' },
    { type: 'associated_with', label: '关联' },
  ],
  'character_item': [
    { type: 'wields', label: '持有武器' },
    { type: 'owns', label: '拥有' },
    { type: 'owned_by', label: '归属' },
    { type: 'associated_with', label: '关联' },
  ],
  'item_character': [
    { type: 'owned_by', label: '归属' },
    { type: 'owns', label: '拥有' },
    { type: 'associated_with', label: '关联' },
  ],
  'organization_region': [
    { type: 'located_in', label: '位于' },
    { type: 'controls', label: '控制' },
    { type: 'associated_with', label: '关联' },
    { type: 'allied_with', label: '同盟' },
  ],
  'region_organization': [
    { type: 'controls', label: '控制' },
    { type: 'located_in', label: '位于' },
    { type: 'associated_with', label: '关联' },
  ],
  'region_region': [
    { type: 'contains', label: '包含' },
    { type: 'borders', label: '接壤' },
    { type: 'located_in', label: '位于' },
    { type: 'route', label: '航路' },
    { type: 'associated_with', label: '关联' },
  ],
  'event_region': [
    { type: 'occurred_at', label: '发生于' },
    { type: 'happens_in', label: '发生在' },
    { type: 'associated_with', label: '关联' },
  ],
  'region_event': [
    { type: 'happens_in', label: '发生在' },
    { type: 'occurred_at', label: '发生于' },
    { type: 'associated_with', label: '关联' },
  ],
  'event_event': [
    { type: 'causes', label: '导致' },
    { type: 'precedes', label: '先于' },
    { type: 'associated_with', label: '关联' },
  ],
  'organization_organization': [
    { type: 'allied_with', label: '同盟' },
    { type: 'hostile_to', label: '敌对' },
    { type: 'controls', label: '控制' },
    { type: 'belongs_to', label: '属于' },
    { type: 'associated_with', label: '关联' },
  ],
  'item_region': [
    { type: 'located_at', label: '位于' },
    { type: 'associated_with', label: '关联' },
  ],
  'region_item': [
    { type: 'located_at', label: '位于' },
    { type: 'associated_with', label: '关联' },
  ],
  'item_item': [
    { type: 'related_weapon', label: '关联武器' },
    { type: 'associated_with', label: '关联' },
    { type: 'inspired_by', label: '启发' },
    { type: 'contains', label: '包含' },
  ],
  'item_event': [
    { type: 'used_in', label: '用于' },
    { type: 'associated_with', label: '关联' },
    { type: 'involved_in', label: '涉及' },
  ],
  'event_item': [
    { type: 'associated_with', label: '关联' },
    { type: 'involved_in', label: '涉及' },
  ],
  'organization_event': [
    { type: 'involved_in', label: '涉及' },
    { type: 'participated_in', label: '参与' },
    { type: 'associated_with', label: '关联' },
  ],
  'event_organization': [
    { type: 'involved_in', label: '涉及' },
    { type: 'participated_in', label: '参与' },
    { type: 'associated_with', label: '关联' },
  ],
  'concept_character': [
    { type: 'associated_with', label: '关联' },
    { type: 'inspired_by', label: '启发' },
  ],
  'concept_region': [
    { type: 'associated_with', label: '关联' },
  ],
  'concept_organization': [
    { type: 'associated_with', label: '关联' },
  ],
  'concept_event': [
    { type: 'associated_with', label: '关联' },
  ],
  'concept_item': [
    { type: 'associated_with', label: '关联' },
  ],
  'concept_concept': [
    { type: 'references', label: '引用' },
    { type: 'inspired_by', label: '启发' },
    { type: 'associated_with', label: '关联' },
    { type: 'contains', label: '包含' },
  ],
  '*_*': [
    { type: 'associated_with', label: '关联' },
    { type: 'knows', label: '认识' },
    { type: 'allied_with', label: '同盟' },
    { type: 'hostile_to', label: '敌对' },
  ],
  // 生物图鉴（creature）配对（2026-10-28 三芽批）：类型名与关系注册表一致
  'creature_region': [
    { type: 'inhabits', label: '栖息于' },
    { type: 'associated_with', label: '关联' },
  ],
  'region_creature': [
    { type: 'habitat_of', label: '栖息地' },
    { type: 'associated_with', label: '关联' },
  ],
  'creature_item': [
    { type: 'drops', label: '产出' },
    { type: 'associated_with', label: '关联' },
  ],
  'item_creature': [
    { type: 'dropped_by', label: '产出来源' },
    { type: 'associated_with', label: '关联' },
  ],
  'character_creature': [
    { type: 'hunts', label: '猎杀' },
    { type: 'tames', label: '驯服/契约' },
    { type: 'associated_with', label: '关联' },
  ],
  'creature_character': [
    { type: 'hunted_by', label: '被猎杀' },
    { type: 'tamed_by', label: '被驯服' },
    { type: 'associated_with', label: '关联' },
  ],
  'creature_species': [
    { type: 'belongs_to', label: '属于' },
  ],
  'species_creature': [
    { type: 'has_member', label: '拥有成员' },
  ],
  'creature_organization': [
    { type: 'belongs_to', label: '属于' },
  ],
  'organization_creature': [
    { type: 'has_member', label: '拥有成员' },
  ],
  // 死关系 Tab 修复批（2026-10-28）：languages/species/plants/buildings Tab 定向添加的配对候选
  'character_building': [
    { type: 'resides_at', label: '驻留于' },
    { type: 'associated_with', label: '关联' },
  ],
  'building_character': [
    { type: 'resident_of', label: '驻留者' },
    { type: 'associated_with', label: '关联' },
  ],
  'plant_region': [
    { type: 'grows_in', label: '生长于' },
    { type: 'associated_with', label: '关联' },
  ],
  'region_plant': [
    { type: 'growing_site', label: '生长区域' },
    { type: 'associated_with', label: '关联' },
  ],
  'language_language': [
    { type: 'derived_from', label: '分支来源' },
    { type: 'associated_with', label: '关联' },
  ],
  'species_species': [
    { type: 'evolved_from', label: '进化自' },
    { type: 'symbiosis', label: '共生/天敌' },
    { type: 'associated_with', label: '关联' },
  ],
  'species_region': [
    { type: 'inhabits', label: '栖息于' },
    { type: 'associated_with', label: '关联' },
  ],
  'region_species': [
    { type: 'habitat_of', label: '栖息地' },
    { type: 'associated_with', label: '关联' },
  ],
  // 信仰芽（faith）配对（2026-10-30 信仰芽批）：静态表在 faithRelationOptions.ts，展开保持同表语义
  ...FAITH_RELATION_TYPE_OPTIONS,
}

export const RELATION_PROPERTIES: Record<string, RelationProperty[]> = {
  // 信仰芽（faith）属性（2026-10-30 信仰芽批）：静态表在 faithRelationOptions.ts
  ...FAITH_RELATION_PROPERTIES,
  'belongs_to': [
    { key: 'role', label: '角色/职位', type: 'text', placeholder: '如：成员、长老、学徒' },
    { key: 'since', label: '始于', type: 'text', placeholder: '如：第三纪元' },
  ],
  'member_of': [
    { key: 'role', label: '角色/职位', type: 'text', placeholder: '如：将军、祭司' },
    { key: 'since', label: '加入时间', type: 'text' },
  ],
  'owns': [
    { key: 'acquisition', label: '获得方式', type: 'text', placeholder: '如：继承、发现、锻造' },
    { key: 'since', label: '获得时间', type: 'text' },
  ],
  'owned_by': [
    { key: 'acquisition', label: '获得方式', type: 'text' },
    { key: 'since', label: '获得时间', type: 'text' },
  ],
  'participated_in': [
    { key: 'role', label: '扮演角色', type: 'text', placeholder: '如：见证者、主力' },
  ],
  'involved_in': [
    { key: 'role', label: '参与角色', type: 'text' },
    { key: 'impact', label: '影响', type: 'textarea', placeholder: '对该事件的影响描述' },
  ],
  'resides_in': [
    { key: 'since', label: '定居时间', type: 'text' },
    { key: 'status', label: '居住状态', type: 'text', placeholder: '如：常住、暂居' },
  ],
  'located_in': [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'detail', label: '具体位置', type: 'text', placeholder: '如：北城区' },
  ],
  'located_at': [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'detail', label: '具体位置', type: 'text' },
  ],
  'allied_with': [
    { key: 'since', label: '结盟时间', type: 'text' },
    { key: 'terms', label: '盟约内容', type: 'textarea' },
  ],
  'hostile_to': [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'reason', label: '原因', type: 'textarea' },
  ],
  'knows': [
    { key: 'since', label: '认识于', type: 'text' },
    { key: 'nature', label: '关系性质', type: 'text', placeholder: '如：同窗、旧友、一面之缘' },
  ],
  'parent_of': [
    { key: 'biological', label: '血缘', type: 'text', placeholder: '如：亲生、养父母' },
  ],
  'child_of': [
    { key: 'biological', label: '血缘', type: 'text', placeholder: '如：亲生、养子女' },
  ],
  'causes': [
    { key: 'mechanism', label: '因果机制', type: 'textarea', placeholder: '描述因果关系的详细机制' },
  ],
  'precedes': [
    { key: 'gap', label: '时间间隔', type: 'text' },
  ],
  'borders': [
    { key: 'length', label: '边境长度', type: 'text' },
    { key: 'type', label: '边境类型', type: 'text', placeholder: '如：山脉、河流、城墙' },
  ],
  'controls': [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'method', label: '控制方式', type: 'text', placeholder: '如：军事占领、经济控制' },
  ],
  'route': [
    { key: 'distance', label: '距离', type: 'text' },
    { key: 'method', label: '交通方式', type: 'text', placeholder: '如：陆路、海路、传送门' },
  ],
  'contains': [
    { key: 'since', label: '始于', type: 'text' },
  ],
  'references': [
    { key: 'nature', label: '引用性质', type: 'text', placeholder: '如：理论基础、灵感来源' },
  ],
  'inspired_by': [
    { key: 'aspect', label: '启发方面', type: 'text' },
  ],
  'notable_for': [
    { key: 'detail', label: '著名原因', type: 'textarea' },
  ],
  'occurred_at': [
    { key: 'detail', label: '具体地点', type: 'text' },
  ],
  'happens_in': [
    { key: 'detail', label: '具体地点', type: 'text' },
  ],
  'associated_with': [
    { key: 'nature', label: '关联性质', type: 'text', placeholder: '如：世界观关联、剧情关联' },
  ],
}

/**
 * 边视觉策略（2026-10-26 重构）。
 *
 * 旧图把 27 种关系类型各配一色，实际数据只有十几条边，颜色全浪费且互相冲突。
 * 新规则：关系按 5 个语义族 + 其他着色，方向由箭头表达，关系名只在悬停/选中时出现。
 */
import type { EdgeFamily } from '../model/types'
import { DARK_EDGE_FAMILY, LIGHT_EDGE_FAMILY, withAlpha } from './palette'

const STRUCTURAL = [
  'part_of', 'belongs_to', 'has_member', 'member_of', 'sub_organization', 'parent_organization',
  'owns', 'owned_by', 'possessed_by', 'possesses', 'current_holder', 'currently_holds',
  'past_holders', 'historically_held', 'parent_child', 'child_parent', 'contains', 'contained_in',
  'has_subregion', 'subregion_of', 'broader_than', 'narrower_than', 'language_branch',
  'branch_parent', 'sub_conflict', 'parent_conflict', 'belongs_to_org', 'has_building',
  'managed_by', 'manages', 'related_item', 'related_apparel', 'weapon_relation',
  'related_species', 'related_language', 'associated_with', 'associated_with_concept',
  'related_event', 'composed_of', 'includes',
]

const SOCIAL = [
  'knows', 'ally_of', 'allied_with', 'rival_of', 'hostile_to', 'at_war_with', 'spouse_of',
  'sibling_of', 'mentor_of', 'student_of', 'trade_with', 'participated_in', 'has_participant',
  'involved_in', 'has_org_participant', 'participant_force', 'force_in_conflict',
  'participant_commander', 'commander_in', 'speaks', 'spoken_by', 'spoken_by_species',
  'practiced_in', 'practiced_by', 'promoted_by', 'cultural_practice', 'cultural_species',
  'promotes_culture', 'mastered_by', 'masters', 'individual', 'representative_of_species',
  'origin_event', 'origin_of_culture',
]

const SPATIAL = [
  'resides_in', 'resident_of_place', 'located_in', 'contains_location', 'located_at',
  'location_of', 'borders', 'route', 'reverse_route', 'connected_to', 'happened_in',
  'site_of_event', 'occurred_at', 'event_at_building', 'battlefield', 'battlefield_of',
  'event_location', 'building_event', 'capital_of', 'has_capital', 'enclave_of', 'has_enclave',
  'kept_at', 'stored_at', 'stores', 'stores_item', 'resident', 'resides_in_building',
  'training_ground', 'training_realm', 'originates_from', 'origin_of_species', 'spoken_in',
  'language_of_region',
]

const CAUSAL = [
  'causes', 'caused_by', 'controls', 'controlled_by', 'counters', 'countered_by',
  'upgrades_to', 'upgraded_from', 'enchanted_with', 'enchanting_item', 'combat_bonus',
  'bonus_from_item', 'breakthrough_item', 'breakthrough_for', 'required_skill',
  'skill_for_realm', 'requires_item', 'required_for_magic', 'magic_material',
  'material_for_magic', 'key_battles', 'weapon_in_battle', 'legendary_item', 'legend_in_conflict',
  'racial_ability', 'species_ability', 'racial_cap', 'cap_for_species', 'current_realm',
  'realm_of', 'used_in', 'uses_item', 'used_by', 'uses_plant', 'based_on', 'basis_for',
  'materials_from', 'material_source', 'created_by', 'creator_of', 'inspired_by_item',
]

const NARRATIVE = [
  'outline_mentions', 'mentioned_by_outline', 'outline_located_in', 'outline_nodes_here',
  'outline_covers', 'covered_by_outline', 'outline_parallel', 'outline_contrast',
  'outline_progression', 'outline_chapter', 'chapter_outline', 'outline_part_of',
  'note_link', 'note_linked_from', 'references', 'referenced_by', 'contradicts',
  'inspired_by', 'inspiration_for', 'inspires', 'notable_for', 'notable_in', 'famous_for',
  'famous_in_building',
]

const EXACT = new Map<string, EdgeFamily>()
for (const types of [STRUCTURAL, SOCIAL, SPATIAL, CAUSAL, NARRATIVE] as const) {
  const family: EdgeFamily =
    types === STRUCTURAL ? 'structural'
      : types === SOCIAL ? 'social'
        : types === SPATIAL ? 'spatial'
          : types === CAUSAL ? 'causal'
            : 'narrative'
  for (const type of types) EXACT.set(type, family)
}

/** 关键词兜底：注册表外的自定义/第三方关系也落入稳定族 */
export function familyOfRelation(relType: string): EdgeFamily {
  const type = (relType || '').toLowerCase()
  const exact = EXACT.get(type)
  if (exact) return exact
  if (type.startsWith('outline_') || type.includes('outline') || type.includes('chapter') || type.includes('note')) return 'narrative'
  if (type.includes('locat') || type.includes('reside') || type.includes('border') || type.includes('route') || type.includes('capital') || type.includes('battlefield') || type.includes('region')) return 'spatial'
  if (type.includes('ally') || type.includes('rival') || type.includes('hostile') || type.includes('war') || type.includes('spouse') || type.includes('sibling') || type.includes('mentor') || type.includes('student') || type.includes('know') || type.includes('member') || type.includes('particip') || type.includes('involve') || type.includes('speak') || type.includes('practice') || type.includes('culture') || type.includes('trade')) return 'social'
  if (type.includes('cause') || type.includes('control') || type.includes('counter') || type.includes('enchant') || type.includes('bonus') || type.includes('breakthrough') || type.includes('require') || type.includes('magic') || type.includes('ability') || type.includes('realm') || type.includes('skill') || type.includes('combat') || type.includes('material') || type.includes('used') || type.includes('create')) return 'causal'
  if (type.includes('contain') || type.includes('belong') || type.includes('own') || type.includes('part') || type.includes('parent') || type.includes('child') || type.includes('broader') || type.includes('narrower') || type.includes('related') || type.includes('associated') || type.includes('branch') || type.startsWith('sub_')) return 'structural'
  return 'other'
}

export interface EdgeVisual {
  stroke: string
  lineWidth: number
  endArrow: boolean
  startArrow: boolean
  lineDash?: number[]
  curveOffset: number
}

export function edgeVisual(
  relType: string,
  noArrow: boolean,
  bidirectional: boolean,
  symmetric: boolean,
  dashed: boolean,
  highlighted = false,
  mode: 'dark' | 'theme' = 'dark',
): EdgeVisual {
  const table = mode === 'theme' ? LIGHT_EDGE_FAMILY : DARK_EDGE_FAMILY
  const color = table[familyOfRelation(relType)] || table.other
  return {
    stroke: withAlpha(color, highlighted ? 0.95 : 0.5),
    lineWidth: highlighted ? 2.4 : 1.2,
    endArrow: !noArrow,
    startArrow: bidirectional || symmetric,
    lineDash: dashed ? [4, 4] : undefined,
    curveOffset: highlighted ? 12 : 18,
  }
}

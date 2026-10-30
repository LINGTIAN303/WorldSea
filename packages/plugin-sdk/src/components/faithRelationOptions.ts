/**
 * 信仰芽（faith）关联选择器静态数据（2026-10-30 信仰芽批）。
 * 独立成文件而非并入 relationPickerOptions.ts：后者已逼近 400 行硬上限，按芽拆分可线性扩展。
 * 关系类型同样写字符串字面量（理由见 relationPickerOptions.ts 文件头）。
 */

/** pair → 默认关系类型推断 */
export const FAITH_GUESS_RELATION: Record<string, string> = {
  [`character_faith`]: 'believes_in',
  [`faith_character`]: 'faith_member',
  [`organization_faith`]: 'believes_in',
  [`faith_organization`]: 'faith_member',
  [`faith_building`]: 'holy_site',
  [`building_faith`]: 'holy_site_of',
  [`faith_region`]: 'holy_site',
  [`region_faith`]: 'holy_site_of',
  [`event_faith`]: 'festival_of',
  [`faith_event`]: 'faith_festival',
}

/** pair → 关系类型候选（类型名与关系注册表一致） */
export const FAITH_RELATION_TYPE_OPTIONS: Record<string, Array<{ type: string; label: string }>> = {
  'character_faith': [
    { type: 'believes_in', label: '信奉' },
    { type: 'associated_with', label: '关联' },
  ],
  'faith_character': [
    { type: 'faith_member', label: '信众' },
    { type: 'associated_with', label: '关联' },
  ],
  'organization_faith': [
    { type: 'believes_in', label: '信奉' },
    { type: 'associated_with', label: '关联' },
  ],
  'faith_organization': [
    { type: 'faith_member', label: '信众' },
    { type: 'associated_with', label: '关联' },
  ],
  'faith_building': [
    { type: 'holy_site', label: '圣地' },
    { type: 'associated_with', label: '关联' },
  ],
  'building_faith': [
    { type: 'holy_site_of', label: '圣地所属' },
    { type: 'associated_with', label: '关联' },
  ],
  'faith_region': [
    { type: 'holy_site', label: '圣地' },
    { type: 'associated_with', label: '关联' },
  ],
  'region_faith': [
    { type: 'holy_site_of', label: '圣地所属' },
    { type: 'associated_with', label: '关联' },
  ],
  'event_faith': [
    { type: 'festival_of', label: '节日归属' },
    { type: 'associated_with', label: '关联' },
  ],
  'faith_event': [
    { type: 'faith_festival', label: '信仰节日' },
    { type: 'associated_with', label: '关联' },
  ],
}

/** 关系类型 → 属性表单 */
export const FAITH_RELATION_PROPERTIES: Record<string, Array<{ key: string; label: string; type: 'text' | 'textarea'; placeholder?: string }>> = {
  'believes_in': [
    { key: 'role', label: '信众身份', type: 'text', placeholder: '如：主教、祭司、平信徒、异端' },
    { key: 'since', label: '皈依时间', type: 'text' },
  ],
}

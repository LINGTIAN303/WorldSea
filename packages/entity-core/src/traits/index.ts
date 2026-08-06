/** 原子 Trait 定义 v1.1（13 个原子 Trait，defineTrait 注册到 traitRegistry），详细见 docs/details/注释/packages/entity-core/traits/index.md */

import { defineTrait } from '../core/TraitRuntime'
import type { TraitDefinition } from '../types/trait'

// ─────────────────────────────────────────────
// 1. Identifiable（强制，所有实体）
// ─────────────────────────────────────────────

export const Identifiable: TraitDefinition = defineTrait({
  id: 'identifiable',
  label: '标识',
  description: '所有实体必须拥有的基础标识字段',
  required: true,
  fields: [
    { key: 'title', label: '标题', type: 'text', required: true, placeholder: '实体标题' },
    { key: 'description', label: '描述', type: 'textarea' },
  ],
})

// ─────────────────────────────────────────────
// 2. Taggable
// ─────────────────────────────────────────────

export const Taggable: TraitDefinition = defineTrait({
  id: 'taggable',
  label: '标签',
  description: '标签分类能力',
  fields: [
    { key: 'tags', label: '标签', type: 'tags' },
  ],
})

// ─────────────────────────────────────────────
// 3. Visual
// ─────────────────────────────────────────────

export const Visual: TraitDefinition = defineTrait({
  id: 'visual',
  label: '视觉',
  description: '封面图等视觉资源',
  fields: [
    { key: 'coverImage', label: '封面图', type: 'image' },
  ],
})

// ─────────────────────────────────────────────
// 4. Datable（时间范围）
// ─────────────────────────────────────────────

export const Datable: TraitDefinition = defineTrait({
  id: 'datable',
  label: '时间范围',
  description: '具有开始/结束时间的实体',
  fields: [
    { key: 'date', label: '日期', type: 'text', semanticHint: 'date' },
    { key: 'dateEnd', label: '结束日期', type: 'text', semanticHint: 'dateEnd' },
  ],
})

// ─────────────────────────────────────────────
// 5. Material
// ─────────────────────────────────────────────

export const Material: TraitDefinition = defineTrait({
  id: 'material',
  label: '材质',
  description: '物质构成与颜色',
  fields: [
    { key: 'material', label: '材质', type: 'text', semanticHint: 'material' },
    { key: 'color', label: '颜色', type: 'text', semanticHint: 'color' },
  ],
})

// ─────────────────────────────────────────────
// 6. Rateable（价值/稀有度轴）
// ─────────────────────────────────────────────

export const Rateable: TraitDefinition = defineTrait({
  id: 'rateable',
  label: '稀有度',
  description: '价值或稀有度评级',
  fields: [
    {
      key: 'rarity',
      label: '稀有度',
      type: 'select',
      options: ['普通', '珍贵', '稀有', '传说', '唯一'],
    },
  ],
})

// ─────────────────────────────────────────────
// 7. Deteriorable（损耗/状态轴）
// 默认选项适用于物理物品，实体可通过 fieldOverrides 覆盖
// ─────────────────────────────────────────────

export const Deteriorable: TraitDefinition = defineTrait({
  id: 'deteriorable',
  label: '状况',
  description: '物理状况或生命周期状态',
  fields: [
    {
      key: 'condition',
      label: '状况',
      type: 'select',
      options: ['完好', '轻微损坏', '严重损坏', '已修复', '已毁', '遗失'],
    },
  ],
})

// ─────────────────────────────────────────────
// 8. Originated
// ─────────────────────────────────────────────

export const Originated: TraitDefinition = defineTrait({
  id: 'originated',
  label: '来源',
  description: '产地与制作者',
  fields: [
    { key: 'origin', label: '产地/来源', type: 'text', semanticHint: 'origin' },
    { key: 'creator', label: '制作者', type: 'text', semanticHint: 'creator' },
  ],
})

// ─────────────────────────────────────────────
// 9. Physical
// ─────────────────────────────────────────────

export const Physical: TraitDefinition = defineTrait({
  id: 'physical',
  label: '外貌',
  description: '物理形态与外貌描述',
  fields: [
    { key: 'appearance', label: '外貌特征', type: 'textarea', semanticHint: 'appearance' },
    { key: 'avgHeight', label: '平均身高', type: 'text' },
    { key: 'avgWeight', label: '平均体重', type: 'text' },
  ],
})

// ─────────────────────────────────────────────
// 9b. Ageable（生命时间点）
// 与 Physical 分离：Physical 描述物理形态，Ageable 描述生命时间
// 角色可用作诞生/死亡，物种可用作起源/灭绝
// ─────────────────────────────────────────────

export const Ageable: TraitDefinition = defineTrait({
  id: 'ageable',
  label: '生命时间',
  description: '诞生与消亡时间点',
  fields: [
    { key: 'birthDate', label: '诞生时间', type: 'text', semanticHint: 'birthDate' },
    { key: 'deathDate', label: '消亡时间', type: 'text', semanticHint: 'deathDate' },
  ],
})

// ─────────────────────────────────────────────
// 10. Ownable
// ─────────────────────────────────────────────

export const Ownable: TraitDefinition = defineTrait({
  id: 'ownable',
  label: '拥有者',
  description: '当前持有者信息',
  fields: [
    { key: 'currentOwner', label: '当前持有者', type: 'text', semanticHint: 'owner' },
  ],
})

// ─────────────────────────────────────────────
// 12. Locatable
// ─────────────────────────────────────────────

export const Locatable: TraitDefinition = defineTrait({
  id: 'locatable',
  label: '位置',
  description: '地理位置与地图信息',
  fields: [
    { key: 'location', label: '位置', type: 'text', semanticHint: 'location' },
    { key: 'mapImage', label: '地图图片', type: 'image' },
    { key: 'mapX', label: '地图X坐标', type: 'number' },
    { key: 'mapY', label: '地图Y坐标', type: 'number' },
  ],
})

// ─────────────────────────────────────────────
// 13. Narrative
// ─────────────────────────────────────────────

export const Narrative: TraitDefinition = defineTrait({
  id: 'narrative',
  label: '叙事',
  description: '创作内容与字数统计',
  fields: [
    { key: 'content', label: '内容', type: 'textarea' },
    { key: 'wordCount', label: '字数', type: 'text' },
    { key: 'sortOrder', label: '排序', type: 'text' },
  ],
})

// ─────────────────────────────────────────────
// 预置组合（语法糖，不进数据模型）
// ─────────────────────────────────────────────

/**
 * Artifact 预置组合——适用于人造物品（item）。
 * 使用时展开为 TraitRef[]，不保留 Preset 运行时信息。
 */
export const ArtifactTraits = [
  { traitId: 'identifiable' },
  { traitId: 'taggable' },
  { traitId: 'visual' },
  { traitId: 'material' },
  { traitId: 'rateable' },
  { traitId: 'deteriorable' },
  { traitId: 'originated' },
  { traitId: 'ownable' },
]

/**
 * Being 预置组合——适用于有生命的实体（character, species）。
 */
export const BeingTraits = [
  { traitId: 'identifiable' },
  { traitId: 'taggable' },
  { traitId: 'visual' },
  { traitId: 'physical' },
  { traitId: 'ageable' },
  { traitId: 'ownable' },
]

/**
 * Place 预置组合——适用于地理实体（region, building）。
 */
export const PlaceTraits = [
  { traitId: 'identifiable' },
  { traitId: 'taggable' },
  { traitId: 'visual' },
  { traitId: 'locatable' },
]

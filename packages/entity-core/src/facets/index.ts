/**
 * Facet 定义——WeaponFacet 和 ApparelFacet
 * Facet 是挂载在 Item 实体上的结构化数据块：不是独立实体，无独立 ID，不可独立搜索。
 * 解决 Items/Weapons/Apparel 的分类冲突问题。
 */

import { defineFacet } from '../core/TraitRuntime'
import type { FacetDefinition } from '../types/trait'

/** options 字符串数组转契约 {value,label} 对象数组 */
const opt = (label: string) => ({ value: label, label })

// ─────────────────────────────────────────────
// WeaponFacet — 武器特性面
// ─────────────────────────────────────────────

export const WeaponFacet: FacetDefinition = defineFacet({
  id: 'weapon',
  label: '武器特性',
  description: '武器相关属性：类型、品级、锻造者、特殊能力等',
  hostTypes: ['item'],
  fields: [
    {
      key: 'weaponType',
      label: '武器类型',
      fieldType: 'select',
      options: ['剑', '刀', '枪', '弓', '法器', '盾', '暗器', '其他'].map(opt),
    },
    {
      key: 'rank',
      label: '品级',
      fieldType: 'select',
      options: ['凡品', '祥品', '灵品', '圣器', '神器'].map(opt),
    },
    { key: 'smith', label: '锻造者', fieldType: 'text', semanticHint: 'creator' },
    { key: 'forgedAt', label: '锻造时间', fieldType: 'text' },
    { key: 'specialAbility', label: '特殊能力', fieldType: 'textarea' },
    { key: 'battles', label: '战绩摘要', fieldType: 'textarea' },
  ],
})

// ─────────────────────────────────────────────
// ApparelFacet — 服饰/装备特性面
// ─────────────────────────────────────────────

export const ApparelFacet: FacetDefinition = defineFacet({
  id: 'apparel',
  label: '服饰特性',
  description: '服饰/装备相关属性：类型、护甲等级、防御值、耐久度等',
  hostTypes: ['item'],
  fields: [
    {
      key: 'apparelType',
      label: '服饰类型',
      fieldType: 'select',
      options: ['上衣', '下装', '连衣裙', '外套/披风', '头饰',
        '鞋履', '手套', '饰品/首饰', '轻甲', '中甲', '重甲', '盾牌', '法袍', '套装'].map(opt),
    },
    {
      key: 'armorClass',
      label: '护甲等级',
      fieldType: 'select',
      options: ['无防护', '布甲', '皮甲', '锁甲', '板甲', '法袍', '饰品'].map(opt),
    },
    {
      key: 'style',
      label: '风格',
      fieldType: 'select',
      options: ['朴素', '华丽', '异域', '军用', '仪式', '日常', '伪装', '工装'].map(opt),
    },
    { key: 'defense', label: '防御值', fieldType: 'number' },
    {
      key: 'weight',
      label: '重量',
      fieldType: 'select',
      options: ['极轻', '轻', '中等', '重', '极重'].map(opt),
    },
    {
      key: 'durability',
      label: '耐久度',
      fieldType: 'select',
      options: ['易损', '普通', '耐用', '坚固', '不毁'].map(opt),
    },
    { key: 'significance', label: '意义', fieldType: 'textarea' },
  ],
})

/** 信仰关系域（faith，2026-10-30 信仰芽批）：单独文件注册，避免膨胀已冻结的 relations/index.ts（creature.ts 同款） */

import { defineRelation } from '../core/RelationshipRegistry'

defineRelation({
  type: 'believes_in', label: '信奉', inverseType: 'faith_member', inverseLabel: '信众',
  sourceTypes: ['character', 'organization'], targetTypes: ['faith'], symmetric: false, domain: 'person',
})

defineRelation({
  type: 'holy_site', label: '圣地', inverseType: 'holy_site_of', inverseLabel: '圣地所属',
  sourceTypes: ['faith'], targetTypes: ['building', 'region'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'festival_of', label: '节日归属', inverseType: 'faith_festival', inverseLabel: '信仰节日',
  sourceTypes: ['event'], targetTypes: ['faith'], symmetric: false, domain: 'temporal',
})

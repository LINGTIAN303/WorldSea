/** 生物关系域（creature，2026-10-28 三芽批）：单独文件注册，避免膨胀已冻结的 relations/index.ts（outlineLateral 同款） */

import { defineRelation } from '../core/RelationshipRegistry'

defineRelation({
  type: 'inhabits', label: '栖息于', inverseType: 'habitat_of', inverseLabel: '栖息地',
  sourceTypes: ['creature', 'species'], targetTypes: ['region'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'drops', label: '产出', inverseType: 'dropped_by', inverseLabel: '产出来源',
  sourceTypes: ['creature'], targetTypes: ['item'], symmetric: false, domain: 'item',
})

defineRelation({
  type: 'hunts', label: '猎杀', inverseType: 'hunted_by', inverseLabel: '被猎杀',
  sourceTypes: ['character'], targetTypes: ['creature'], symmetric: false, domain: 'combat',
})

defineRelation({
  type: 'tames', label: '驯服/契约', inverseType: 'tamed_by', inverseLabel: '被驯服',
  sourceTypes: ['character'], targetTypes: ['creature'], symmetric: false, domain: 'person',
})

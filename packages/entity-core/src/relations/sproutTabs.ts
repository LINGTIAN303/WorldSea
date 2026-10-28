/** 芽关系 Tab 引用的补充关系类型（2026-10-28 死关系 Tab 修复批）：单独文件注册，避免膨胀已冻结的 relations/index.ts（creature.ts 同款）。
 *  类型名与各芽视图 RelationTabDef 的 relationType 一一对应；方向以 Tab 声明为准（reverseDirection=true → 本芽类型为 target）。 */

import { defineRelation } from '../core/RelationshipRegistry'

defineRelation({
  type: 'derived_from', label: '分支来源', inverseType: 'derived_into', inverseLabel: '分化出',
  sourceTypes: ['language'], targetTypes: ['language'], symmetric: false, domain: 'language',
})

defineRelation({
  type: 'evolved_from', label: '进化自', inverseType: 'evolves_into', inverseLabel: '进化出',
  sourceTypes: ['species'], targetTypes: ['species'], symmetric: false, domain: 'species',
})

defineRelation({
  type: 'symbiosis', label: '共生/天敌', inverseType: 'symbiosis', inverseLabel: '共生/天敌',
  sourceTypes: ['species'], targetTypes: ['species'], symmetric: true, domain: 'species',
})

defineRelation({
  type: 'grows_in', label: '生长于', inverseType: 'growing_site', inverseLabel: '生长区域',
  sourceTypes: ['plant'], targetTypes: ['region'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'related_weapon', label: '关联武器', inverseType: 'related_weapon', inverseLabel: '关联武器',
  sourceTypes: ['item'], targetTypes: ['item'], symmetric: true, domain: 'item',
})

defineRelation({
  type: 'resides_at', label: '驻留于', inverseType: 'resident_of', inverseLabel: '驻留者',
  sourceTypes: ['character'], targetTypes: ['building'], symmetric: false, domain: 'geography',
})

defineRelation({
  type: 'wields', label: '持有武器', inverseType: 'wielded_by', inverseLabel: '被持有',
  sourceTypes: ['character'], targetTypes: ['item'], symmetric: false, domain: 'ownership',
})

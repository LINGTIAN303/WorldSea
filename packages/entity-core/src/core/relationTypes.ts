export const RelationTypes = {
  PARENT_OF: 'parent_of',
  CHILD_OF: 'child_of',
  KNOWS: 'knows',
  RESIDES_IN: 'resides_in',
  BELONGS_TO: 'belongs_to',
  LOCATED_IN: 'located_in',
  BORDERS: 'borders',
  ROUTE: 'route',
  CONTAINS: 'contains',
  CAPITAL_OF: 'capital_of',
  NOTABLE_FOR: 'notable_for',
  ENCLAVE_OF: 'enclave_of',
  MEMBER_OF: 'member_of',
  PARTICIPATED_IN: 'participated_in',
  ASSOCIATED_WITH: 'associated_with',
  OWNED_BY: 'owned_by',
  OWNS: 'owns',
  CONTROLS: 'controls',
  HOSTILE_TO: 'hostile_to',
  ALLIED_WITH: 'allied_with',
  REFERENCES: 'references',
  INSPIRED_BY: 'inspired_by',
  HAPPENS_IN: 'happens_in',
  CAUSES: 'causes',
  PRECEDES: 'precedes',
  INVOLVED_IN: 'involved_in',
  OCCURRED_AT: 'occurred_at',
  LOCATED_AT: 'located_at',
  SPOUSE_OF: 'spouse_of',
  SIBLING_OF: 'sibling_of',
  MENTOR_OF: 'mentor_of',
} as const

export type RelationType = (typeof RelationTypes)[keyof typeof RelationTypes]

export const RelationTypeLabels: Record<RelationType, string> = {
  [RelationTypes.PARENT_OF]: '父子',
  [RelationTypes.CHILD_OF]: '子父',
  [RelationTypes.KNOWS]: '认识',
  [RelationTypes.RESIDES_IN]: '居住',
  [RelationTypes.BELONGS_TO]: '属于',
  [RelationTypes.LOCATED_IN]: '位于',
  [RelationTypes.BORDERS]: '接壤',
  [RelationTypes.ROUTE]: '航路',
  [RelationTypes.CONTAINS]: '包含',
  [RelationTypes.CAPITAL_OF]: '首都',
  [RelationTypes.NOTABLE_FOR]: '著名',
  [RelationTypes.ENCLAVE_OF]: '飞地',
  [RelationTypes.MEMBER_OF]: '成员',
  [RelationTypes.PARTICIPATED_IN]: '参与',
  [RelationTypes.ASSOCIATED_WITH]: '关联',
  [RelationTypes.OWNED_BY]: '归属',
  [RelationTypes.OWNS]: '拥有',
  [RelationTypes.CONTROLS]: '控制',
  [RelationTypes.HOSTILE_TO]: '敌对',
  [RelationTypes.ALLIED_WITH]: '同盟',
  [RelationTypes.REFERENCES]: '引用',
  [RelationTypes.INSPIRED_BY]: '启发',
  [RelationTypes.HAPPENS_IN]: '发生于',
  [RelationTypes.CAUSES]: '导致',
  [RelationTypes.PRECEDES]: '先于',
  [RelationTypes.INVOLVED_IN]: '涉及',
  [RelationTypes.OCCURRED_AT]: '发生于',
  [RelationTypes.LOCATED_AT]: '位于',
  [RelationTypes.SPOUSE_OF]: '配偶',
  [RelationTypes.SIBLING_OF]: '兄弟姐妹',
  [RelationTypes.MENTOR_OF]: '师徒',
}

export function getRelationLabel(type: string): string {
  return RelationTypeLabels[type as RelationType] || type
}

/** @deprecated 使用 inverseRegistry 代替 */
export const InverseRelation: Partial<Record<RelationType, RelationType>> = {
  [RelationTypes.PARENT_OF]: RelationTypes.CHILD_OF,
  [RelationTypes.CHILD_OF]: RelationTypes.PARENT_OF,
  [RelationTypes.LOCATED_IN]: RelationTypes.CONTAINS,
  [RelationTypes.CONTAINS]: RelationTypes.LOCATED_IN,
  [RelationTypes.CAPITAL_OF]: RelationTypes.CONTAINS,
  [RelationTypes.OWNS]: RelationTypes.OWNED_BY,
  [RelationTypes.OWNED_BY]: RelationTypes.OWNS,
  [RelationTypes.CONTROLS]: RelationTypes.BELONGS_TO,
  [RelationTypes.BELONGS_TO]: RelationTypes.CONTROLS,
  [RelationTypes.HOSTILE_TO]: RelationTypes.HOSTILE_TO,
  [RelationTypes.ALLIED_WITH]: RelationTypes.ALLIED_WITH,
  [RelationTypes.KNOWS]: RelationTypes.KNOWS,
  [RelationTypes.BORDERS]: RelationTypes.BORDERS,
  [RelationTypes.ROUTE]: RelationTypes.ROUTE,
  [RelationTypes.MEMBER_OF]: RelationTypes.CONTAINS,
  [RelationTypes.ENCLAVE_OF]: RelationTypes.CONTAINS,
  [RelationTypes.REFERENCES]: RelationTypes.REFERENCES,
  [RelationTypes.INSPIRED_BY]: RelationTypes.REFERENCES,
  [RelationTypes.ASSOCIATED_WITH]: RelationTypes.ASSOCIATED_WITH,
  [RelationTypes.PARTICIPATED_IN]: RelationTypes.PARTICIPATED_IN,
  [RelationTypes.HAPPENS_IN]: RelationTypes.LOCATED_IN,
  [RelationTypes.CAUSES]: RelationTypes.CAUSES,
  [RelationTypes.PRECEDES]: RelationTypes.PRECEDES,
  [RelationTypes.NOTABLE_FOR]: RelationTypes.NOTABLE_FOR,
  [RelationTypes.RESIDES_IN]: RelationTypes.LOCATED_IN,
}

import { inverseRegistry } from './inverseRegistry'

inverseRegistry.register(RelationTypes.PARENT_OF, RelationTypes.CHILD_OF)
inverseRegistry.register(RelationTypes.CHILD_OF, RelationTypes.PARENT_OF)
inverseRegistry.register(RelationTypes.LOCATED_IN, RelationTypes.CONTAINS)
inverseRegistry.register(RelationTypes.CONTAINS, RelationTypes.LOCATED_IN)
inverseRegistry.register(RelationTypes.CAPITAL_OF, RelationTypes.CONTAINS)
inverseRegistry.register(RelationTypes.OWNS, RelationTypes.OWNED_BY)
inverseRegistry.register(RelationTypes.OWNED_BY, RelationTypes.OWNS)
inverseRegistry.register(RelationTypes.CONTROLS, RelationTypes.BELONGS_TO)
inverseRegistry.register(RelationTypes.BELONGS_TO, RelationTypes.CONTROLS)
inverseRegistry.register(RelationTypes.HOSTILE_TO, RelationTypes.HOSTILE_TO)
inverseRegistry.register(RelationTypes.ALLIED_WITH, RelationTypes.ALLIED_WITH)
inverseRegistry.register(RelationTypes.KNOWS, RelationTypes.KNOWS)
inverseRegistry.register(RelationTypes.BORDERS, RelationTypes.BORDERS)
inverseRegistry.register(RelationTypes.ROUTE, RelationTypes.ROUTE)
inverseRegistry.register(RelationTypes.MEMBER_OF, RelationTypes.CONTAINS)
inverseRegistry.register(RelationTypes.ENCLAVE_OF, RelationTypes.CONTAINS)
inverseRegistry.register(RelationTypes.REFERENCES, RelationTypes.REFERENCES)
inverseRegistry.register(RelationTypes.INSPIRED_BY, RelationTypes.REFERENCES)
inverseRegistry.register(RelationTypes.ASSOCIATED_WITH, RelationTypes.ASSOCIATED_WITH)
inverseRegistry.register(RelationTypes.PARTICIPATED_IN, RelationTypes.PARTICIPATED_IN)
inverseRegistry.register(RelationTypes.HAPPENS_IN, RelationTypes.LOCATED_IN)
inverseRegistry.register(RelationTypes.CAUSES, RelationTypes.CAUSES)
inverseRegistry.register(RelationTypes.PRECEDES, RelationTypes.PRECEDES)
inverseRegistry.register(RelationTypes.NOTABLE_FOR, RelationTypes.NOTABLE_FOR)
inverseRegistry.register(RelationTypes.RESIDES_IN, RelationTypes.LOCATED_IN)
inverseRegistry.register(RelationTypes.SPOUSE_OF, RelationTypes.SPOUSE_OF)
inverseRegistry.register(RelationTypes.SIBLING_OF, RelationTypes.SIBLING_OF)
inverseRegistry.register(RelationTypes.MENTOR_OF, RelationTypes.MENTOR_OF)

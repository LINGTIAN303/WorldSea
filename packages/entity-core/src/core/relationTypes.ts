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
  INVOLVED_IN: 'involved_in',
  OCCURRED_AT: 'occurred_at',
  LOCATED_AT: 'located_at',
  SPOUSE_OF: 'spouse_of',
  SIBLING_OF: 'sibling_of',
  MENTOR_OF: 'mentor_of',
  CAUSES: 'causes',
  INHABITS: 'inhabits',
  DROPS: 'drops',
  HUNTS: 'hunts',
  TAMES: 'tames',
  BELIEVES_IN: 'believes_in',
  HOLY_SITE: 'holy_site',
  FESTIVAL_OF: 'festival_of',
} as const

export type RelationType = (typeof RelationTypes)[keyof typeof RelationTypes]

// 本文件只保留 `RelationTypes` 常量表（给 `UniversalRelationPanel` 的编辑属性表做键）。
// 关系标签与逆关系查询已收敛到 `RelationshipRegistry`：
// - 标签 → `getRelationLabel`（RelationshipRegistry.ts，读注册表 211 项）
// - 逆关系 → `inverseRegistry`（RelationshipRegistry 的派生视图）
//
// 此处原有三块内容已删除（2026-11-17 关系权威源收敛）：
//   ① `RelationTypeLabels` 静态表（38 项）——是注册表的过期副本，导致 187/211 条标签错误
//   ② `InverseRelation`（@deprecated，无消费方）
//   ③ 42 行手写的 `inverseRegistry.register(...)`——与注册表的 inverseType 冲突 15 条，
//      其中 5 条把非对称关系注册成自指（被当作对称关系处理），会建出源目标相同的反向边

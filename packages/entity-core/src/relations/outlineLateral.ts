/**
 * 节点 ↔ 节点横向关系（2026-10-18 Q3-A 裁定）
 *
 * 与 `relations/index.ts` 里那三条「节点 → 其它芽实体」的关联（`outline_mentions` /
 * `outline_located_in` / `outline_covers`）是**两组独立类型**，勿混：这里的对端也是
 * `outline_node`，语义是结构关系。
 *
 * 呈现纪律：以**节点标记 / 徽章**表达，**不做白板连线**——连线要求位置语义，而白板位置的
 * 真相源是 `order`，画线会重蹈「双写」覆辙（施工分解 §8.3）。
 *
 * 独立成文件的原因：`relations/index.ts` 已处于存量 400 行上限的冻结态（617 行），
 * 新增类型不得继续膨胀该文件（architecture-baseline 只禁增长）。
 */
import { defineRelation } from '../core/RelationshipRegistry'

defineRelation({
  type: 'outline_parallel', label: '并列', inverseType: 'outline_parallel', inverseLabel: '并列',
  sourceTypes: ['outline_node'], targetTypes: ['outline_node'], symmetric: true, domain: 'narrative',
})

defineRelation({
  type: 'outline_progressive', label: '递进', inverseType: 'outline_progressed_from', inverseLabel: '承接',
  sourceTypes: ['outline_node'], targetTypes: ['outline_node'], symmetric: false, domain: 'narrative',
})

defineRelation({
  type: 'outline_contrast', label: '对比', inverseType: 'outline_contrast', inverseLabel: '对比',
  sourceTypes: ['outline_node'], targetTypes: ['outline_node'], symmetric: true, domain: 'narrative',
})

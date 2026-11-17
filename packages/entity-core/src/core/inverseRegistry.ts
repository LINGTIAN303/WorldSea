/**
 * 逆关系查询——**`relationshipRegistry` 的派生视图，不保存独立状态**。
 *
 * 缘起（2026-11-17 关系权威源收敛）：本模块原先自带一个 Map，`relationTypes.ts` 里有
 * 42 行手写注册与它对表。两份数据实测冲突 15 条，其中 6 条把非对称关系注册成自指
 * （`mentor_of` / `participated_in` / `causes` / `references` / `route` / `notable_for`）——
 * `useBidirectional` 读它，于是「双向建边」建出源目标相同的反向边。
 *
 * 现改为纯委托：所有答案都来自 `relationshipRegistry`，不可能再分歧。
 * 保留本模块与现有方法签名，是为了不改 `useBidirectional` / `useEdgeDedup` 的调用面。
 */
import { relationshipRegistry } from './RelationshipRegistry'

/**
 * 兼容层：`register` 为**空实现**。
 *
 * 逆关系只能由 `relationshipRegistry.register(schema)` 的 `inverseType` 决定。
 * 保留空实现而非删方法，是为了让历史调用点在**编译期**继续通过、在**运行期**无效——
 * 若改成抛错，一个遗留调用就能让整棵树装载失败。守卫 `relationAuthority.spec.ts`
 * 会确保没有任何模块依赖本方法产生实际效果。
 */
class InverseRegistryView {
  /** 取逆关系类型；无此关系或无逆类型（自指）时返回其自身，与 `isSymmetric` 自洽 */
  getInverse(type: string): string | undefined {
    const schema = relationshipRegistry.get(type)
    if (!schema) return undefined
    return schema.inverseType || undefined
  }

  /** 对称 = 注册表声明 inverseType 指向自身 */
  isSymmetric(type: string): boolean {
    const schema = relationshipRegistry.get(type)
    return Boolean(schema?.symmetric && schema.inverseType === type)
  }

  hasInverse(type: string): boolean {
    return relationshipRegistry.has(type)
  }

  /** @deprecated 无效操作。逆关系由 `relationshipRegistry` 的 inverseType 决定 */
  register(_type: string, _inverseType: string): void {
    // 刻意空实现，理由见类注释
  }

  /** @deprecated 无效操作。注销请走 `relationshipRegistry.unregister` */
  unregister(_type: string): void {
    // 刻意空实现，理由见类注释
  }

  /** 全量逆关系对（注册表派生） */
  *entries(): IterableIterator<[string, string]> {
    for (const schema of relationshipRegistry.getAll()) {
      if (schema.inverseType) yield [schema.type, schema.inverseType]
    }
  }
}

export const inverseRegistry = new InverseRegistryView()

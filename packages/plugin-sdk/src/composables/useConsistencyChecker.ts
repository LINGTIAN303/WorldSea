/**
 * useConsistencyChecker — 一致性检查 composable（2026-10-02 自 entity-core 迁入）。
 * 职责仅剩「解包 stores/registries → 喂纯函数」：全部检查规则见 consistencyRules.ts
 * （纯函数 + 纯数据入参，单测不依赖 pinia）。迁入原因见该文件头注。
 */

import { ref } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry, relationshipRegistry } from '@worldsea/entity-core'
import type { FieldSchema } from '@worldsea/entity-core'
import { runConsistencyChecks, type ConsistencyIssue } from './consistencyRules'

export type { ConsistencyIssue, ConsistencyCategory, ConsistencySeverity } from './consistencyRules'

export function useConsistencyChecker() {
  const checking = ref(false)
  const issues = ref<ConsistencyIssue[]>([])

  async function runFullCheck(): Promise<ConsistencyIssue[]> {
    checking.value = true
    try {
      const entityStore = useEntityStore()
      const relationStore = useRelationStore()

      // schema 按实体类型归拢：fields + customFields 合并（旧实现漏掉自定义字段的必填/选项检查）
      const schemas = new Map<string, { fields: FieldSchema[] }>()
      for (const schema of entitySchemaRegistry.getAll()) {
        schemas.set(schema.typeKey, { fields: [...(schema.fields || []), ...(schema.customFields || [])] })
      }

      // 已注册关系类型（含用户自定义，relationshipRegistry 自 localStorage 加载）
      const relationTypes = new Map(
        relationshipRegistry.getAll().map(s => [s.type, { label: s.label, sourceTypes: s.sourceTypes, targetTypes: s.targetTypes }]),
      )

      issues.value = runConsistencyChecks({
        entities: entityStore.entities,
        relations: relationStore.relations,
        schemas,
        relationTypes,
      })
      return issues.value
    } finally {
      checking.value = false
    }
  }

  function getIssueCountBySeverity(severity: ConsistencyIssue['severity']): number {
    return issues.value.filter(i => i.severity === severity).length
  }

  return { checking, issues, runFullCheck, getIssueCountBySeverity }
}

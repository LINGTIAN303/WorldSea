import { ref } from 'vue'
import { useEntityStore, useRelationStore, relationSchemaRegistry } from '@worldsea/entity-core'
import { useAgent } from '@/agent/composables/useAgent'
import type { CanvasNode } from './canvasTypes'

export interface Suggestion {
  id: string
  type: 'missing' | 'implicit' | 'contradiction'
  sourceId: string
  sourceName: string
  targetId: string
  targetName: string
  relType: string
  relLabel: string
  reason: string
  confidence: number
}

const MAX_NODES = 60
const MAX_SUGGESTIONS = 20
const CONFIDENCE_THRESHOLD = 0.3

export function useAISuggestions() {
  const suggestions = ref<Suggestion[]>([])
  const isLoading = ref(false)
  const isVisible = ref(false)
  const isAIAnalyzing = ref(false)
  let _abortFlag = false

  async function analyze(nodes: CanvasNode[]): Promise<void> {
    _abortFlag = true
    await new Promise(r => setTimeout(r, 0))
    _abortFlag = false

    isLoading.value = true
    suggestions.value = []

    try {
      const entityStore = useEntityStore()
      const relationStore = useRelationStore()

      const limited = nodes.length > MAX_NODES ? nodes.slice(0, MAX_NODES) : nodes
      const nodeIds = new Set(limited.map(n => n.id))

      const existingPairs = new Set<string>()
      for (const r of relationStore.relations) {
        if (nodeIds.has(r.sourceId) && nodeIds.has(r.targetId)) {
          existingPairs.add(`${r.sourceId}->${r.targetId}`)
          existingPairs.add(`${r.targetId}->${r.sourceId}`)
        }
      }

      const entityMap = new Map(entityStore.entities.map(e => [e.id, e]))

      const nodesByType = new Map<string, CanvasNode[]>()
      for (const n of limited) {
        const arr = nodesByType.get(n.type) || []
        arr.push(n)
        nodesByType.set(n.type, arr)
      }

      const relSchemas = relationSchemaRegistry.getAll()
      const found: Suggestion[] = []
      const suggestedSet = new Set<string>()
      let idCounter = 0

      for (const schema of relSchemas) {
        if (_abortFlag) return

        const srcTypes = schema.sourceTypes
        const tgtTypes = schema.targetTypes

        const srcCandidates = srcTypes.length === 0 || srcTypes.includes('*')
          ? limited
          : srcTypes.flatMap(t => nodesByType.get(t) || [])

        const tgtCandidates = tgtTypes.length === 0 || tgtTypes.includes('*')
          ? limited
          : tgtTypes.flatMap(t => nodesByType.get(t) || [])

        if (srcCandidates.length === 0 || tgtCandidates.length === 0) continue

        for (const srcNode of srcCandidates) {
          if (_abortFlag) return

          for (const tgtNode of tgtCandidates) {
            if (tgtNode.id === srcNode.id) continue

            const dedupeKey = `${srcNode.id}:${tgtNode.id}:${schema.typeKey}`
            if (suggestedSet.has(dedupeKey)) continue

            const pairKey = `${srcNode.id}->${tgtNode.id}`
            if (existingPairs.has(pairKey)) continue

            suggestedSet.add(dedupeKey)

            const srcEntity = entityMap.get(srcNode.id)
            const tgtEntity = entityMap.get(tgtNode.id)

            const confidence = computeConfidence(srcNode, tgtNode, srcEntity, tgtEntity, schema)
            if (confidence < CONFIDENCE_THRESHOLD) continue

            found.push({
              id: `sug-${idCounter++}`,
              type: 'missing',
              sourceId: srcNode.id,
              sourceName: srcNode.name,
              targetId: tgtNode.id,
              targetName: tgtNode.name,
              relType: schema.typeKey,
              relLabel: schema.label || schema.typeKey,
              reason: buildReason(srcNode, tgtNode, schema),
              confidence,
            })

            if (found.length >= MAX_SUGGESTIONS * 3) break
          }
          if (found.length >= MAX_SUGGESTIONS * 3) break
        }

        if (found.length >= MAX_SUGGESTIONS * 3) break

        if (relSchemas.indexOf(schema) % 5 === 0) {
          await new Promise(r => setTimeout(r, 0))
        }
      }

      if (!_abortFlag) {
        found.sort((a, b) => b.confidence - a.confidence)
        suggestions.value = found.slice(0, MAX_SUGGESTIONS)
      }
    } finally {
      if (!_abortFlag) isLoading.value = false
    }
  }

  async function analyzeWithAI(nodes: CanvasNode[]): Promise<void> {
    const agent = useAgent()
    if (!agent.isInitialized.value) {
      await agent.ensureInitialized()
    }
    if (!agent.isInitialized.value) return

    isAIAnalyzing.value = true

    const entityStore = useEntityStore()
    const limited = nodes.length > MAX_NODES ? nodes.slice(0, MAX_NODES) : nodes

    const entitySummaries = limited.map(n => {
      const entity = entityStore.entities.find(e => e.id === n.id)
      const props = entity?.properties || {}
      const propStr = Object.entries(props)
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      return `- ${n.name} (${n.type})${propStr ? ': ' + propStr : ''}`
    }).join('\n')

    const relSchemas = relationSchemaRegistry.getAll()
    const relTypes = relSchemas.map(s => `${s.typeKey}(${s.label}): ${s.sourceTypes.join('/')} → ${s.targetTypes.join('/')}`).join('\n')

    const prompt = `请分析以下世界观实体之间的关系，找出缺失的关系、隐含关系和矛盾。

**当前可见实体：**
${entitySummaries}

**可用关系类型：**
${relTypes}

请执行以下分析：
1. **缺失关系**：实体间应有但未建立的关系（例如角色住在某地但缺少 located_in 关系）
2. **隐含关系**：从已有信息可推导出的关系（例如 A 是 B 的师父 → mentor_of）
3. **矛盾检测**：实体属性间的逻辑矛盾（例如 A 死于某年但参与了更晚的事件）

对每个发现，请用 relation_create 工具直接创建关系（如果确认应该存在），或在回复中说明矛盾。
优先分析高置信度的关系，不要创建不确定的关系。`

    agent.show()
    await agent.sendMessage(prompt)
    isAIAnalyzing.value = false
  }

  async function analyzeSelection(nodes: CanvasNode[], selectedIds: Set<string>): Promise<void> {
    const selected = nodes.filter(n => selectedIds.has(n.id))
    if (selected.length < 2) {
      suggestions.value = []
      return
    }
    await analyze(selected)
  }

  async function analyzeSelectionWithAI(nodes: CanvasNode[], selectedIds: Set<string>): Promise<void> {
    const selected = nodes.filter(n => selectedIds.has(n.id))
    if (selected.length < 2) return
    await analyzeWithAI(selected)
  }

  function dismiss(id: string): void {
    suggestions.value = suggestions.value.filter(s => s.id !== id)
  }

  function clear(): void {
    suggestions.value = []
  }

  function toggle(): void {
    isVisible.value = !isVisible.value
    if (!isVisible.value) {
      _abortFlag = true
      suggestions.value = []
      isLoading.value = false
    }
  }

  return {
    suggestions,
    isLoading,
    isVisible,
    isAIAnalyzing,
    analyze,
    analyzeWithAI,
    analyzeSelection,
    analyzeSelectionWithAI,
    dismiss,
    clear,
    toggle,
  }
}

function computeConfidence(
  srcNode: CanvasNode,
  tgtNode: CanvasNode,
  srcEntity: { type: string; tags?: string[]; description?: string } | undefined,
  tgtEntity: { type: string; tags?: string[]; description?: string } | undefined,
  schema: { typeKey: string; sourceTypes: string[]; targetTypes: string[] },
): number {
  let score = 0

  if (schema.sourceTypes.includes(srcNode.type) || schema.sourceTypes.includes('*')) score += 0.4
  if (schema.targetTypes.includes(tgtNode.type) || schema.targetTypes.includes('*')) score += 0.4

  if (srcEntity?.tags && tgtEntity?.tags) {
    const commonTags = srcEntity.tags.filter(t => tgtEntity!.tags!.includes(t))
    score += Math.min(commonTags.length * 0.1, 0.2)
  }

  const highValueTypes = ['member_of', 'located_in', 'participated_in', 'occurred_at', 'ally_of', 'enemy_of', 'parent_of', 'child_of']
  if (highValueTypes.includes(schema.typeKey)) score += 0.1

  return Math.min(score, 1)
}

function buildReason(
  srcNode: CanvasNode,
  tgtNode: CanvasNode,
  schema: { typeKey: string; label: string; sourceTypes: string[]; targetTypes: string[] },
): string {
  const srcLabel = srcNode.name
  const tgtLabel = tgtNode.name
  const relLabel = schema.label || schema.typeKey
  return `"${srcLabel}"(${srcNode.type}) 与 "${tgtLabel}"(${tgtNode.type}) 之间可能存在 "${relLabel}" 关系`
}

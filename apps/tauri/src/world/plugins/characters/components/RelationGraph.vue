<template>
  <div class="relation-graph">
    <WsEmpty v-if="noRelations" preset="no-data" title="暂无社交关系数据" />
    <div v-else ref="containerRef" class="rg-canvas"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed, watch } from 'vue'
import { WsEmpty } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { deduplicateEdges, useSmallCanvasGraph, type SGNode, type SGEdge } from '@worldsea/ui-kit'

const props = defineProps<{ characterId: string }>()
const emit = defineEmits<{ navigate: [id: string] }>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const containerRef = ref<HTMLDivElement | null>(null)

const CHARACTER_REL_TYPES = ['parent_of', 'knows', 'ally_of', 'rival_of']

const REL_STYLE: Record<string, { color: string; dashed: boolean; label: string }> = {
  parent_of: { color: '#4a90d9', dashed: false, label: '父母/子女' },
  knows: { color: '#999', dashed: true, label: '认识' },
  ally_of: { color: '#4caf50', dashed: false, label: '盟友' },
  rival_of: { color: '#e74c3c', dashed: true, label: '敌对' },
}

const graph = useSmallCanvasGraph(containerRef, {
  onNodeClick(node) {
    if (node.id && node.id !== props.characterId) {
      emit('navigate', node.id)
    }
  },
  onNodeHover(node) {
    graph.selectedNodeId.value = node?.id ?? null
  },
  onBackgroundClick() {
    graph.selectedNodeId.value = null
  },
})

const allCharacters = computed(() => entityStore.entities.filter(e => e.type === 'character'))
const noRelations = computed(() => {
  const rels = relationStore.relations.filter(r =>
    CHARACTER_REL_TYPES.includes(r.type) &&
    (r.sourceId === props.characterId || r.targetId === props.characterId)
  )
  return rels.length === 0
})

onMounted(() => {
  nextTick(() => { graph.init(); buildGraph() })
})

watch(() => props.characterId, () => {
  nextTick(() => buildGraph())
})

function buildGraph(): void {
  const visited = new Set<string>()
  const nodeMap = new Map<string, SGNode>()
  const sgEdges: SGEdge[] = []

  function addCharacter(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const char = allCharacters.value.find(c => c.id === id)
    if (!char) return
    const isCenter = id === props.characterId
    nodeMap.set(id, {
      id,
      label: char.name,
      color: isCenter ? '#7c3aed' : '#6b7280',
      size: isCenter ? 21 : 16,
      borderColor: isCenter ? '#fff' : '#ddd',
      borderWidth: isCenter ? 3 : 1,
      isCenter,
    })
  }

  addCharacter(props.characterId)

  const charRels = relationStore.relations.filter(r =>
    CHARACTER_REL_TYPES.includes(r.type) &&
    (r.sourceId === props.characterId || r.targetId === props.characterId)
  )

  const merged = deduplicateEdges(charRels, (type) => {
    const style = REL_STYLE[type] || { label: type }
    return style.label
  })

  for (const me of merged) {
    const otherId = me.source === props.characterId ? me.target : me.source
    addCharacter(otherId)
    const style = REL_STYLE[me.relType] || { color: '#ccc', dashed: false, label: me.relType }
    sgEdges.push({
      id: me.id,
      source: me.source,
      target: me.target,
      color: style.color,
      width: 2,
      dashed: style.dashed,
      label: me.relLabel,
      arrow: !me.symmetric,
      bidirectional: me.bidirectional && !me.symmetric,
    })
  }

  graph.setData(Array.from(nodeMap.values()), sgEdges, 'radial')
}
</script>

<style scoped>
.relation-graph { height: 320px; }
.rg-loading { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-tertiary); font-size: var(--font-size-sm); }
.rg-canvas { width: 100%; height: 320px; background: var(--card-bg); border-radius: var(--radius-md); }
</style>


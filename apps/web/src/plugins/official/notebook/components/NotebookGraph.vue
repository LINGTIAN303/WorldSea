<template>
  <div class="nb-graph">
    <div v-if="noEdges" class="nb-graph-placeholder">
      <div class="nb-gp-icon"><WsIcon name="link" size="xl" /></div>
      <div class="nb-gp-text">知识图谱</div>
      <div class="nb-gp-desc">创建笔记间链接以在此查看</div>
    </div>
    <div v-else ref="containerRef" class="ng-canvas"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useRelationStore, useEntityStore } from '@worldsmith/entity-core'
import type { Relation } from '@worldsmith/entity-core'
import { useSmallCanvasGraph, type SGNode, type SGEdge } from '@worldsmith/ui-kit'
import type { NotebookEntity } from '../types'

const props = defineProps<{ notes: NotebookEntity[] }>()
const emit = defineEmits<{ select: [id: string] }>()

const relationStore = useRelationStore()
const entityStore = useEntityStore()
const containerRef = ref<HTMLDivElement | null>(null)

const noteLinkRels = computed(() =>
  relationStore.relations.filter((r: Relation) => r.type === 'note_link')
)

const noEdges = computed(() => noteLinkRels.value.length === 0)

const allNotes = computed(() =>
  entityStore.entities.filter((e): e is NotebookEntity => e.type === 'notebook')
)

const graph = useSmallCanvasGraph(containerRef, {
  onNodeClick(node) {
    if (node.id) emit('select', node.id)
  },
})

onMounted(() => {
  nextTick(() => { graph.init(); buildGraph() })
})

watch(() => props.notes.length, () => {
  nextTick(() => buildGraph())
})

watch(() => noteLinkRels.value.length, () => {
  nextTick(() => buildGraph())
})

function buildGraph(): void {
  const nodeMap = new Map<string, SGNode>()

  function addNote(id: string) {
    if (nodeMap.has(id)) return
    const note = allNotes.value.find(n => n.id === id)
    if (!note) return
    nodeMap.set(id, {
      id,
      label: note.name || '未命名',
      color: '#7c3aed',
      size: 16,
    })
  }

  for (const rel of noteLinkRels.value) {
    addNote(rel.sourceId)
    addNote(rel.targetId)
  }

  const sgEdges: SGEdge[] = noteLinkRels.value.map(rel => ({
    id: rel.id,
    source: rel.sourceId,
    target: rel.targetId,
    color: '#9ca3af',
    width: 1.5,
    arrow: true,
    bidirectional: true,
  }))

  graph.setData(Array.from(nodeMap.values()), sgEdges, 'force')
}
</script>

<style scoped>
.nb-graph { height: 100%; background: var(--color-bg-base); }
.ng-canvas { width: 100%; height: 100%; }
.nb-graph-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
.nb-gp-icon { color: var(--color-text-tertiary); margin-bottom: 12px; }
.nb-gp-text { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: 4px; }
.nb-gp-desc { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
</style>

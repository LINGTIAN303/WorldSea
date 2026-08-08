<template>
  <div class="relation-graph-renderer" ref="containerRef">
    <WsEmpty v-if="displayList.length === 0" preset="no-data" title="暂无关系数据" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, inject } from 'vue'
import { WsEmpty } from '@worldsmith/ui-kit'
import Graph from 'graphology'
import Sigma from 'sigma'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const containerRef = ref<HTMLDivElement>()
let sigma: Sigma | null = null
let graph: Graph | null = null

const displayList = computed(() => ctx?.filteredList.value || [])

function buildGraph() {
  if (!containerRef.value) return
  if (sigma) { sigma.kill() } sigma = null
  if (graph) { graph.clear() } else { graph = new Graph() }

  const entities = displayList.value
  const nodeColors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316']

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]
    graph.addNode(e.id, {
      label: e.name || '(未命名)',
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 10,
      color: nodeColors[i % nodeColors.length],
    })
  }

  const relationType = props.config.relationType as string
  if (relationType && entities.length > 1) {
    for (let i = 0; i < entities.length - 1; i++) {
      const source = entities[i].id
      const target = entities[i + 1].id
      graph.addEdge(source, target, { label: relationType, color: '#999' })
    }
  }

  sigma = new Sigma(graph, containerRef.value, {
    renderLabels: true,
    labelRenderedSizeThreshold: 6,
    defaultEdgeColor: '#999',
  })
}

onMounted(() => {
  buildGraph()
})

onBeforeUnmount(() => {
  sigma?.kill()
  sigma = null
  graph = null
})

// displayList 是 computed，依赖变化返回新数组引用，浅监听即可，deep 冗余
watch(displayList, buildGraph)
</script>

<style scoped>
.relation-graph-renderer { width: 100%; height: 100%; min-height: 250px; position: relative; }
</style>

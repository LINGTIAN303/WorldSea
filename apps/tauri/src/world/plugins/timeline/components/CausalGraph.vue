<template>
  <div class="causal-graph-wrapper">
    <div class="cg-toolbar">
      <span class="cg-help">因果链可视化 · 点击节点可跳转</span>
      <TuiButton variant="secondary" size="sm" @click="toggleExpand">
        {{ expanded ? '收起' : '展开全部' }}
      </TuiButton>
    </div>
    <div ref="graphRef" class="causal-graph"></div>
    <WsEmpty v-if="chainCount === 0" preset="no-data" title="暂无因果链" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { TuiButton, WsEmpty  } from '@worldsea/ui-kit'
import type { Entity, Relation } from '@worldsea/entity-core'
import { useSmallCanvasGraph, type SGNode, type SGEdge } from '@worldsea/ui-kit'

const props = defineProps<{
  event: Entity | null
  events: Entity[]
  relations: Relation[]
}>()

const emit = defineEmits<{
  navigateToEvent: [id: string]
}>()

const graphRef = ref<HTMLDivElement>()
const expanded = ref(false)

const graph = useSmallCanvasGraph(graphRef as any, {
  onNodeClick(node) {
    if (node.id) emit('navigateToEvent', node.id)
  },
})

const chainCount = computed(() => {
  const event = props.event
  if (!event) return 0
  return props.relations.filter(r =>
    (r.type === 'causes' || r.type === 'caused_by' || r.type === 'parallel_to') &&
    (r.sourceId === event.id || r.targetId === event.id)
  ).length
})

function buildGraph(): void {
  if (!props.event) return

  // canvas 无法用 CSS 变量：绘制前从 computed 令牌取强调色（跟随设置切换，兜底靛蓝基准）
  const styles = getComputedStyle(document.documentElement)
  const accentColor = styles.getPropertyValue('--accent').trim() || '#4f46e5'
  const accentBorder = styles.getPropertyValue('--accent-soft-border').trim() || '#818cf8'

  const visited = new Set<string>()
  const nodeMap = new Map<string, SGNode>()
  const sgEdges: SGEdge[] = []
  const maxDepth = expanded.value ? 10 : 2

  function traverse(id: string, depth: number) {
    if (depth > maxDepth || visited.has(id)) return
    visited.add(id)
    const evt = props.events.find(e => e.id === id)
    if (!evt) return

    const isCenter = id === props.event?.id
    nodeMap.set(id, {
      id,
      label: evt.name,
      color: isCenter ? '#ef4444' : accentColor,
      size: isCenter ? 19 : 15,
      borderColor: isCenter ? '#fca5a5' : accentBorder,
      borderWidth: isCenter ? 3 : 1,
      date: (evt.properties.date as string) || '',
      isCenter,
    })

    const rels = props.relations.filter(r =>
      (r.type === 'causes' || r.type === 'caused_by' || r.type === 'parallel_to') &&
      (r.sourceId === id || r.targetId === id)
    )

    for (const rel of rels) {
      const edgeLabel = rel.type === 'parallel_to' ? '并行' :
        rel.sourceId === id ? '导致' : '被引发'
      const isParallel = rel.type === 'parallel_to'
      sgEdges.push({
        id: rel.id,
        source: rel.sourceId,
        target: rel.targetId,
        color: isParallel ? '#94a3b8' : '#aaa',
        width: 1.5,
        dashed: isParallel,
        label: edgeLabel,
        arrow: !isParallel,
        bidirectional: false,
      })
      const otherId = rel.sourceId === id ? rel.targetId : rel.sourceId
      traverse(otherId, depth + 1)
    }
  }

  traverse(props.event.id, 0)
  graph.setData(Array.from(nodeMap.values()), sgEdges, 'tree')
}

function toggleExpand() {
  expanded.value = !expanded.value
}

watch(() => [props.event, expanded.value], async () => {
  await nextTick()
  buildGraph()
}, { immediate: false })

watch(() => props.event, async () => {
  expanded.value = false
  await nextTick()
  if (!graphRef.value) return
  graph.init()
  buildGraph()
}, { immediate: true })
</script>

<style scoped>
.causal-graph-wrapper {
  display: flex;
  flex-direction: column;
}
.cg-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.cg-help {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
.causal-graph {
  width: 100%;
  height: 320px;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}
</style>

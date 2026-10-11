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
import { WsIcon } from '@worldsea/ui-kit'
import { useRelationStore, useEntityStore } from '@worldsea/entity-core'
import type { Relation } from '@worldsea/entity-core'
import { useSmallCanvasGraph, type SGNode, type SGEdge } from '@worldsea/ui-kit'
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

/**
 * 把主题令牌解析为具体色值。
 *
 * canvas 的 fillStyle / strokeStyle **不接受** `var(--token)` 字符串（底层 useSmallCanvasGraph
 * 内部的 `'var(--text-color, #333)'` 就是一条无效写法，会被浏览器忽略），因此必须在绘制前
 * 取出令牌实值。自定义属性可继承，从画布容器上读即可拿到当前两轴（底色 × 强调色）的值。
 * 与思维导图导出 PNG 时注入 computed 变量是同一套路。
 */
function resolveToken(name: string, fallback: string): string {
  const el = containerRef.value
  if (!el || typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

function buildGraph(): void {
  // 节点色随强调色轴、连线色随次级文字色 —— 换强调色后重建即跟随，不再写死
  const nodeColor = resolveToken('--accent', '#7c3aed')
  const edgeColor = resolveToken('--text-secondary', '#9ca3af')
  const nodeMap = new Map<string, SGNode>()

  function addNote(id: string) {
    if (nodeMap.has(id)) return
    const note = allNotes.value.find(n => n.id === id)
    if (!note) return
    nodeMap.set(id, {
      id,
      label: note.name || '未命名',
      color: nodeColor,
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
    color: edgeColor,
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

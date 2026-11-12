<template>
  <div class="relation-graph">
    <div
      ref="containerRef"
      class="rg-canvas"
      :class="{ 'is-hidden': graphLoaded && noRelations }"
      :inert="relLoading || undefined"
    ></div>
    <WsLoadingOverlay
      :show="relLoading"
      scope="panel"
      title="正在载入关系图"
      success-title="关系图已就绪"
      error-title="关系图载入失败"
      :stages="REL_LOAD_STAGES"
      :current="relStage"
      :status="relStatus"
      :error="relError ?? ''"
      error-text="无法绘制社交关系"
      :closable="false"
      @retry="initializeRelationGraph"
    />
    <div v-if="graphLoaded && noRelations" class="rg-empty">
      <WsEmpty preset="no-data" title="暂无社交关系数据" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed, watch } from 'vue'
import { WsEmpty, WsLoadingOverlay, useAsyncTask, type LoadingStage, type LoadingStatus } from '@worldsea/ui-kit'
import { entitiesSvc, relationsSvc } from '../serviceAccess'
import { deduplicateEdges, useSmallCanvasGraph, type SGNode, type SGEdge } from '@worldsea/ui-kit'

const props = defineProps<{ characterId: string }>()
const emit = defineEmits<{ navigate: [id: string] }>()

const entities = entitiesSvc()
const relations = relationsSvc()
const containerRef = ref<HTMLDivElement | null>(null)

const REL_LOAD_STAGES: LoadingStage[] = [
  { short: '关系', full: '读取社交关系' },
  { short: '关系网', full: '绘制关系网络' },
]
const { visible: relLoading, status: relLoadStatus, error: relError, run: runRelLoad } = useAsyncTask({ successHold: 0 })
const relStage = ref(0)
const graphLoaded = ref(false)
const relStatus = computed<LoadingStatus>(() => {
  if (relLoadStatus.value === 'error') return 'error'
  if (relLoadStatus.value === 'success' || relLoadStatus.value === 'empty') return 'success'
  return 'loading'
})
let graphInited = false

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

const allCharacters = computed(() => entities.list().filter(e => e.type === 'character'))
const noRelations = computed(() => {
  const rels = relations.list().filter(r =>
    CHARACTER_REL_TYPES.includes(r.type) &&
    (r.sourceId === props.characterId || r.targetId === props.characterId)
  )
  return rels.length === 0
})

async function initializeRelationGraph(): Promise<void> {
  try {
    await runRelLoad(async () => {
      relStage.value = 0
      await nextTick()
      relStage.value = 1
      if (!graphInited) {
        graph.init()
        graphInited = true
      }
      buildGraph()
      graphLoaded.value = true
      await nextTick()
    })
  } catch (err) {
    console.warn('[RelationGraph]', err)
  }
}

onMounted(() => { void initializeRelationGraph() })

watch(() => props.characterId, () => {
  nextTick(() => { if (graphLoaded.value) buildGraph() })
})

function buildGraph(): void {
  // canvas 无法用 CSS 变量：绘制前从 computed 令牌取强调色（跟随设置切换，兜底靛蓝基准）
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5'
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
      color: isCenter ? accentColor : '#6b7280',
      size: isCenter ? 21 : 16,
      borderColor: isCenter ? '#fff' : '#ddd',
      borderWidth: isCenter ? 3 : 1,
      isCenter,
    })
  }

  addCharacter(props.characterId)

  const charRels = relations.list().filter(r =>
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
.relation-graph { position: relative; height: 320px; }
.rg-canvas { width: 100%; height: 320px; background: var(--card-bg); border-radius: var(--radius-md); }
.rg-canvas.is-hidden { visibility: hidden; }
.rg-empty { position: absolute; inset: 0; display: grid; place-items: center; }
</style>


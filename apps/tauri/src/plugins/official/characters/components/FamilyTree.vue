<template>
  <div class="family-tree" ref="treeContainer">
    <div v-if="loading" class="ft-loading">加载中...</div>
    <div v-else ref="containerRef" class="ft-canvas" @contextmenu.prevent></div>
    <WsEmpty v-if="!loading && noRelations" preset="no-data" description="暂无家族关系数据，右键空白处添加家族成员" />
    <FamilyNodeCard
      :visible="cardVisible"
      :character-id="cardCharId"
      :x="cardX"
      :y="cardY"
      @edit-relation="onEditRelation"
      @view-detail="onViewDetail"
    />
    <FamilyContextMenu
      :visible="menuVisible"
      :x="menuX"
      :y="menuY"
      @action="onMenuAction"
      @close="menuVisible = false"
    />
    <FamilyAddDialog
      :visible="addDialogVisible"
      :title="addDialogTitle"
      :relation-type="addDialogRelType"
      :exclude-ids="addDialogExcludeIds"
      @close="addDialogVisible = false"
      @confirm="onAddConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import { WsEmpty } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { useBidirectional, deduplicateEdges, useSmallCanvasGraph, type SGNode, type SGEdge } from '@worldsmith/ui-kit'
import FamilyNodeCard from './FamilyNodeCard.vue'
import FamilyContextMenu from './FamilyContextMenu.vue'
import FamilyAddDialog from './FamilyAddDialog.vue'

const FAMILY_REL_TYPES = ['parent_of', 'child_of', 'spouse_of', 'sibling_of', 'mentor_of']
const MAX_HOPS = 3

const EDGE_COLORS: Record<string, string> = {
  parent_of: '#c0c0c0',
  spouse_of: '#e879a0',
  sibling_of: '#4a90d9',
  mentor_of: '#9b59b6',
}

const props = defineProps<{ characterId: string }>()
const emit = defineEmits<{
  navigate: [id: string]
  switchToProfile: []
}>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { createBidirectional, deleteWithConfirm } = useBidirectional()

const containerRef = ref<HTMLDivElement>()
const loading = ref(true)

const graph = useSmallCanvasGraph(containerRef as any, {
  onNodeClick(node, sx, sy) {
    if (node.id === props.characterId) return
    cardCharId.value = node.id
    cardX.value = sx
    cardY.value = sy
    cardVisible.value = true
    menuVisible.value = false
  },
  onNodeDoubleClick(node) {
    if (node.id) emit('navigate', node.id)
  },
  onNodeRightClick(node, sx, sy) {
    menuTargetId.value = node.id
    menuX.value = sx
    menuY.value = sy
    cardVisible.value = false
    menuVisible.value = true
  },
  onNodeHover(node) {
    if (node) {
      cardCharId.value = node.id
      cardVisible.value = true
      menuVisible.value = false
    } else {
      cardVisible.value = false
    }
  },
  onBackgroundClick() {
    cardVisible.value = false
    menuVisible.value = false
  },
  onNodeDragEnd(node) {
    const draggedId = node.id
    for (const n of graph.nodes.value) {
      if (n.id === draggedId || n.x == null || n.y == null) continue
      const dx = n.x - node.x!
      const dy = n.y - node.y!
      if (Math.sqrt(dx * dx + dy * dy) < 30) {
        menuTargetId.value = n.id
        const dragChar = allCharacters.value.find(c => c.id === draggedId)
        const targetChar = allCharacters.value.find(c => c.id === n.id)
        addDialogTitle.value = `建立 ${dragChar?.name || ''} → ${targetChar?.name || ''} 的关系`
        addDialogRelType.value = ''
        addDialogExcludeIds.value = [draggedId, n.id]
        addDialogVisible.value = true
        break
      }
    }
  },
})

const cardVisible = ref(false)
const cardCharId = ref('')
const cardX = ref(0)
const cardY = ref(0)

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTargetId = ref('')

const addDialogVisible = ref(false)
const addDialogTitle = ref('')
const addDialogRelType = ref('')
const addDialogExcludeIds = ref<string[]>([])

const allCharacters = computed(() => entityStore.entities.filter(e => e.type === 'character'))

const familyRels = computed(() =>
  relationStore.relations.filter(r => FAMILY_REL_TYPES.includes(r.type))
)

const noRelations = computed(() => {
  return !familyRels.value.some(r => r.sourceId === props.characterId || r.targetId === props.characterId)
})

onMounted(async () => {
  try {
    await entityStore.loadAll()
    await relationStore.loadAll()
    loading.value = false
    await nextTick()
    graph.init()
    buildGraph()
  } catch (err) {
    console.warn('[FamilyTree]', err)
  }
})

function buildGraph(): void {
  const visited = new Set<string>()
  const nodeMap = new Map<string, SGNode>()

  function traverse(id: string, depth: number) {
    if (depth > MAX_HOPS || visited.has(id)) return
    visited.add(id)

    const char = allCharacters.value.find(c => c.id === id)
    if (!char) return

    const gender = char.properties?.gender as string || ''
    let color = '#a0a0a0'
    if (gender === '男' || gender === '雄') color = '#4a90d9'
    else if (gender === '女' || gender === '雌') color = '#e879a0'

    nodeMap.set(id, {
      id,
      label: char.name,
      color,
      size: 18,
      borderColor: id === props.characterId ? '#f5a623' : '#fff',
      borderWidth: id === props.characterId ? 3 : 2,
      gender,
      isCurrent: id === props.characterId,
    })

    const rels = familyRels.value.filter(r => r.sourceId === id || r.targetId === id)
    for (const rel of rels) {
      const otherId = rel.sourceId === id ? rel.targetId : rel.sourceId
      traverse(otherId, depth + 1)
    }
  }

  traverse(props.characterId, 0)

  const visibleIds = new Set(nodeMap.keys())
  const rels = familyRels.value.filter(r => visibleIds.has(r.sourceId) && visibleIds.has(r.targetId))
  const merged = deduplicateEdges(rels, (type) => type)

  const sgEdges: SGEdge[] = merged.map(me => {
    const relType = me.relType
    const isBiological = relType === 'parent_of'
    return {
      id: me.id,
      source: me.source,
      target: me.target,
      color: EDGE_COLORS[relType] || '#c0c0c0',
      width: relType === 'spouse_of' ? 3 : 2,
      dashed: relType === 'mentor_of',
      label: '',
      arrow: !me.symmetric && (relType === 'parent_of' || relType === 'mentor_of'),
      bidirectional: me.bidirectional && !me.symmetric,
      relType: me.relType,
      isBiological,
    }
  })

  graph.setData(Array.from(nodeMap.values()), sgEdges, 'tree')
}

function onEditRelation(_id: string) {
  cardVisible.value = false
  emit('switchToProfile')
}

function onViewDetail(id: string) {
  cardVisible.value = false
  emit('navigate', id)
}

function onMenuAction(action: string) {
  menuVisible.value = false
  const targetId = menuTargetId.value
  const currentId = props.characterId

  const actionMap: Record<string, { title: string; relType: string; source: string; target: string }> = {
    addParent: { title: '添加父母', relType: 'parent_of', source: targetId, target: currentId },
    addChild: { title: '添加子女', relType: 'parent_of', source: currentId, target: targetId },
    addSpouse: { title: '添加配偶', relType: 'spouse_of', source: currentId, target: targetId },
    addSibling: { title: '添加兄弟姐妹', relType: 'sibling_of', source: currentId, target: targetId },
    addMentor: { title: '添加师徒关系', relType: 'mentor_of', source: targetId, target: currentId },
  }

  if (action === 'deleteRelation') {
    handleDeleteRelation(targetId)
    return
  }

  const cfg = actionMap[action]
  if (!cfg) return

  addDialogTitle.value = cfg.title
  addDialogRelType.value = cfg.relType
  addDialogExcludeIds.value = [currentId]
  addDialogVisible.value = true
}

async function handleDeleteRelation(targetId: string) {
  const rels = familyRels.value.filter(r =>
    (r.sourceId === props.characterId && r.targetId === targetId) ||
    (r.targetId === props.characterId && r.sourceId === targetId)
  )
  for (const rel of rels) {
    await deleteWithConfirm(rel.id)
  }
  buildGraph()
}

async function onAddConfirm(payload: { entityId: string; isNew: boolean; name?: string; gender?: string }) {
  let targetEntityId = payload.entityId

  if (payload.isNew) {
    const newId = await entityStore.add({
      id: crypto.randomUUID(),
      type: 'character',
      name: payload.name || '未命名',
      description: '',
      tags: [],
      properties: { gender: payload.gender || '' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    targetEntityId = newId
  }

  if (targetEntityId && addDialogRelType.value) {
    await createBidirectional({
      type: addDialogRelType.value,
      sourceId: props.characterId,
      targetId: targetEntityId,
    })
  }

  addDialogVisible.value = false
  buildGraph()
}
</script>

<style scoped>
.family-tree { position: relative; height: 300px; }
.ft-loading { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-tertiary); font-size: var(--font-size-sm); }
.ft-canvas { width: 100%; height: 300px; background: var(--card-bg); border-radius: var(--radius-md); }
</style>


<template>
  <GenericEntityView
    entityType="outline_node"
    :form-fields="formFields"
    :filter-defs="filterDefs"
    :custom-tabs="customTabs"
    :detail-tabs="detailTabs"
    :icon-fn="() => 'list'"
    entity-label="大纲节点"
    id-prefix="otl"
    :hide-create-button="true"
    >
    <!-- 工具栏额外按钮 -->
    <template #toolbar-extra>
      <CreateButton label="新建卷/章" @click="addRootNode" />
      <CustomDropdown v-model="activeTab" :options="activeTabOptions" />
      <span class="toolbar-count">共 {{ flatNodes.length }} 个节点</span>
    </template>

    <!-- 自定义列表：树状视图 / 情节线索 / 进度总览 -->
    <template #list="{ select: selectEntity }">
      <div v-if="activeTab === 'tree'" class="outline-tree-area">
        <div class="tree-container">
          <WsEmpty v-if="treeData.length === 0" preset="no-data" title="空大纲" description="点击上方按钮创建第一个章节" />
          <GenericTreeView
            v-for="node in treeData"
            :key="node.entity.id"
            :node="node"
            :depth="0"
            :selected-id="selectedNodeId ?? undefined"
            :expanded-ids="expandedIds"
            @select="(e: Entity) => { onTreeSelect(e); selectEntity(e); }"
            @add-child="addChildNode"
            @move-node="onMoveNode"
            @toggle-expand="onToggleExpand"
          >
            <template #icon="{ entity }">{{ nodeIcon(entity) }}</template>
            <template #typeLabel="{ entity }">{{ statusLabel(entity) }}</template>
            <template #actions="{ entity }">
              <button class="tree-add-btn" @click.stop="addChildNode(entity)" title="添加子节点">＋</button>
              <button class="tree-del-btn" @click.stop="deleteNode(entity.id)" title="删除">✕</button>
            </template>
            <template #entityLinks="{ entity }">
              <div class="entity-links-area" v-if="getInlineBadges(entity.id).length > 0">
                <div class="entity-badges">
                  <span v-for="badge in getInlineBadges(entity.id)" :key="badge.type"
                    class="entity-badge" :style="{ '--badge-color': badge.color }"
                    @click.stop>
                    {{ badge.icon }}×{{ badge.count }}
                  </span>
                  <button v-if="getExpandedCards(entity.id).length > 0"
                    class="entity-toggle-btn"
                    @click.stop="toggleEntityLinks(entity.id)">
                    {{ entityLinksCollapsed.has(entity.id) ? '展开' : '收起' }}关联
                  </button>
                </div>
                <div v-if="!entityLinksCollapsed.has(entity.id)" class="entity-cards">
                  <div v-for="group in getExpandedCards(entity.id)" :key="group.type" class="entity-group">
                    <span class="entity-group-label" :style="{ color: group.color }">
                      {{ group.icon }} {{ group.label }}
                    </span>
                    <div class="entity-group-items">
                      <span v-for="card in group.entities" :key="card.id"
                        class="entity-card" :style="{ borderColor: card.color + '40' }"
                        role="button"
                        tabindex="0"
                        @click.stop="navigateToEntity(card.id)"
                        @keydown.enter.stop="navigateToEntity(card.id)"
                      >
                        {{ card.icon }} {{ card.name }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </GenericTreeView>
        </div>
      </div>

      <div v-if="activeTab === 'storylines'" class="storyline-view">
        <div v-for="line in storylines" :key="line" class="storyline-row">
          <span class="sl-name">{{ line }}</span>
          <span class="sl-count">{{ nodesByLine(line, flatNodes).length }} 个节点</span>
          <div class="sl-nodes">
            <span v-for="n in nodesByLine(line, flatNodes)" :key="n.id"
              class="sl-tag" @click="switchToTree(n, selectEntity)">{{ n.name }}</span>
            <span v-if="nodesByLine(line, flatNodes).length===0" class="sl-empty">暂无节点</span>
          </div>
        </div>
        <WsEmpty v-if="storylines.length === 0" preset="no-data" title="暂无线索" description="在节点的&quot;所属线索&quot;字段中添加线索名称" />
      </div>

      <div v-if="activeTab === 'progress'" class="progress-view">
        <div class="progress-stats">
          <div class="stat-card"><span class="stat-num">{{ flatNodes.length }}</span><span class="stat-label">总节点</span></div>
          <div class="stat-card"><span class="stat-num">{{ totalWordCount }}</span><span class="stat-label">总字数</span></div>
          <div class="stat-card"><span class="stat-num">{{ progressPercent }}%</span><span class="stat-label">完成度</span></div>
        </div>
        <div class="progress-bar-wrap"><div class="progress-bar" :style="{width:progressPercent+'%'}"></div></div>
        <div v-for="line in storylines" :key="line" class="progress-line">
          <span class="pl-name">{{ line }}</span>
          <span class="pl-count">{{ nodesByLine(line, flatNodes).length }} 节点 / {{ lineWordCount(line, flatNodes) }} 字</span>
        </div>
      </div>
    </template>

    <!-- 详情面板头部 -->
    <template #detail-header="{ entity }">
      <span class="detail-icon">{{ nodeIcon(entity) }}</span>
      <div>
        <h2>{{ entity.name }}</h2>
        <p class="detail-type">{{ statusLabel(entity) }}</p>
      </div>
    </template>

    <!-- 详情面板信息区 -->
    <template #detail-info="{ entity, editing, editForm: gevEditForm }">
      <DetailField v-if="editing" label="名称" :value="entity.name" :editing="true" type="text" @update:value="gevEditForm._name=$event" />

      <div class="detail-entity-summary" v-if="getDetailSummary(entity.id).length > 0">
        <div v-for="group in getDetailSummary(entity.id)" :key="group.type" class="des-group">
          <span class="des-group-label" :style="{ color: group.color }">{{ group.icon }} {{ group.label }}</span>
          <div class="des-group-items">
            <span v-for="card in group.entities" :key="card.id"
              class="des-entity" @click="navigateToEntity(card.id)">
              {{ card.name }}
            </span>
          </div>
        </div>
      </div>

      <div class="detail-fields">
        <DetailField label="状态" :value="entity.properties.status as string||'未写'" :editing="editing" type="select" :options="['未写','草稿','完成']" @update:value="gevEditForm.status=$event" />
        <DetailField label="排序" :value="entity.properties.order as string||''" :editing="editing" type="text" @update:value="gevEditForm.order=$event" />
        <DetailField label="字数" :value="entity.properties.wordCount as string||'0'" :editing="editing" type="text" @update:value="gevEditForm.wordCount=$event" />
        <DetailField label="所属线索" :value="entity.properties.storylines as string||''" :editing="editing" type="text" :compact="false" placeholder="用逗号分隔" @update:value="gevEditForm.storylines=$event" />
        <DetailField label="摘要/梗概" :value="entity.properties.summary as string||''" :editing="editing" type="textarea" @update:value="gevEditForm.summary=$event" />
        <DetailField label="关联章节" :value="entity.properties.manuscriptId as string||''" :editing="editing" type="text" @update:value="gevEditForm.manuscriptId=$event" />
      </div>

      <button v-if="entity.properties.manuscriptId && !editing"
        class="btn-primary btn-sm" style="margin: 8px 0" @click="navigateToManuscript(entity.properties.manuscriptId as string)">
        跳转到正文
      </button>

      <DetailField label="详细描述" :value="entity.description" :editing="editing" type="textarea" @update:value="gevEditForm._description=$event" />
      <DynamicFieldsAdder entity-type="outline_node" :model-value="gevEditForm" @update:model-value="Object.assign(gevEditForm, $event)" :field-defs="customFieldDefs" @update:field-defs="customFieldDefs=$event" />

      <div v-if="settings.outlineInlineEdit && !editing" class="detail-inline-edit">
        <div v-if="entity.properties.manuscriptId" class="inline-edit-hint">
          该章节已在正文中编辑
        </div>
        <textarea v-else class="inline-edit-area"
          :value="entity.properties.content as string || ''"
          @input="onInlineEdit($event)"
          placeholder="在此编写内容..." />
      </div>

      <div class="detail-actions" v-if="editing">
        <button class="btn-sm" @click="addChildNode(entity)">＋ 添加子节点</button>
        <button class="btn-danger btn-sm" @click="deleteNode(entity.id)">删除</button>
      </div>
    </template>

    <!-- 自定义 Tab：情节线索 -->
    <template #tab-storylines="{ entity }">
      <div class="storyline-tab-content">
        <p class="tab-hint">该节点所属线索：{{ (entity.properties.storylines as string) || '无' }}</p>
      </div>
    </template>

    <!-- 关联面板 -->
    <template #detail-relations="{ entity }">
      <UniversalRelationPanel :entity-id="entity.id" entity-type="outline_node" storage-scope="outline" />
    </template>
  </GenericEntityView>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { GenericEntityView, DetailField, CustomDropdown, DynamicFieldsAdder, UniversalRelationPanel, CreateButton } from '@worldsmith/plugin-sdk'
import { GenericTreeView } from '@worldsmith/ui-kit'
import type { FormFieldDef, FilterDef, CustomTabDef, RelationTabDef } from '@worldsmith/plugin-sdk'
import { WsEmpty } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import { useSettingsStore } from '@/stores/settingsStore'
import { useOutlineTree } from './composables/useOutlineTree'
import { useOutlineDrag } from './composables/useOutlineDrag'
import { useOutlineEntityLinks } from './composables/useOutlineEntityLinks'
import { useOutlineStorylines } from './composables/useOutlineStorylines'
import { useOutlineLayout } from './composables/useOutlineLayout'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'

const es = useEntityStore()
const rs = useRelationStore()
const settings = useSettingsStore()

// --- Tabs ---
const activeTab = ref('tree')
const activeTabOptions = [
  { value: 'tree', label: '树状大纲' },
  { value: 'storylines', label: '情节线索' },
  { value: 'progress', label: '进度总览' },
]

// --- GenericEntityView 配置 ---
const formFields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '章节/节点名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'contentType', label: '内容类型', type: 'select', options: [
    { value: '章节', label: '章节' },
    { value: '场景', label: '场景' },
    { value: '片段', label: '片段' },
    { value: '备注', label: '备注' },
  ] },
  { key: 'sortOrder', label: '排序', type: 'number', placeholder: '排序序号' },
  { key: 'content', label: '内容', type: 'textarea', rows: 6, placeholder: '大纲内容...' },
  { key: 'wordCount', label: '字数', type: 'number', placeholder: '0' },
  { key: 'tags', label: '标签', type: 'tags' },
]

const filterDefs: FilterDef[] = [
  { key: 'status', label: '状态', dynamic: true },
]

const customTabs: CustomTabDef[] = [
  { id: 'storylines', label: '线索', icon: 'link' },
]

const detailTabs: RelationTabDef[] = []

// --- Outline 逻辑 ---
const {
  flatNodes, treeData,
  addRootNode, addChildNode, deleteNode,
  nodeIcon, statusLabel,
} = useOutlineTree()

const { handleMoveNode, handleDropOnNode } = useOutlineDrag()
const { getInlineBadges, getExpandedCards, getDetailSummary } = useOutlineEntityLinks()
const { storylines, nodesByLine, lineWordCount } = useOutlineStorylines(flatNodes)
const { expandedIds, selectedNodeId, loadLayout, toggleExpanded } = useOutlineLayout()

const customFieldDefs = ref<any[]>([])
const entityLinksCollapsed = ref<Set<string>>(new Set())

function onTreeSelect(e: Entity) {
  selectedNodeId.value = e.id
}

function onToggleExpand(nodeId: string, _expanded: boolean) {
  toggleExpanded(nodeId)
}

function switchToTree(e: Entity, selectEntity: (e: Entity) => void) {
  activeTab.value = 'tree'
  selectedNodeId.value = e.id
  selectEntity(e)
}

function onMoveNode(draggedId: string, targetId: string, position: number) {
  if (position === 0) {
    handleDropOnNode(draggedId, targetId, treeData.value, flatNodes.value)
  } else {
    handleMoveNode(draggedId, targetId, treeData.value, flatNodes.value)
  }
}

function toggleEntityLinks(nodeId: string) {
  const next = new Set(entityLinksCollapsed.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  entityLinksCollapsed.value = next
}

function navigateToEntity(entityId: string) {
  const entity = (es.entities ?? []).find(e => e.id === entityId)
  if (entity) {
    window.dispatchEvent(new CustomEvent('ws-navigate', {
      detail: { type: 'entity', entityId: entity.id, entityType: entity.type },
    }))
  }
}

function navigateToManuscript(manuscriptId: string) {
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { type: 'entity', entityId: manuscriptId, entityType: 'manuscript' },
  }))
}

function onInlineEdit(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value
  if (selectedNodeId.value) {
    es.update(selectedNodeId.value, {
      properties: { content: value },
    } as Partial<Entity>)
  }
}

const totalWordCount = computed(() =>
  flatNodes.value.reduce((s, e) => s + Number(e.properties.wordCount || 0), 0)
)

const progressPercent = computed(() => {
  if (flatNodes.value.length === 0) return 0
  return Math.round(
    flatNodes.value.filter(e => e.properties.status === '完成').length
    / flatNodes.value.length * 100
  )
})

onMounted(async () => {
  try {
    await es.loadAll()
    await rs.loadAll()
    loadLayout()
  } catch (err) {
    console.warn('[OutlineView]', err)
  }
})

function onDetailEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && selectedNodeId.value) {
    selectedNodeId.value = null
  }
}
onMounted(() => window.addEventListener('keydown', onDetailEsc))
onUnmounted(() => window.removeEventListener('keydown', onDetailEsc))

useAgentPluginBridge('outline', async (event) => {
  const { action, payload } = event
  switch (action) {
    case 'add_node': {
      const parentId = (payload.parentId as string) || null
      if (parentId) {
        const parent = (es.entities ?? []).find(e => e.id === parentId)
        if (parent) addChildNode(parent)
      } else {
        addRootNode()
      }
      break
    }
    case 'update_node': {
      const nodeId = payload.nodeId as string
      const changes = payload.changes as Record<string, unknown>
      if (nodeId && changes) {
        await es.update(nodeId, { properties: changes } as Partial<Entity>)
      }
      break
    }
    case 'delete_node': {
      const nodeId = payload.nodeId as string
      if (nodeId) await deleteNode(nodeId)
      break
    }
    case 'navigate': {
      const nodeId = payload.nodeId as string
      if (nodeId) {
        selectedNodeId.value = nodeId
        activeTab.value = 'tree'
        // 确保父节点展开
        toggleExpanded(nodeId)
      }
      break
    }
    default:
      console.log(`[Agent→outline] ${action}`, payload)
  }
})
</script>

<style scoped>
.toolbar-count { font-size: var(--font-size-sm); color: var(--text-tertiary); margin-left: auto; }
.outline-tree-area { display: flex; flex: 1; overflow: hidden; width: 100%; }
.tree-container { flex: 1; overflow-y: auto; }
.tree-add-btn, .tree-del-btn { width: 20px; height: 20px; border: none; background: transparent; cursor: pointer; font-size: var(--font-size-base); color: var(--text-tertiary); border-radius: var(--radius-xs); opacity: 0; transition: opacity .1s; }
.tree-row:hover .tree-add-btn, .tree-row:hover .tree-del-btn { opacity: 1; }
.tree-add-btn:hover { background: var(--bg); color: var(--success); }
.tree-del-btn:hover { background: var(--bg); color: var(--danger); }
.storyline-view { flex: 1; overflow-y: auto; width: 100%; }
.storyline-row { padding: 12px; margin: 8px 0; border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.sl-name { font-weight: var(--font-weight-semibold); font-size: var(--font-size-base); margin-right: 8px; }
.sl-count { font-size: var(--font-size-sm); color: var(--text-tertiary); }
.sl-nodes { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.sl-tag { font-size: var(--font-size-sm); padding: 3px 8px; background: var(--primary-light); border-radius: var(--radius-xs); cursor: pointer; }
.sl-empty { font-size: var(--font-size-sm); color: var(--text-tertiary); }
.progress-view { flex: 1; overflow-y: auto; width: 100%; }
.progress-stats { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; padding: 20px; text-align: center; border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.stat-num { display: block; font-size: var(--font-size-3xl); font-weight: var(--font-weight-bold); color: var(--primary); }
.stat-label { font-size: var(--font-size-sm); color: var(--text-tertiary); }
.progress-bar-wrap { height: 8px; background: var(--border-color); border-radius: var(--radius-xs); margin-bottom: 16px; overflow: hidden; }
.progress-bar { height: 100%; background: var(--primary); border-radius: var(--radius-xs); transition: width .3s; }
.progress-line { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-light); }
.pl-name { font-weight: var(--font-weight-medium); } .pl-count { font-size: var(--font-size-sm); color: var(--text-tertiary); margin-left: auto; }

.entity-links-area {
  margin: 4px 0;
  padding: 4px 8px;
  border-radius: var(--radius-xs);
  background: var(--bg-subtle, rgba(255,255,255,0.03));
}
.entity-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
.entity-badge {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: var(--radius-2xs);
  background: color-mix(in srgb, var(--badge-color, #888) 15%, transparent);
  color: var(--badge-color, #888);
  cursor: pointer;
  white-space: nowrap;
}
.entity-badge:hover {
  background: color-mix(in srgb, var(--badge-color, #888) 25%, transparent);
}
.entity-toggle-btn {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-2xs);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.entity-toggle-btn:hover { color: var(--text-primary); }
.entity-cards {
  margin-top: 4px;
}
.entity-group {
  margin-bottom: 4px;
}
.entity-group-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.entity-group-items {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.entity-card {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border: 1px solid;
  border-radius: var(--radius-xs);
  cursor: pointer;
  background: var(--bg-subtle, rgba(255,255,255,0.02));
  transition: background 0.1s;
}
.entity-card:hover {
  background: var(--hover-bg, rgba(255,255,255,0.06));
}
.detail-entity-summary {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: 8px;
}
.des-group {
  margin-bottom: 4px;
}
.des-group-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}
.des-group-items {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.des-entity {
  font-size: var(--font-size-sm);
  padding: 1px 6px;
  border-radius: var(--radius-2xs);
  background: var(--primary-light, rgba(79,70,229,0.1));
  cursor: pointer;
}
.des-entity:hover {
  background: var(--primary-light, rgba(79,70,229,0.2));
}
.detail-inline-edit {
  margin-top: 12px;
  border-top: 1px solid var(--border-light);
  padding-top: 8px;
}
.inline-edit-hint {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  padding: 8px;
  text-align: center;
  background: var(--bg-subtle, rgba(255,255,255,0.02));
  border-radius: var(--radius-xs);
}
.inline-edit-area {
  width: 100%;
  min-height: 120px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--bg-subtle, rgba(0,0,0,0.1));
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  resize: vertical;
  font-family: inherit;
}
.inline-edit-area:focus {
  outline: none;
  border-color: var(--primary);
}
</style>

<template>
  <div v-if="groups.length" class="urp-groups">
    <div
      v-for="(group, gi) in groups"
      :key="group.type"
      class="urp-group"
      :class="{ 'urp-drag-over': dragOverIndex === gi }"
      draggable="true"
      @dragstart="onDragStart(gi, $event)"
      @dragover.prevent="onDragOver(gi, $event)"
      @dragenter.prevent="onDragEnter(gi)"
      @dragleave="onDragLeave(gi)"
      @drop="onDrop(gi)"
      @dragend="onDragEnd"
    >
      <div class="urp-group-header" @click="group.collapsed = !group.collapsed">
        <WsIcon name="grip" size="xs" class="urp-drag-handle" title="拖拽排序" />
        <span class="urp-group-toggle"><WsIcon :name="group.collapsed ? 'chevron-right' : 'chevron-down'" size="xs" /></span>
        <span class="urp-group-label">{{ group.label }}</span>
        <span class="urp-group-count">{{ group.relations.length }}</span>
        <!-- 定向添加（2026-10-08 合并批）：只对该类型有芽声明（tabDefs 覆盖）的分组出现——按该类型的
             relationType/reverseDirection 打开添加浮层（宿主处理 'add'） -->
        <button
          v-if="hasDef(group.type)"
          class="urp-group-add"
          type="button"
          :title="`添加「${group.label}」`"
          @click.stop="emit('add', group.type, $event)"
        >＋</button>
      </div>
      <div v-if="!group.collapsed" class="urp-group-body">
        <div v-for="rel in group.relations" :key="rel.id" class="urp-rel-item"
          :class="{ 'urp-editing': editingRelId === rel.id }">
          <span class="urp-direction" @click="emit('navigate', rel)">{{ rel.direction === 'out' ? '→' : '←' }}</span>
          <WsIcon class="urp-counterpart-icon" :name="rel.counterpartIcon" size="xs" @click="emit('navigate', rel)" />
          <span class="urp-counterpart-name" @click="emit('navigate', rel)">{{ rel.counterpartName }}</span>
          <span class="urp-counterpart-type" @click="emit('navigate', rel)">{{ rel.counterpartTypeLabel }}</span>
          <span v-if="rel.pairId" class="urp-bidirectional-icon" title="双向关系">↔</span>
          <button class="urp-rel-edit" @click.stop="emit('edit', rel, $event)" title="编辑关系"><WsIcon name="edit" size="xs" /></button>
          <button class="urp-rel-del" @click.stop="emit('remove', rel)" title="删除关联"><WsIcon name="close" size="xs" /></button>
        </div>
        <div v-if="getRelationProps(group.relations[0]).length > 0" class="urp-rel-props">
          <div v-for="rel in group.relations" :key="'p-' + rel.id" class="urp-prop-line"
            @click="emit('navigate', rel)">
            <span class="urp-prop-target">{{ rel.counterpartName }}</span>
            <span v-for="p in getRelationProps(rel)" :key="p.key" class="urp-prop-kv">
              <span class="urp-prop-key">{{ p.label }}</span>
              <span class="urp-prop-val">{{ p.value }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <WsEmpty v-else preset="no-data" title="暂无关联条目" />
</template>

<script setup lang="ts">
/**
 * 关联分组列表（2026-10-08 Tab 优化批自 UniversalRelationPanel 抽出）：原先
 * 内嵌版与浮出版各一份 40+ 行同构模板，任何渲染改动都要写两遍——「先减压再加能力」
 * （与详情线抽 DetailShell 同一纪律）。本件只渲分组列表：拖拽排序 emit 顺序给宿主落盘，
 * 折叠直接改 group.collapsed（对象同一引用，行为与抽出前一致），行操作全部上报。
 */
import { ref } from 'vue'
import { WsIcon, WsEmpty } from '@worldsea/ui-kit'
import type { RelationTabDef } from './types'
import type { EnhancedRelation, RelationGroupState } from './relationPanelTypes'

const props = defineProps<{
  groups: RelationGroupState[]
  editingRelId: string | null
  /** 芽声明的关系元数据（合并批起：决定哪些分组有定向「＋」入口） */
  tabDefs?: RelationTabDef[]
}>()

const emit = defineEmits<{
  (e: 'navigate', rel: EnhancedRelation): void
  (e: 'edit', rel: EnhancedRelation, ev: MouseEvent): void
  (e: 'remove', rel: EnhancedRelation): void
  /** 拖拽重排后回报顺序（宿主负责重排 state 与落盘） */
  (e: 'reorder', orderedTypes: string[]): void
  /** 分组头「＋」定向添加（宿主开浮层） */
  (e: 'add', relationType: string, ev: MouseEvent): void
}>()

function hasDef(type: string): boolean {
  return (props.tabDefs ?? []).some(d => d.relationType === type)
}

// ── 分组拖拽排序（HTML5 DnD）──
const dragSourceIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(index: number, e: DragEvent): void {
  dragSourceIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(_index: number, e: DragEvent): void {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDragEnter(index: number): void {
  if (dragSourceIndex.value !== null && dragSourceIndex.value !== index) {
    dragOverIndex.value = index
  }
}

function onDragLeave(index: number): void {
  if (dragOverIndex.value === index) {
    dragOverIndex.value = null
  }
}

function onDrop(index: number): void {
  if (dragSourceIndex.value === null || dragSourceIndex.value === index) {
    dragOverIndex.value = null
    return
  }
  const arr = [...props.groups]
  const [moved] = arr.splice(dragSourceIndex.value, 1)
  arr.splice(index, 0, moved)
  dragSourceIndex.value = null
  dragOverIndex.value = null
  emit('reorder', arr.map(g => g.type))
}

function onDragEnd(): void {
  dragSourceIndex.value = null
  dragOverIndex.value = null
}

// ── 关系属性展示（原样自 panel 移入）──
interface PropDisplay {
  key: string
  label: string
  value: string
}

const RELATION_PROPERTY_LABELS: Record<string, string> = {
  role: '角色',
  since: '时间',
  acquisition: '获得',
  impact: '影响',
  status: '居住',
  detail: '位置',
  terms: '盟约',
  reason: '原因',
  nature: '性质',
  biological: '血缘',
  mechanism: '机制',
  gap: '间隔',
  length: '长度',
  type: '类型',
  method: '方式',
  distance: '距离',
  aspect: '方面',
}

function getRelationProps(rel: EnhancedRelation): PropDisplay[] {
  if (!rel.properties || Object.keys(rel.properties).length === 0) return []
  return Object.entries(rel.properties)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ({
      key: k,
      label: RELATION_PROPERTY_LABELS[k] || k,
      value: String(v),
    }))
}
</script>

<style scoped>
/* 样式原文自 UniversalRelationPanel 搬入（保观感零变化）；新增仅 .urp-group-add 一档 */
.urp-groups { max-height: 320px; overflow-y: auto; overflow-x: hidden; }
.urp-group { border-bottom: 1px solid var(--border-light, #f0f0f0); transition: background 0.15s; }
.urp-group:last-child { border-bottom: none; }
.urp-group.urp-drag-over { background: var(--primary-light, #eef2ff); }
.urp-group-header {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary, #666);
  background: var(--hover-bg, #f5f5f5); user-select: none;
}
.urp-group-header:hover { background: var(--active-bg, #eef2ff); }
.urp-drag-handle {
  cursor: grab; font-size: var(--font-size-sm); color: var(--text-tertiary, #aaa);
  width: 14px; text-align: center; flex-shrink: 0;
  transition: color 0.15s;
}
.urp-drag-handle:hover { color: var(--primary); }
.urp-drag-handle:active { cursor: grabbing; }
.urp-group-toggle { font-size: var(--font-size-xs); width: 12px; flex-shrink: 0; }
.urp-group-label { flex: 1; min-width: 0; font-weight: var(--font-weight-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.urp-group-count {
  font-size: var(--font-size-xs); color: var(--text-tertiary, #999);
  background: var(--tag-bg, #f0f0f0); padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
}
.urp-group-add {
  flex-shrink: 0; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-color, #e5e7eb); border-radius: 3px;
  background: transparent; color: var(--text-secondary, #666);
  font-size: var(--font-size-xs); line-height: 1; cursor: pointer;
}
.urp-group-add:hover { border-color: var(--primary); color: var(--primary); background: var(--bg-secondary, #fff); }
.urp-group-body { padding: 2px 0; overflow: hidden; }
.urp-rel-item {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px 5px 20px; font-size: var(--font-size-sm); cursor: pointer;
  transition: background 0.1s; overflow: hidden;
}
.urp-rel-item:hover { background: var(--hover-bg, #f3f4f6); }
.urp-direction { font-size: var(--font-size-sm); color: var(--text-tertiary, #999); width: 14px; text-align: center; flex-shrink: 0; }
.urp-counterpart-icon { font-size: var(--font-size-base); width: 18px; text-align: center; flex-shrink: 0; }
.urp-counterpart-name {
  flex: 1; min-width: 0; color: var(--primary, #4f46e5); font-weight: var(--font-weight-medium);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.urp-counterpart-type {
  font-size: var(--font-size-xs); color: var(--text-tertiary, #999);
  background: var(--tag-bg, #f0f0f0); padding: 1px 5px; border-radius: 3px;
  flex-shrink: 0; white-space: nowrap;
}
.urp-rel-edit {
  opacity: 0; width: 18px; height: 18px; border: none; background: transparent;
  color: var(--text-tertiary, #999); cursor: pointer; font-size: var(--font-size-xs); border-radius: 3px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: opacity 0.1s, background 0.1s;
}
.urp-rel-item:hover .urp-rel-edit { opacity: 1; }
.urp-rel-edit:hover { background: var(--hover-bg); color: var(--primary); }
.urp-rel-del {
  opacity: 0; width: 18px; height: 18px; border: none; background: transparent;
  color: var(--danger, #ef4444); cursor: pointer; font-size: var(--font-size-xs); border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: opacity 0.1s, background 0.1s;
}
.urp-rel-item:hover .urp-rel-del { opacity: 1; }
.urp-rel-del:hover { background: rgba(239, 68, 68, 0.1); }

.urp-rel-props { padding: 0 8px 4px 20px; overflow: hidden; }
.urp-prop-line {
  display: flex; align-items: center; gap: 4px; padding: 2px 0;
  font-size: var(--font-size-xs); color: var(--text-tertiary, #999); cursor: pointer;
  overflow: hidden;
}
.urp-prop-line:hover { color: var(--text-secondary); }
.urp-prop-target {
  color: var(--primary); font-weight: var(--font-weight-medium); margin-right: 4px;
  max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;
}
.urp-prop-kv { display: flex; gap: 2px; min-width: 0; overflow: hidden; }
.urp-prop-key { color: var(--text-tertiary); white-space: nowrap; }
.urp-prop-val {
  color: var(--text-secondary); max-width: 80px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.urp-bidirectional-icon {
  font-size: var(--font-size-xs);
  color: var(--primary, #4f46e5);
  margin-left: 2px;
  opacity: 0.7;
}
</style>

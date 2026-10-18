<template>
  <!--
    容器工具面板（BoardInspector）—— 编辑器交互规格 §五「属性条」
    规格落点：选中容器后在**画布内悬浮**（视图工具条 44px 放不下配置项，且规格要求右栏不兼属性面板）
    内容 = 容器尺寸 + 组件列表（按 configSchema 自动渲染配置 + 拖拽排序 + 移除）
    2026-10-08（「outline 接入详情载体」裁定）：节点属性 / 关联章节 / 关联实体 / 打开正文
    已拆至 `NodeDetailView`（走 L1 详情载体）；本件降为**容器编辑工具**，留守悬浮。
  -->
  <div v-if="container" class="bi" :style="panelStyle">
    <div class="bi-head" :class="{ 'bi-head--draggable': inspectorMode === 'free' }" @pointerdown="onHeaderPointerDown">
      <span class="bi-title" :title="headText">{{ headText }}</span>
      <button class="bi-icon" type="button" title="关闭" aria-label="关闭属性面板" @click="$emit('close')">✕</button>
    </div>

    <!-- 容器尺寸 -->
    <div class="bi-sec">
      <div class="bi-sec-title">容器尺寸</div>
      <div class="bi-row">
        <label class="bi-inline">
          <span>宽</span>
          <input
            class="bi-num"
            type="number"
            min="120"
            :value="draftWidth"
            @change="onWidthChange"
          />
        </label>
        <label class="bi-inline">
          <span>高</span>
          <input
            class="bi-num"
            type="number"
            min="48"
            :value="draftHeight"
            @change="onHeightChange"
          />
        </label>
      </div>
      <div class="bi-hint">{{ autoSized ? '当前为内容自适应尺寸' : '已固定尺寸' }}</div>
      <button class="bi-btn" type="button" :disabled="autoSized" @click="$emit('resetSize')">
        恢复内容自适应
      </button>
    </div>

    <!-- 组件列表（可拖拽排序） -->
    <div class="bi-sec">
      <div class="bi-sec-title">表现形式<span class="bi-sec-note">拖拽行可调整顺序</span></div>

      <div
        v-for="c in ordered"
        :key="c.id"
        class="bi-comp"
        :class="{ 'bi-comp--dragging': draggingId === c.id, 'bi-comp--drop': dropTargetId === c.id }"
        draggable="true"
        @dragstart="onDragStart(c.id, $event)"
        @dragover.prevent="onDragOver(c.id)"
        @drop.prevent="onDrop(c.id)"
        @dragend="onDragEnd"
      >
        <div class="bi-comp-head">
          <span class="bi-grip" aria-hidden="true">⋮⋮</span>
          <span class="bi-comp-label">{{ labelOf(c.form) }}</span>
          <span class="bi-kind">{{ isInline(c.form) ? '可编辑' : '只读' }}</span>
          <button
            class="bi-icon"
            type="button"
            title="移除该表现形式（不影响节点）"
            aria-label="移除表现形式"
            @click="$emit('removeComponent', c.id)"
          >✕</button>
        </div>

        <div v-if="fieldsOf(c.form).length" class="bi-fields">
          <label v-for="f in fieldsOf(c.form)" :key="f.key" class="bi-field">
            <span class="bi-field-label">{{ f.label }}</span>
            <input
              v-if="f.type === 'boolean'"
              class="bi-check"
              type="checkbox"
              :checked="valueOf(c, f.key) === true"
              @change="onFieldChange(c.id, f.key, ($event.target as HTMLInputElement).checked)"
            />
            <input
              v-else-if="f.type === 'number'"
              class="bi-num"
              type="number"
              :value="numValue(c, f.key)"
              @change="onFieldChange(c.id, f.key, Number(($event.target as HTMLInputElement).value))"
            />
            <select
              v-else-if="f.type === 'select'"
              class="bi-select"
              :value="String(valueOf(c, f.key) ?? '')"
              @change="onFieldChange(c.id, f.key, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="o in f.options ?? []" :key="String(o.value)" :value="String(o.value)">
                {{ o.label }}
              </option>
            </select>
            <input
              v-else
              class="bi-text"
              type="text"
              :value="String(valueOf(c, f.key) ?? '')"
              @change="onFieldChange(c.id, f.key, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div v-else class="bi-nofield">该形式无可配项</div>
      </div>

      <div v-if="!ordered.length" class="bi-empty">该容器还没有表现形式</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 容器工具面板：**纯展示 + 事件上报**，不直接写布局（写入一律经 BoardView → useBoardLayout 的原子操作）。
 * 配置项按 `FormDefinition.configSchema` 自动渲染 —— 新增表现形式无需改本组件（注册表即扩展点）。
 * 2026-10-08（「outline 接入详情载体」裁定）：节点属性 / 关联章节 / 关联实体 / 「打开正文」
 * 拆至 `NodeDetailView`（详情载体）；本件只保留容器编辑工具（尺寸 + 表现形式）。
 */
import { computed, ref, watch } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { DEFAULT_CONTAINER_SIZE, type BoardComponent, type BoardContainer } from '../layoutSchema'
import { getForm, resolveFormConfig, type FormConfigField } from '../forms/registry'
import { useInspectorAnchor } from '../composables/useInspectorAnchor'

const props = defineProps<{
  container: BoardContainer | null
  /** 仅用于标题显示（容器与节点 1:1） */
  node?: Entity
  /** 画布视口：跟随卡片定位需要世界坐标 → 屏幕坐标的换算（屏 = 世界 × zoom + pan） */
  viewport?: { panX: number; panY: number; zoom: number }
  /** 当前白板 id：悬浮模式的位置按白板分别记忆（useBoardLayout 的 boardId 可为 null） */
  boardId?: string | null
}>()

const { panelStyle, onHeaderPointerDown, inspectorMode } = useInspectorAnchor(
  () => props.container,
  () => props.viewport,
  () => props.boardId ?? '',
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'resize', size: { w: number; h: number }): void
  (e: 'resetSize'): void
  (e: 'updateConfig', componentId: string, patch: Record<string, unknown>): void
  (e: 'removeComponent', componentId: string): void
  (e: 'reorderComponents', orderedIds: string[]): void
}>()

const headText = computed(() => {
  const name = (props.node?.name ?? '').trim()
  return name || (props.node ? '未命名节点' : '节点已删除')
})

const ordered = computed<BoardComponent[]>(() =>
  [...(props.container?.components ?? [])].sort((a, b) => a.order - b.order),
)

// ── 容器尺寸 ──
const autoSized = computed(() => !props.container?.size)
const draftWidth = ref(DEFAULT_CONTAINER_SIZE.w)
const draftHeight = ref(DEFAULT_CONTAINER_SIZE.h)

watch(
  () => [props.container?.id, props.container?.size?.w, props.container?.size?.h] as const,
  () => {
    draftWidth.value = props.container?.size?.w ?? DEFAULT_CONTAINER_SIZE.w
    draftHeight.value = props.container?.size?.h ?? DEFAULT_CONTAINER_SIZE.h
  },
  { immediate: true },
)

function commitSize(): void {
  emit('resize', {
    w: Math.max(120, Math.round(Number(draftWidth.value) || DEFAULT_CONTAINER_SIZE.w)),
    h: Math.max(48, Math.round(Number(draftHeight.value) || DEFAULT_CONTAINER_SIZE.h)),
  })
}
function onWidthChange(ev: Event): void {
  draftWidth.value = Number((ev.target as HTMLInputElement).value)
  commitSize()
}
function onHeightChange(ev: Event): void {
  draftHeight.value = Number((ev.target as HTMLInputElement).value)
  commitSize()
}

// ── 配置项（按 configSchema 自动渲染）──
function fieldsOf(form: string): FormConfigField[] {
  return getForm(form)?.configSchema ?? []
}

function labelOf(form: string): string {
  return getForm(form)?.label ?? form
}

function isInline(form: string): boolean {
  return getForm(form)?.kind === 'inline'
}

/** 取该组件的有效配置值（默认值 + 覆盖，与渲染侧同一函数 → 面板与呈现不会不一致） */
function valueOf(component: BoardComponent, key: string): unknown {
  return resolveFormConfig(component.form, component.config)[key]
}

function numValue(component: BoardComponent, key: string): number {
  const n = Number(valueOf(component, key))
  return Number.isFinite(n) ? n : 0
}

function onFieldChange(componentId: string, key: string, value: unknown): void {
  emit('updateConfig', componentId, { [key]: value })
}

// ── 组件排序（HTML5 DnD；拖到某行即插到该行之前）──
const draggingId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

function onDragStart(id: string, ev: DragEvent): void {
  draggingId.value = id
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(id: string): void {
  if (!draggingId.value || draggingId.value === id) return
  dropTargetId.value = id
}

function onDrop(targetId: string): void {
  const fromId = draggingId.value
  const ids = ordered.value.map(c => c.id)
  onDragEnd()
  if (!fromId || fromId === targetId) return

  const from = ids.indexOf(fromId)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0) return

  const next = [...ids]
  next.splice(from, 1)
  // 移除后再取目标下标：插到目标行**之前**（视觉上即落点位置）
  next.splice(next.indexOf(targetId), 0, fromId)
  if (next.join('|') === ids.join('|')) return
  emit('reorderComponents', next)
}

function onDragEnd(): void {
  draggingId.value = null
  dropTargetId.value = null
}
</script>

<style scoped>
.bi {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 6;
  width: 248px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  padding: 10px 12px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  background: var(--menubar-bg, var(--bg-secondary));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
}
.bi-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-light);
}
/* 悬浮模式：头部可拖动（拖动期间用 grabbing） */
.bi-head--draggable { cursor: grab; }
.bi-head--draggable:active { cursor: grabbing; }
.bi-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
}
.bi-sec { padding: 8px 0; border-bottom: 1px solid var(--border-light); }
.bi-sec:last-of-type { border-bottom: none; }
.bi-sec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.bi-sec-note { color: var(--text-tertiary); opacity: 0.8; }
.bi-row { display: flex; gap: 8px; }
.bi-inline { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-2xs); color: var(--text-secondary); }
.bi-num {
  width: 56px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  outline: none;
}
.bi-hint { margin-top: 4px; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bi-btn {
  margin-top: 6px;
  width: 100%;
  height: 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  /* 按钮文字必须显式设色（否则暗色主题回落到默认黑） */
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
}
.bi-btn:hover:not(:disabled) { background: var(--hover-bg); border-color: var(--primary); color: var(--primary); }
.bi-btn:disabled { opacity: 0.5; cursor: default; }
.bi-icon {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1;
  cursor: pointer;
}
.bi-icon:hover { background: var(--hover-bg); color: var(--primary); }
.bi-comp {
  margin-bottom: 6px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
}
.bi-comp--dragging { opacity: 0.5; }
.bi-comp--drop { border-color: var(--primary); }
.bi-comp-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  cursor: grab;
  user-select: none;
}
.bi-grip { color: var(--text-tertiary); font-size: var(--font-size-2xs); letter-spacing: -1px; }
.bi-comp-label { flex: 1; font-size: var(--font-size-2xs); color: var(--text-secondary); }
.bi-kind { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bi-fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 6px 6px;
  border-top: 1px dashed var(--border-light);
}
.bi-field { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.bi-field-label { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bi-select,
.bi-text {
  max-width: 120px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  outline: none;
}
.bi-check { accent-color: var(--primary); }
.bi-nofield { padding: 0 6px 6px; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bi-empty { font-size: var(--font-size-2xs); color: var(--text-tertiary); font-style: italic; }
</style>

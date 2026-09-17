<template>
  <!--
    白板容器（Container）—— 摆放单位，与大纲节点 1:1
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §三
    · 拖动改位置（由画布统一处理指针事件，本组件只上报 dragStart）
    · 删除容器 **不等于** 删除节点（提示文案已明示）
    · 组件由表现形式注册表动态渲染（新增形式不需要改本文件）
  -->
  <div
    class="bc"
    :class="{
      'bc--selected': selected,
      'bc--dangling': !node,
      'bc--collapsed': container.collapsed,
    }"
    :style="boxStyle"
    role="group"
    :aria-label="node ? `节点容器：${node.name}` : '节点已删除的容器'"
    data-ctx="container"
    :data-ctx-id="container.id"
    @pointerdown.stop="$emit('select')"
    @dblclick.stop
  >
    <div class="bc-head" @pointerdown.stop="$emit('dragStart', $event)">
      <span class="bc-dot" :class="dotClass" :title="statusText" />
      <span class="bc-title" :class="{ 'bc-title--dangling': !node }">{{ headText }}</span>
      <span class="bc-actions">
        <button
          v-if="node"
          class="bc-btn"
          type="button"
          title="添加表现形式"
          aria-label="添加表现形式"
          @click.stop="openFormMenu"
        >＋</button>
        <button
          v-if="hasManuscript"
          class="bc-btn"
          type="button"
          title="打开正文（该节点已关联章节）"
          aria-label="打开正文"
          @click.stop="$emit('openManuscript')"
        >
          <WsIcon name="book-open" size="xs" />
        </button>
        <button
          class="bc-btn"
          type="button"
          :title="container.collapsed ? '展开' : '折叠'"
          aria-label="折叠或展开容器"
          @click.stop="$emit('toggleCollapse')"
        >{{ container.collapsed ? '▽' : '△' }}</button>
        <button
          class="bc-btn"
          type="button"
          :title="node ? '移除容器（不影响节点）' : '清理悬空容器'"
          aria-label="移除容器"
          @click.stop="$emit('remove')"
        >✕</button>
      </span>
    </div>

    <div v-if="!container.collapsed" class="bc-body">
      <!-- 组件行：悬停显示「移除」（规格 §四）；行本身不拦截选中，故只让按钮 stop -->
      <div
        v-for="c in visibleComponents"
        :key="c.id"
        class="bc-comp"
        data-ctx="component"
        :data-ctx-id="c.id"
      >
        <component
          :is="defOf(c.form)"
          :node-id="container.nodeId"
          :config="c.config"
        />
        <button
          class="bc-comp-x"
          type="button"
          title="移除该表现形式（不影响节点）"
          aria-label="移除表现形式"
          @click.stop="$emit('removeComponent', c.id)"
        >✕</button>
      </div>
      <div v-if="!visibleComponents.length" class="bc-empty" @dblclick.stop="openFormMenu">
        {{ node ? '添加表现形式' : '节点已删除，可清理此容器' }}
      </div>
    </div>

    <!-- 尺寸手柄：拖动由画布统一处理指针（本组件只上报起点） -->
    <span
      class="bc-resize"
      role="separator"
      aria-label="调整容器尺寸"
      @pointerdown.stop="$emit('resizeStart', $event)"
    />

    <!-- 形式选择菜单（从注册表读出，新增形式自动出现） -->
    <div v-if="menuOpen" class="bc-form-menu" @pointerdown.stop @dblclick.stop>
      <button
        v-for="f in formDefs"
        :key="f.form"
        class="bc-form-item"
        type="button"
        :title="f.description || f.label"
        @click.stop="pickForm(f.form)"
      >
        <span class="bc-form-label">{{ f.label }}</span>
        <!-- 09-16 裁定：同容器内同种形式**允许**重复，但给出提示（通常是误操作） -->
        <span
          v-if="hasForm(f.form)"
          class="bc-form-dup"
          title="该容器已有同种表现形式（仍可添加）"
        >已有</span>
        <span class="bc-form-kind">{{ f.kind === 'inline' ? '可编辑' : '只读' }}</span>
      </button>
      <div v-if="!formDefs.length" class="bc-form-empty">暂无可用表现形式</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 容器组件：展示 + 事件上报（拖动/选择/增删），不含业务写入逻辑——
 * 写入一律经 BoardView → useBoardLayout 的原子操作，保证「改了就一定被保存」。
 */
import { computed, ref, watch } from 'vue'
import type { Entity } from '@worldsea/entity-core'
// 芽视图里的 UI 组件不是全局组件，必须显式导入（否则渲染期静默为空、vue-tsc 不报错）
import { WsIcon } from '@worldsea/ui-kit'
import type { BoardContainer } from '../layoutSchema'
import { getAllForms, getForm } from '../forms/registry'
import type { Component as VueComponent } from 'vue'

const props = defineProps<{
  container: BoardContainer
  /** 悬空（节点已删）时为 undefined */
  node?: Entity
  selected: boolean
  /** 外部请求展开「形式选择菜单」（右键菜单「添加表现形式」）；{id, token} 保证可重复触发 */
  openFormSignal?: { id: string; token: number } | null
}>()

const emit = defineEmits<{
  (e: 'select'): void
  (e: 'dragStart', ev: PointerEvent): void
  (e: 'resizeStart', ev: PointerEvent): void
  (e: 'toggleCollapse'): void
  (e: 'remove'): void
  (e: 'removeComponent', componentId: string): void
  (e: 'openManuscript'): void
  (e: 'addComponent', form: string): void
}>()

/** 节点关联了正文章节时才提供「打开正文」入口（规格 §三） */
const hasManuscript = computed(() => !!(props.node?.properties?.manuscriptId as string))

const menuOpen = ref(false)
const formDefs = computed(() => getAllForms())

/** 折叠时只显示第一个组件（通常是标题式）用于降噪 */
const visibleComponents = computed(() =>
  props.container.collapsed ? props.container.components.slice(0, 1) : props.container.components,
)

const headText = computed(() => {
  if (!props.node) return '节点已删除'
  return (props.node.name ?? '').trim() || '未命名节点'
})

const statusText = computed(() => ((props.node?.properties?.status as string) || '未写'))
const dotClass = computed(() => {
  if (statusText.value === '完成') return 'bc-dot--done'
  if (statusText.value === '草稿') return 'bc-dot--draft'
  return 'bc-dot--todo'
})

const boxStyle = computed(() => {
  const size = props.container.size
  return {
    left: `${props.container.pos.x}px`,
    top: `${props.container.pos.y}px`,
    width: size ? `${size.w}px` : '',
    minWidth: size ? '' : '180px',
    maxWidth: size ? '' : '320px',
  }
})

function defOf(form: string): VueComponent | null {
  return (getForm(form)?.component as VueComponent) ?? null
}

function openFormMenu(): void {
  menuOpen.value = !menuOpen.value
}

function pickForm(form: string): void {
  menuOpen.value = false
  emit('addComponent', form)
}

/** 该容器是否已有同种形式（菜单据此显示「已有」提示，但不阻止添加） */
function hasForm(form: string): boolean {
  return props.container.components.some(c => c.form === form)
}

// 容器失去选中（点了别处）时收起形式菜单，避免菜单挂在画布上不消失
watch(() => props.selected, selected => {
  if (!selected) menuOpen.value = false
})

/** 右键菜单触发的「添加表现形式」（打开后容器会因选中而保持展开） */
watch(
  () => props.openFormSignal,
  signal => {
    if (signal && signal.id === props.container.id) menuOpen.value = true
  },
)
</script>

<style scoped>
.bc {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #1e1e1e);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.bc--selected { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.bc--dangling { border-style: dashed; opacity: 0.75; }
.bc-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border-light);
  border-radius: var(--radius-mid) var(--radius-mid) 0 0;
  cursor: grab;
  user-select: none;
}
.bc-head:active { cursor: grabbing; }
.bc-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.bc-dot--todo { background: var(--text-tertiary); }
.bc-dot--draft { background: var(--warning, #d97706); }
.bc-dot--done { background: var(--success, #059669); }
.bc-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bc-title--dangling { color: var(--text-tertiary); font-style: italic; }
.bc-actions { display: flex; gap: 2px; flex-shrink: 0; }
.bc-btn {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  /* 图标/符号按钮必须显式设色，否则暗色主题下不可见（项目通用坑） */
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1;
  cursor: pointer;
}
.bc-btn:hover { background: var(--hover-bg); color: var(--primary); }
.bc-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 8px;
}
.bc-comp { position: relative; min-width: 0; }
.bc-comp-x {
  position: absolute;
  right: -4px;
  top: -4px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background: var(--menubar-bg, var(--bg-secondary));
  /* 符号按钮必须显式设色，否则暗色主题下不可见 */
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
}
.bc-comp:hover .bc-comp-x { opacity: 1; }
.bc-comp-x:hover { color: var(--error, #dc2626); border-color: var(--error, #dc2626); }
.bc-empty {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  border: 1px dashed var(--border-light);
  border-radius: var(--radius-xs);
  padding: 6px 8px;
  text-align: center;
  cursor: pointer;
}
.bc-empty:hover { color: var(--primary); border-color: var(--primary); }
.bc-form-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  margin-top: 4px;
  min-width: 140px;
  padding: 4px;
  background: var(--menubar-bg, var(--bg-secondary));
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}
.bc-form-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  color: var(--text-color);
  font-size: var(--font-size-xs);
  text-align: left;
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.bc-form-item:hover { background: var(--hover-bg); }
.bc-form-kind { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bc-form-dup {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--warning, #d97706);
  color: #fff;
  font-size: var(--font-size-2xs);
  opacity: 0.85;
}
.bc-form-empty { padding: 6px 8px; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bc-resize {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border-right: 2px solid var(--text-tertiary);
  border-bottom: 2px solid var(--text-tertiary);
  cursor: nwse-resize;
  opacity: 0.55;
}
.bc-resize:hover { opacity: 1; border-color: var(--primary); }
</style>

<template>
  <!--
    白板「区」（Section）—— 人工划分，承担组间约束
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §二
    · 视觉弱色：虚线边框 + 极淡填充，不与容器抢视线
    · 拖动区体 = 区与其内容器整体移动（由画布统一处理指针，本组件只上报 dragStart）
    · 标题双击就地改名；右下角手柄调整尺寸（vertical/horizontal/grid 会重排容器）
  -->
  <div
    class="bs"
    :class="{ 'bs--selected': selected }"
    :style="boxStyle"
    role="group"
    :aria-label="`区：${titleText}`"
    data-ctx="section"
    :data-ctx-id="section.id"
  >
    <div class="bs-head" @pointerdown.stop="$emit('dragStart', $event)" @dblclick.stop>
      <span
        v-if="!renaming"
        class="bs-title"
        :title="section.title || '未命名区'"
        @dblclick.stop="startRename"
      >{{ titleText }}</span>
      <input
        v-else
        ref="renameInput"
        v-model="draft"
        class="bs-input"
        type="text"
        @pointerdown.stop
        @dblclick.stop
        @keydown.enter="guardEnter($event, commitRename)"
        @keydown.esc="guardEsc($event, cancelRename)"
        @blur="commitRename"
      />
      <span class="bs-meta">{{ containerCount }} 容器 · {{ arrangeLabel }}</span>
      <span class="bs-actions">
        <button
          class="bs-btn"
          type="button"
          title="按当前排列方式重新排列区内容器"
          aria-label="重新排列"
          @click.stop="$emit('rearrange')"
        >⇅</button>
        <button
          class="bs-btn"
          type="button"
          title="删除区"
          aria-label="删除区"
          @click.stop="$emit('remove')"
        >✕</button>
      </span>
    </div>

    <!-- 调整尺寸手柄（右下角） -->
    <span
      class="bs-resize"
      role="separator"
      aria-label="调整区尺寸"
      @pointerdown.stop="$emit('resizeStart', $event)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 区组件：只做渲染与事件上报。区矩形、内容器归属、排布都由 useBoardLayout 的原子操作负责
 * （保证「改了就一定被保存」，且区与内容器同处一次变更、撤销只需一步）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { BoardSection, SectionArrange } from '../layoutSchema'
import { guardEnter, guardEsc } from '../forms/enterGuard'

const props = defineProps<{
  section: BoardSection
  /** 当前未接入区选中模型（规格 §五 只定义容器粒度），字段先留出 */
  selected?: boolean
  /** 归属该区的容器数（徽标展示用） */
  containerCount: number
  /**
   * 外部请求进入改名态（右键菜单「重命名区」）。
   * 用 { id, token } 而非布尔：token 递增保证「同一条区连点两次也能再次触发」。
   */
  renameSignal?: { id: string; token: number } | null
}>()

const emit = defineEmits<{
  (e: 'dragStart', ev: PointerEvent): void
  (e: 'resizeStart', ev: PointerEvent): void
  (e: 'rename', title: string): void
  (e: 'rearrange'): void
  (e: 'remove'): void
}>()

const ARRANGE_LABEL: Record<SectionArrange, string> = {
  free: '自由',
  vertical: '纵排',
  horizontal: '横排',
  grid: '网格',
}

const titleText = computed(() => (props.section.title ?? '').trim() || '未命名区')
const arrangeLabel = computed(() => ARRANGE_LABEL[props.section.arrange])

const boxStyle = computed(() => ({
  left: `${props.section.rect.x}px`,
  top: `${props.section.rect.y}px`,
  width: `${props.section.rect.w}px`,
  height: `${props.section.rect.h}px`,
}))

// ── 就地改名 ──────────────────────────────
const renaming = ref(false)
const draft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

async function startRename(): Promise<void> {
  if (renaming.value) return
  draft.value = props.section.title ?? ''
  renaming.value = true
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function commitRename(): void {
  if (!renaming.value) return
  emit('rename', draft.value.trim())
  renaming.value = false
}

function cancelRename(): void {
  renaming.value = false
}

/** 右键菜单触发的改名（与双击同一路径，避免两份实现） */
watch(
  () => props.renameSignal,
  signal => {
    if (signal && signal.id === props.section.id) void startRename()
  },
)
</script>

<style scoped>
.bs {
  position: absolute;
  /* 弱色：极淡填充 + 虚线边框，保证容器是视觉主体 */
  background: var(--hover-bg);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-mid);
  /* 区在容器下层（DOM 顺序：区先、容器后）。区体**不** stop 指针事件——
     落在区空白处的拖拽应继续冒泡给画布做平移、双击应能新建节点；
     只有标题栏与尺寸手柄是区的交互区（它们在子元素上 stop）。 */
  z-index: 0;
}
.bs--selected { border-color: var(--primary); border-style: solid; }
.bs-head {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 高度与 sectionArrange.SECTION_HEADER 对齐（区内容从标题栏下方开始） */
  height: 26px;
  padding: 0 8px;
  border-bottom: 1px dashed var(--border-light);
  border-radius: var(--radius-mid) var(--radius-mid) 0 0;
  cursor: grab;
  user-select: none;
}
.bs-head:active { cursor: grabbing; }
.bs-title {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  cursor: text;
}
.bs-input {
  width: 140px;
  padding: 0 4px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-xs);
  font-family: inherit;
  outline: none;
}
.bs-meta { flex: 1; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bs-actions { display: flex; gap: 2px; flex-shrink: 0; }
.bs-btn {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  /* 符号按钮必须显式设色（否则暗色主题下不可见，项目通用坑） */
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1;
  cursor: pointer;
}
.bs-btn:hover { background: var(--bg-tertiary); color: var(--primary); }
.bs-resize {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border-right: 2px solid var(--text-tertiary);
  border-bottom: 2px solid var(--text-tertiary);
  cursor: nwse-resize;
}
</style>

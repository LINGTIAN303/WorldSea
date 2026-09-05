<!--
  ProcessSummaryRow：过程层折叠摘要行（双态）
  - 折叠态（默认）：替代全部过程行段，点击展开（chevron-right）。
  - 展开态（expanded）：用户手动展开后的常驻折叠头行，位于过程行段上方，
    点击收起（chevron-down）——修复此前展开后摘要行消失、无法再折叠的问题。
  单行扁平样式（与 ThinkRow 折叠态一致），无卡片边框。
  带 data-msg-id 供窗口化实测高度与 scrollIntoView 定位。
  emits：expand（携带 turnId，上层按当前折叠态切换）。
-->
<template>
  <div ref="rootEl" class="ws-stream-row ws-process-summary" :data-msg-id="item.id">
    <!-- 2026-09-05 样式统一（对齐推理段）：点击/光标仅挂前缀摘要文字，整行不可点、无 hover 背景；
         chevron 移后缀（图标切换表达折叠态） -->
    <!-- 折叠摘要行类型图标（2026-09-05）：文字前缀，跟随文字色；chevron 保持在后缀 -->
    <IconFootsteps size="12" stroke="1.75" class="ws-process-summary-icon" />
    <span
      class="ws-process-summary-text"
      role="button"
      tabindex="0"
      :aria-expanded="item.expanded === true"
      :aria-label="summary"
      @click="onToggle"
      @keydown.enter.prevent="onToggle"
      @keydown.space.prevent="onToggle"
    >{{ summary }}</span>
    <!-- 2026-09-05 后缀箭头统一旋转方案（chevron-right + open 旋转 90°），悬停显示 -->
    <WsIcon
      name="chevron-right"
      size="xs"
      class="ws-process-summary-chevron"
      :class="{ open: item.expanded === true }"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { IconFootsteps } from '@tabler/icons-vue'

/** 折叠摘要行的最小形参与事件流项一致 */
interface ProcessSummaryItem {
  id: string
  turnId: string
  thinkCount: number
  actionCount: number
  /** 展开态的常驻折叠头行（点击收起）；缺省为折叠态（点击展开） */
  expanded?: boolean
}

const props = defineProps<{
  item: ProcessSummaryItem
}>()

const emit = defineEmits<{
  (e: 'expand', turnId: string): void
}>()

const rootEl = ref<HTMLElement | null>(null)

/**
 * 过程层容器高度平滑插值（WAAPI，2026-09-05 用户点破要害）：
 * 摘要行展开/收起的动画主体是「结果层内容被推下/收回」——过程行卸载导致容器高度瞬变，
 * 结果层瞬间跳位。此处数据切换后 DOM 高度已定，从旧高度动画到新高度（期间 overflow hidden），
 * 下方结果层随之平滑推移。动画结束自动释放 height（恢复内容自适应）。
 */
async function animateContainerHeight(container: HTMLElement, fromH: number): Promise<void> {
  await nextTick()
  const toH = container.offsetHeight
  if (Math.abs(toH - fromH) < 2) return
  container.animate(
    [
      { height: `${fromH}px`, overflow: 'hidden' },
      { height: `${toH}px`, overflow: 'hidden' },
    ],
    { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  )
}

/**
 * 展开/收起切换：
 * - 展开行段由挂载动画（ws-proc-row-in）淡入；容器高度从摘要行高度平滑撑开；
 * - 收起两阶段——先挂 .ws-proc-fading 淡出行段（0.12s），再上抛切换 + 高度平滑塌缩。
 */
function onToggle(): void {
  const container = rootEl.value?.closest('.ws-turn-process') as HTMLElement | null
  if (!container) {
    emit('expand', props.item.turnId)
    return
  }
  if (props.item.expanded === true) {
    const prevH = container.offsetHeight
    container.classList.add('ws-proc-fading')
    window.setTimeout(() => {
      container.classList.remove('ws-proc-fading')
      emit('expand', props.item.turnId)
      void animateContainerHeight(container, prevH)
    }, 130)
    return
  }
  const prevH = container.offsetHeight
  emit('expand', props.item.turnId)
  void animateContainerHeight(container, prevH)
}

/** 摘要文案：优先步骤数（信息量最高），推理段数次之；展开态动词为「收起」 */
const summary = computed(() => {
  const parts: string[] = []
  if (props.item.actionCount > 0) parts.push(`${props.item.actionCount} 个步骤`)
  if (props.item.thinkCount > 0) parts.push(`${props.item.thinkCount} 段推理`)
  const body = parts.length > 0 ? parts.join(' · ') : '过程'
  return props.item.expanded ? `收起${body}` : `展开${body}`
})
</script>

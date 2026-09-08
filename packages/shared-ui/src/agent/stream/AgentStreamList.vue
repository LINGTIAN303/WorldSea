<!--
  AgentStreamList：事件行流的轮次分组渲染容器
  按轮次（Turn）把事件行组织为三个结构层（设计文档 §3.1）：
    ① 用户消息层 → UserRow
    ② LLM 过程层 → 该轮的全部过程行段（推理 / 过程文本 / 动作 / 折叠摘要）
    ③ LLM 结果层 → 该轮的最终输出，唯一带操作栏
  分组以 user 行为界。窗口化切片可能从轮次中间开始 → 首组无用户行（orphan 组），
  保证不丢行。窗口化按 data-msg-id 的 id 键测量高度，与 DOM 嵌套无关，故分组安全。

  不负责窗口化（列表层接管）；只做分组 + 行分发 + 事件透传。
  入场动画治理（止血包⑤）：ws-stream-row-enter 仅挂「真正新追加」的行——
  首屏水合批次与整表替换（切会话/回源重建）不播动画，窗口切片滚动进出的旧行不播。
  emits：block-action / manuscript-local-action / hover / leave / copy / retry /
        tool-confirm / segment-expand / expand / scroll-to-message。
-->
<template>
  <div class="ws-stream-list">
    <!-- 2026-09-05 视口走查 S5 阶段 A：轮次包裹层（data-turn-root）——
         为轮次级窗口化准备测量单元（后续 RO 挂轮次根）；本阶段纯结构，行为不变 -->
    <div
      v-for="group in groups"
      :key="group.id"
      class="ws-turn-root"
      :data-turn-root="group.id"
    >
      <!-- ① 用户消息层 -->
      <StreamRow
        v-if="group.user"
        :item="group.user"
        :animated="animatedIds.has(group.user.id)"
        :is-hovered="hoveredId === group.user.id"
        @hover="onHover"
        @leave="onLeave"
        @copy="(m) => emit('copy', m)"
        @retry="(m) => emit('retry', m)"
      />
      <!-- ② LLM 过程层（data-turn-id 供折叠控制器做视口判定） -->
      <div v-if="group.process.length > 0" class="ws-turn-process" :data-turn-id="group.id">
        <!-- 2026-09-04 多级折叠树渲染：组合行段 / 计划折叠区 / 待办项 / 普通行 由 ProcessBlocks 递归渲染 -->
        <ProcessBlocks
          :blocks="group.process"
          :turn-id="group.id"
          :combo-expanded="comboExpanded"
          :zone-collapsed-map="planZonesCollapsed ?? {}"
          :animated-ids="animatedIds"
          :hovered-id="hoveredId"
          @combo-toggle="toggleCombo"
          @plan-zone-toggle="(tid) => emit('plan-zone-toggle', tid)"
          @plan-step-toggle="(p) => emit('plan-step-toggle', p)"
          @hover="onHover"
          @leave="onLeave"
          @copy="(m) => emit('copy', m)"
          @block-action="(e) => emit('block-action', e)"
          @manuscript-local-action="(e) => emit('manuscript-local-action', e)"
          @tool-confirm="(e) => emit('tool-confirm', e)"
          @segment-expand="(tid) => emit('segment-expand', tid)"
          @expand="(tid) => emit('expand', tid)"
        />
      </div>
      <!-- ③ LLM 结果层（唯一带操作栏，由 AssistantRow 的 isResult 驱动）
           data-result-turn-id：折叠/展开过程层时作为滚动锚点，避免高度骤变导致视口跳动 -->
      <div v-if="group.result" class="ws-turn-result" :data-result-turn-id="group.id">
        <StreamRow
          :item="group.result"
          :animated="animatedIds.has(group.result.id)"
          :is-hovered="hoveredId === group.result.id"
          @hover="onHover"
          @leave="onLeave"
          @copy="(m) => emit('copy', m)"
          @block-action="(e) => emit('block-action', e)"
          @manuscript-local-action="(e) => emit('manuscript-local-action', e)"
        />
      </div>
      <!-- 尾部行：结果层之后仍属于本轮次的行（如中止「已停止」分隔行） -->
      <StreamRow
        v-for="row in group.tail"
        :key="row.id"
        :item="row"
        :animated="animatedIds.has(row.id)"
        :is-hovered="hoveredId === row.id"
        @hover="onHover"
        @leave="onLeave"
        @copy="(m) => emit('copy', m)"
        @block-action="(e) => emit('block-action', e)"
        @manuscript-local-action="(e) => emit('manuscript-local-action', e)"
        @tool-confirm="(e) => emit('tool-confirm', e)"
        @expand="() => emit('segment-expand', group.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgentStreamItem } from '@worldsea/shared-composables/agent/useAgent'
import { aggregatePlanBlocks, type ProcessBlock } from './aggregatePlanBlocks'
import ProcessBlocks from './ProcessBlocks.vue'
import StreamRow from './rows/StreamRow.vue'
import type { AgentMessage, BlockActionEvent } from '../bubbles/types'
import './stream.css'

type UserItem = Extract<AgentStreamItem, { type: 'user' }>
type AssistantItem = Extract<AgentStreamItem, { type: 'assistant' }>

/** 轮次分组：一个 Turn 的三层结构 + 尾部行 */
interface TurnGroup {
  id: string
  /** ① 用户消息层；窗口切片从轮次中间开始时为 null */
  user: UserItem | null
  /** ② 过程层（扁平输入行；聚合后为块序列 ProcessBlock[]，供 ProcessBlocks 树渲染） */
  process: ProcessBlock[]
  /** ③ 结果层；结果层未落地时为 null */
  result: AssistantItem | null
  /** 结果层之后仍属于本轮次的行（如中止分隔行） */
  tail: AgentStreamItem[]
}

/** 事件行流 items */
const props = defineProps<{
  items: AgentStreamItem[]
  /** 2026-09-04 待办项升级：计划步骤折叠区的区级折叠态（turnId → planCollapsed，数据层持久） */
  planZonesCollapsed?: Record<string, boolean>
}>()

/**
 * 按轮次分组：以 user 行开启新组，isResult 的正文行归为结果层，其后行入 tail
 *
 * 过程层（process）在分组基础上再做「计划步骤块」聚合：isPlanStep 行作为块头，
 * 其后紧邻的、id 属于该步骤 childRefIds 的行收集为块内子动作（默认折叠可展开）。
 * 分组只做「切段」，不改变行的相对顺序——窗口化依赖渲染顺序与 items 顺序一致。
 */
const groups = computed<TurnGroup[]>(() => {
  const out: TurnGroup[] = []
  let cur: TurnGroup | null = null
  for (const it of props.items) {
    if (it.type === 'user') {
      // group.id 取 turnId（折叠 latch 归属用）；旧调用方未带 turnId 时回退行 id
      cur = { id: it.turnId ?? it.id, user: it, process: [], result: null, tail: [] }
      out.push(cur)
      continue
    }
    // 切片从轮次中间开始：造无用户行的组承接，避免行被丢弃
    if (!cur) {
      cur = { id: `orphan-${it.id}`, user: null, process: [], result: null, tail: [] }
      out.push(cur)
    }
    if (it.type === 'assistant' && it.isResult) {
      // 同组已存在结果层属异常数据：开新组承载，避免后者覆盖前者
      if (cur.result) {
        cur = { id: `tail-${it.id}`, user: null, process: [], result: null, tail: [] }
        out.push(cur)
      }
      cur.result = it
    } else if (cur.result) {
      cur.tail.push(it)
    } else {
      cur.process.push(it)
    }
  }
  // 2026-09-04 多级折叠树聚合：把 process 扁平行 → 嵌套块序列（组合行段 / 待办项 / 计划折叠区）
  for (const g of out) {
    if (!g.process.length) continue
    g.process = aggregatePlanBlocks(g.process as unknown as AgentStreamItem[])
  }
  return out
})

// ===== 组合行段本地展开态（组件内 ref；2026-09-05 调整为默认折叠：集合含 id=展开，
// 切窗重挂与 think 行一样重置——重置后为默认折叠态）=====
const comboExpanded = ref<Set<string>>(new Set())
function toggleCombo(id: string): void {
  const next = new Set(comboExpanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  comboExpanded.value = next
}

// ===== 入场动画治理（止血包⑤）=====
// seenIds：本组件实例生命周期内已渲染过的行 id；animatedIds：本批次新追加、需播动画的行 id。
const seenIds = new Set<string>()
const animatedIds = ref<Set<string>>(new Set())
let hydrated = false

watch(() => props.items, (items) => {
  if (items.length === 0) return
  // 首屏水合：全部静默入场（整屏渐入=闪烁）
  if (!hydrated) {
    for (const it of items) seenIds.add(it.id)
    hydrated = true
    return
  }
  // 整表替换检测（切会话/回源重建）：未见过的行占比过高时按重新水合处理，静默渲染
  let unseen = 0
  for (const it of items) if (!seenIds.has(it.id)) unseen++
  if (unseen > 0 && unseen / items.length > 0.8) {
    seenIds.clear()
    for (const it of items) seenIds.add(it.id)
    animatedIds.value = new Set()
    return
  }
  // 常规追加：仅真正新出现的行播入场动画；窗口切片滚回的旧行（在 seenIds 中）静默
  if (unseen === 0) {
    animatedIds.value = new Set()
    return
  }
  const next = new Set<string>()
  for (const it of items) {
    if (!seenIds.has(it.id)) {
      seenIds.add(it.id)
      next.add(it.id)
    }
  }
  animatedIds.value = next
}, { immediate: true, deep: false })

/** 当前 hover 的行 id（驱动 User/Assistant 操作栏显隐；hover 事件透传给父层） */
const hoveredId = ref<string | null>(null)
function onHover(id: string) {
  hoveredId.value = id
  emit('hover', id)
}
function onLeave() {
  hoveredId.value = null
  emit('leave')
}

const emit = defineEmits<{
  (e: 'block-action', event: BlockActionEvent): void
  (e: 'manuscript-local-action', event: BlockActionEvent): void
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'retry', msg: AgentMessage): void
  (e: 'tool-confirm', event: { toolId: string; approved: boolean }): void
  /** 用户展开了某轮次的某个行段 → 置 userEverExpanded latch（折叠三条件分派用） */
  (e: 'segment-expand', turnId: string): void
  /** 用户点击折叠摘要行 → 解除该轮次的过程层折叠 */
  (e: 'expand', turnId: string): void
  (e: 'scroll-to-message', msgId: string): void
  /** 2026-09-02 用户展开/收起计划步骤 → 驱动 turnModel plan_step_toggle */
  (e: 'plan-step-toggle', payload: { turnId: string; stepId: string }): void
  /** 2026-09-04 用户展开/收起计划折叠区 → 驱动 turnModel plan_zone_toggle（翻转 turn.planCollapsed） */
  (e: 'plan-zone-toggle', turnId: string): void
}>()
</script>

<template>
  <div class="chat-messages" ref="messagesContainer">
    <div class="messages-scroll">
      <!-- 空对话欢迎语 -->
      <MessageListEmpty v-if="messages.length === 0 && archivedBoundaryIndex === 0">
        <template #icon>
          <WorldSeaLogo :size="48" :radius="14" />
        </template>
        <!-- 项目=目录（2026-09-03）：空态内嵌项目选择器 pill，替代原输入栏 WorkdirSelect -->
        <template #hint>
          我可以帮你管理 <ProjectSwitcher variant="pill" /> 世界观实体和关系。试试输入 / 查看可用命令
        </template>
      </MessageListEmpty>

      <!-- P12 决策：已归档消息折叠区（设计文档 5.5 节） -->
      <ArchivedSection
        v-if="archivedBoundaryIndex > 0"
        :archived-boundary-index="archivedBoundaryIndex"
        :archive-summary-text="archiveSummaryText"
        @open-archive-panel="emit('open-archive-panel')"
      />

      <A2UIRenderer
        v-if="hasA2UISurfaces"
        :surfaces="a2uiSurfaces"
        :resolve-binding="resolveDataBinding"
        @action="onA2UIAction"
      />

      <!-- 顶部占位:窗口以上所有事件行的估算高度总和 -->
      <div
        v-if="windowedDisplayItems.topPlaceholderHeight > 0"
        class="window-placeholder"
        :style="{ height: windowedDisplayItems.topPlaceholderHeight + 'px' }"
        aria-hidden="true"
      ></div>

      <!-- 事件行流：窗口内切片全量交给 AgentStreamList 渲染（去模式分叉，单一扁平形态）。
           窗口化由本层支配，AgentStreamList 只做纯行渲染 + 事件透传。 -->
      <AgentStreamList
        :items="windowedDisplayItems.items"
        :plan-zones-collapsed="planZonesCollapsed"
        @block-action="emit('block-action', $event)"
        @manuscript-local-action="emit('manuscript-local-action', $event)"
        @copy="emit('copy', $event)"
        @retry="emit('retry', $event)"
        @tool-confirm="onToolConfirm"
        @expand="onExpandProcess"
        @segment-expand="onSegmentExpand"
        @plan-step-toggle="onPlanStepToggle"
        @plan-zone-toggle="onPlanZoneToggle"
        @scroll-to-message="scrollToMessage"
      />

      <!-- 底部占位:窗口以下所有事件行的估算高度总和 -->
      <div
        v-if="windowedDisplayItems.bottomPlaceholderHeight > 0"
        class="window-placeholder"
        :style="{ height: windowedDisplayItems.bottomPlaceholderHeight + 'px' }"
        aria-hidden="true"
      ></div>

      <!-- M2 编排段：已完成 run 折叠卡 + 活跃 run 实时段（串行场景流尾追加） -->
      <OrchestrationSegment
        v-for="r in finishedRuns"
        :key="`orch-${r.runId}`"
        :run="r"
        @abort-request="onAbortOrchestration"
        @open-detail="onOpenDetail"
      />
      <OrchestrationSegment
        v-if="activeRun"
        :key="`orch-active-${activeRun.runId}`"
        :run="activeRun"
        @abort-request="onAbortOrchestration"
        @open-detail="onOpenDetail"
      />

      <!-- 统一等候动画（2026-09-04）：运行时无运行中行段时显示（行段承载运行态）；
           行段出现后淡出（leave 延迟 0.4s 与行段淡入衔接 → 两者交叉）；
           文字为当前处理阶段（正在思考/读取…）；O5：编排 run 活跃时不显示 -->
      <Transition name="wait-cross">
        <StreamingPlaceholder
          v-if="!activeRun && isStreaming && !hasRunningSegment"
          :text="awaitingActionText"
          :start-time="turnStartTime"
        >
          <template #icon>
            <WorldSeaLogo :size="15" :radius="4" />
          </template>
        </StreamingPlaceholder>
      </Transition>

      <!-- 会话标题生成中等候（首条消息后、标题落地前显示；纳入统一形态的 compact 小号版） -->
      <Transition name="fade">
        <StreamingPlaceholder
          v-if="sessionTitlePending?.[currentSessionId] && !isStreaming"
          :text="'正在生成会话标题'"
          compact
        />
      </Transition>

      <!-- [⑥] 会话错误行：由 activity log error 项派生 -->
      <ErrorRows :error="turnError" />

      <!-- total_steps 预算满额横幅：模型工具调用轮数达到上限，可「继续」（接续机制占位，见 docs 记录） -->
      <Transition name="fade">
        <div v-if="budgetBannerVisible" class="step-budget-banner" role="status">
          <span class="banner-text">
            模型调用工具轮数达到 {{ latestStepBudget?.limit }} 上限
            （已用 {{ latestStepBudget?.used }} 轮）
          </span>
          <button class="banner-continue" @click="onBudgetContinue">继续↗</button>
        </div>
      </Transition>
    </div>

    <!-- 用户消息点状导航（保留为可选，不再按模式隐藏） -->
    <DotNav
      v-if="userMessages.length"
      :user-messages="userMessages"
      :visible-msg-ids="visibleMsgIds"
      :active-user-id="activeUserMsgId"
      :at-top="atTop"
      :at-bottom="isAtBottom"
      @scroll-to-message="scrollToMessage"
    />

    <!-- 回到底部按钮（纯回底作用，无未读计数） -->
    <ScrollToBottomButton
      :visible="showScrollToBottomBtn"
      @click="jumpToBottom"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import AgentStreamList from '@worldsea/shared-ui/agent/stream/AgentStreamList.vue'
import A2UIRenderer from '@worldsea/shared-ui/agent/a2ui/A2UIRenderer.vue'
import { useAgent } from './composables/useAgent'
import { useActivityLog } from './composables/useActivityLog'
import { useArchiveStore } from '../stores/archiveStore'
import { watchDebounced } from '@worldsea/perf-kit/render'
import type { AgentMessage } from '@agent/index'
import type { AgentStreamItem, ChatMode } from '@worldsea/shared-composables/agent/useAgent'
import { useMessageWindowing, useProcessCollapse, MessageListEmpty, ArchivedSection, StreamingPlaceholder, ScrollToBottomButton, DotNav, ErrorRows } from '@worldsea/shared-ui/agent/message-list'
// 2026-09-04 等候动画文字流转：复用行段前缀动词（与 ToolRow 语义一致）
import { getOpKind, OP_VERB } from '@worldsea/shared-ui/agent/stream/rows/toolSemantics'
// M2：编排迹线（useOrchestrationTrace 聚合 + 编排段渲染）
import OrchestrationSegment from './components/OrchestrationSegment.vue'
import { useOrchestrationTrace } from './composables/useOrchestrationTrace'
import { useSessionViewState } from './composables/useSessionViewState'
import { invoke } from './composables/transport'
import { useAgentRust } from './composables/useAgentRust'
import type { ExecTab } from '@/space/stores/space-store'
import WorldSeaLogo from '@/components/brand/WorldSeaLogo.vue'
import ProjectSwitcher from '@/ui/project/ProjectSwitcher.vue'

const { agentStream, resolveToolConfirmation, sessionTitlePending, currentSessionId, setProcessCollapsed, markTurnExpanded, autoCollapseProcess, turns, applyTurnEvent } = useAgent()
const archiveStore = useArchiveStore()
const { logs: activityLogs } = useActivityLog()
// total_steps 预算横幅：latestStepBudget 由 event bridge 流通道 step_budget_warning 刷新
const agentRust = useAgentRust()
const { latestStepBudget, clearStepBudgetHint, sendMessage: sendAgentMessage } = agentRust
// M2：编排迹线（状态由 useAgentRust 会话生命周期统一维护，本组件纯消费）+ 中止处理
const { activeRun, finishedRuns } = useOrchestrationTrace()
const sessionViewState = useSessionViewState()

/** 预算横幅可见：满额（percent≥100）+ 当前会话（避免历史会话残留横幅） */
const budgetBannerVisible = computed(() => {
  const b = latestStepBudget.value
  if (!b || b.percent < 100) return false
  if (!currentSessionId.value) return false
  return true
})

/**
 * 「继续↗」占位实现（2026-09-01）：
 * 直接发送「继续执行」推进任务——新用户消息会重置 total_steps 计数（agent/mod.rs 新用户消息重置），
 * 模型在既有上下文中继续行动。语义=接续，但更完善的接续机制（预算续期/上下文裁剪/子任务续跑）
 * 记入待办——docs/plans/2026-09-01-系统触达面补齐调研.md §七 7.2「接续机制完善」。
 */
async function onBudgetContinue(): Promise<void> {
  clearStepBudgetHint()
  await sendAgentMessage('继续执行')
}

/** M3 详图驱动：点击编排段入口卡 → 右栏 ExecPanel 切到对应详图 tab（A4）；tab 来自组件内固定映射，运行时安全 */
function onOpenDetail(tab: string): void {
  sessionViewState.setExecTab(tab as ExecTab)
}

/** 中止按钮：复用后端 abort 命令（M2-4） */
async function onAbortOrchestration(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) return
  try {
    await invoke('abort', { sessionId: sid })
  } catch (err) {
    console.error('[AgentMessageList] 中止编排失败:', err)
  }
}

/**
 * 过程层折叠/展开的滚动锚点：优先锚定该轮次的过程层头行（process_summary，data-msg-id={turnId}-process），
 * 折叠态=摘要行 / 展开态=常驻折叠头行，二者 DOM 元素稳定（同 id），其顶部位置在展开/折叠时不动——
 * 正是「折叠条位置不动、下方内容下移」的正确锚定。
 * 无过程头行（该轮次无过程内容）时退回结果层锚点（data-result-turn-id）。
 *
 * 修复⑦-b（2026-09-04）：原以结果层为锚，当用户正处于过程层中部（结果层在视口外下方）时，
 * 展开会把视口拽向结果层 → 视觉回顶/跳动。改用过程层头行锚定解决。
 */
function findProcessAnchor(scroll: HTMLElement, turnId: string): HTMLElement | null {
  const processId = `${turnId}-process`
  for (const el of scroll.querySelectorAll<HTMLElement>('[data-msg-id]')) {
    if (el.dataset.msgId === processId) return el
  }
  return null
}
function findResultAnchor(scroll: HTMLElement, turnId: string): HTMLElement | null {
  for (const el of scroll.querySelectorAll<HTMLElement>('[data-result-turn-id]')) {
    if (el.dataset.resultTurnId === turnId) return el
  }
  return null
}

/**
 * 在改变过程层折叠态前后保持锚点（过程层头行优先，结果层兜底）的视口位置不变
 *
 * 过程层展开/收起会让高度骤变数百 px：不补偿的话视口内容整体位移，
 * 用户正在读的内容会突然跑掉——这正是要消除的"不稳定"。
 * 抖动修复②（2026-09-04）：补偿写入 scrollTop 后同步窗口化账本（syncObservedTop），
 * 避免 onScroll 误判为「读者离开底部」→ isAtBottom 被打回 false → 自动跟随断流；
 * 且若折叠/展开前正在底部跟随态，补偿后顺延跟随到底（防止锚点补偿把视口拉离底部）。
 */
function withProcessAnchor(turnId: string, mutate: () => void): void {
  const scroll = messagesContainer.value?.querySelector<HTMLElement>('.messages-scroll') ?? null
  const anchor = scroll ? (findProcessAnchor(scroll, turnId) ?? findResultAnchor(scroll, turnId)) : null
  const beforeTop = anchor ? anchor.getBoundingClientRect().top : null
  const wasAtBottom = isAtBottom.value
  mutate()
  // 抖动修复⑦（2026-09-04）补充：无过程头行/结果层锚点（执行中轮次/锚点在窗口外）时不补偿；
  // 但若折叠/展开前在底部跟随态，必须保持贴底（防止结构突变把视口顶回顶部）。
  if (!scroll) return
  if (wasAtBottom) {
    scheduleScrollToBottom()
  }
  if (!anchor || beforeTop === null) return
  const compensate = () => {
    // 抖动修复⑦（2026-09-04）：展开过程层 → items 重排，若锚点（结果层）被窗口化切片卸载
    //（detached），getBoundingClientRect() 返回 (0,0) → delta 巨大负值 → scrollTop 被 clamp 到 0
    // =「页面自动回到最顶部」。detached 时跳过补偿，交给窗口化锚定/占位兜底。
    if (!anchor.isConnected) return
    // 强制同步布局：读取最终高度（offsetHeight 触发 reflow），在浏览器绘制前完成补偿，
    // 避免「渲染-补偿-再渲染」两帧闪现（这是点击折叠条视口「抖一下」的来源）
    void scroll.offsetHeight
    void anchor.offsetHeight
    const delta = anchor.getBoundingClientRect().top - beforeTop
    // delta<0：锚点上移（高度减少）→ 同步下移 scrollTop，使其回到原视口位置
    // S4：折叠补偿走调度器（fold-compensate 最高优先级 + 300ms 贴底保护期）
    if (Math.abs(delta) > 0.5) requestScroll(scroll, scroll.scrollTop + delta, 'fold-compensate')
    // 程序化位移记账：避免被 onScroll 误判为读者离开底部（调度器内置记账，此处兜底同步）
    syncObservedTop()
  }
  // 双帧：折叠/展开会连锁改变邻近行高度，单次 nextTick 补偿在首帧可能不完整
  nextTick(() => {
    compensate()
    requestAnimationFrame(compensate)
  })
}

/**
 * 过程层折叠摘要行点击：按当前态切换（折叠 → 展开 / 展开态头行 → 收起）
 * 折叠态写在 Turn 上（含 processPeeked 常驻头行标记），切会话后仍一致
 */
function onExpandProcess(turnId: string): void {
  // 底部展开补丁（2026-09-05 用户建议）：底部跟随态下点击总折叠头是主动交互——
  // 先解除跟随，让 withProcessAnchor 的锚定补偿生效（视口停住看展开的过程层，
  // 结果层随内容下移）。否则补偿后 50ms 内流式跟随（watchDebounced）会把视口
  // 贴回底部，结果层被钉在最底部、展开内容全部顶在视口上方看不见。
  isAtBottom.value = false
  const turn = turns.value.find(
    (t: { id: string; processCollapsed: boolean }) => t.id === turnId,
  )
  const next = turn ? !turn.processCollapsed : false
  withProcessAnchor(turnId, () => setProcessCollapsed(turnId, next))
}

/** 自动折叠执行点：补偿滚动后再折叠，避免视口跳动 */
function onCollapseProcess(turnId: string): void {
  withProcessAnchor(turnId, () => autoCollapseProcess(turnId))
}

/** 行段展开（推理/工具详情）：置 userEverExpanded latch，供折叠三条件分派 */
function onSegmentExpand(turnId: string): void {
  markTurnExpanded(turnId)
}

/** 2026-09-02 计划步骤折叠切换：归约驱动 turnModel plan_step_toggle（翻转 stepCollapsed） */
function onPlanStepToggle(payload: { turnId: string; stepId: string }): void {
  // 防抖修复（2026-09-04）：计划步骤展开/收起同样造成高度骤变，需锚定补偿
  // （此前仅 onExpandProcess/onCollapseProcess 走 withProcessAnchor，计划步骤 toggle 无补偿 → 视口抖动）
  withProcessAnchor(payload.turnId, () => {
    applyTurnEvent(currentSessionId.value, {
      type: 'plan_step_toggle',
      turnId: payload.turnId,
      stepId: payload.stepId,
    })
  })
}

/** 2026-09-04 待办项升级：计划折叠区区级折叠态映射（turnId → planCollapsed；跨切窗持久） */
const planZonesCollapsed = computed<Record<string, boolean>>(() => {
  const map: Record<string, boolean> = {}
  for (const t of turns.value) {
    if ((t as { planCollapsed?: boolean }).planCollapsed) map[(t as { id: string }).id] = true
  }
  return map
})

/** 2026-09-04 待办项升级：区级折叠头切换（翻转 turn.planCollapsed），锚定补偿高度骤变 */
function onPlanZoneToggle(turnId: string): void {
  withProcessAnchor(turnId, () => {
    applyTurnEvent(currentSessionId.value, { type: 'plan_zone_toggle', turnId })
  })
}

const props = withDefaults(defineProps<{
  messages: Array<AgentMessage>
  isStreaming: boolean
  lastAssistantHasContent: boolean
  lastAssistantHasThinking: boolean
  a2uiSurfaces: Record<string, any>
  resolveDataBinding: (binding: any, dataModel: Record<string, unknown>) => any
  /** @deprecated legacy：不再驱动渲染形态（列表层已全面用 agentStream 事件行流） */
  chatMode?: ChatMode
  /** @deprecated legacy：不再驱动渲染形态 */
  useDeepLayout?: boolean
}>(), {
  useDeepLayout: true,
})

const emit = defineEmits<{
  'a2ui-action': [surfaceId: string, action: { name: string; data?: any }]
  'block-action': [event: { blockId: string; action: string; data?: Record<string, unknown> }]
  'manuscript-local-action': [event: { blockId: string; action: string; data?: Record<string, unknown> }]
  'open-archive-panel': []
  copy: [msg: any]
  retry: [msg: any]
}>()

// [④] Turn 状态计时锚定：isStreaming 由假转真的上升沿记录 turn 开始时间
const turnStartTime = ref<number | null>(null)
watch(() => props.isStreaming, (streaming, was) => {
  if (streaming && !was) turnStartTime.value = Date.now()
  else if (!streaming) turnStartTime.value = null
})

/** 2026-09-04 等候动画文字流转：跟随当前正在执行的动作行段前缀文字
 *  （think → 「正在思考」；tool running → 「正在{动词}」；无活动行段 → 「正在处理」） */
const awaitingActionText = computed(() => {
  const rows = agentStream.value
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.type === 'think' && r.status === 'streaming') return '正在思考'
    if (r.type === 'tool' && r.tc.status === 'running') {
      return `正在${OP_VERB[getOpKind(r.tc.name)] ?? '处理'}`
    }
  }
  return '正在处理'
})

/** 2026-09-04 交叉显示：是否有运行中的行段（推理 streaming / 工具 running）。
 *  有 → 行段承载运行态（前缀流光），等候动画淡出；无 → 等候动画淡入（等待下一行段/正文）。 */
const hasRunningSegment = computed(() => {
  const rows = agentStream.value
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.type === 'think' && r.status === 'streaming') return true
    if (r.type === 'tool' && r.tc.status === 'running') return true
  }
  return false
})

// [⑥] 会话错误行：取 activity log 最近的 error 项派生
const turnError = computed<{ message: string; code?: string } | null>(() => {
  const last = [...activityLogs.value].reverse().find(l => l.type === 'error')
  if (!last) return null
  return { message: last.message, code: last.detail ? String(last.detail) : undefined }
})

const messagesContainer = ref<HTMLDivElement>()

// ─── 过程层自动折叠（§3.4 三条件）──────────────────────────
// 结果层落地后按三条件折叠该轮次的过程层：未展开过 → 立即；
// 展开过但在视口内 → 空闲 5s；展开过且已滚出视口 → 立即。
// latch（hasAutoCollapsed）保证每个轮次只自动折叠一次，用户手动展开后不再自动收起。
useProcessCollapse({
  turns,
  container: messagesContainer,
  // 经 onCollapseProcess 包装：先记锚点位置，折叠后补偿 scrollTop
  onCollapse: onCollapseProcess,
})

/** 从 archiveStore 读取归档边界索引（响应式） */
const archivedBoundaryIndex = computed(() => archiveStore.archivedBoundaryIndex)

/**
 * 从 messages 中提取归档摘要文本。
 * injectHookSummary 在 messages 开头插入了 source='memory-archive' 的系统消息，
 * 这里提取该消息的 content 作为归档摘要展示。
 */
const archiveSummaryText = computed(() => {
  if (archivedBoundaryIndex.value === 0) return ''
  const summaryMsg = props.messages.find(
    m => m.role === 'system' && (m as any).metadata?.source === 'memory-archive'
  )
  return summaryMsg?.content || ''
})

/** 所有用户消息（供点状导航使用，锚定 id 与事件流中 user 行 id 一致） */
const userMessages = computed(() => props.messages.filter(m => m.role === 'user'))

/** 行级高度分桶估算（止血包③）：事件行高度分布极端不均（tool 行 ~32px vs 长 markdown 行数千 px），
 *  全局平均估算两头失真导致窗口切片/占位高度大幅偏差；按行类型给矮行固定估值，高行回落测量平均 */
function estimateRowHeight(row: AgentStreamItem): number | undefined {
  switch (row.type) {
    case 'tool': return 32       // 扁平工具单行（padding 4*2 + 行高 ~24）
    case 'divider': return 33    // margin 8*2 + 文本行 ~17
    case 'think': return 60      // 折叠态单行 + 标题；流式展开态由 ResizeObserver 实测覆盖
    case 'assistant': {
      // 走查 S1（2026-09-05）：结果层 markdown 按内容长度估算——原回落全局平均 80px，
      // 长文（实际数千 px）严重低估 → 窗口切片边界/占位失真、收敛期抖动的最大误差源。
      // 系数为经验值：行宽 ~640px ≈ 42 中文字/行 × 行高 24px ≈ 0.57px/字符 + 基础 48px。
      const len = row.msg.content.length
      return 48 + len * 0.57
    }
    case 'user': {
      const len = row.msg.content.length
      return 44 + len * 0.57
    }
    default: return undefined    // 其余回落全局测量平均
  }
}

/** 渲染窗口化 + 滚动锚定 + 可见性观察：数据源为事件行流 agentStream（去 isDeepMode 分叉） */
const {
  windowedDisplayItems,
  showScrollToBottomBtn,
  visibleMsgIds,
  activeUserMsgId,
  jumpToBottom,
  scrollToBottom,
  scrollToMessage,
  scheduleScrollToBottom,
  syncObservedTop,
  isAtBottom,
  atTop,
  requestScroll,
} = useMessageWindowing<AgentStreamItem>({
  container: messagesContainer,
  items: computed(() => agentStream.value),
  messages: computed(() => props.messages),
  estimateHeight: estimateRowHeight,
  // 导航点激活推导：用户消息 id 集合（userMessages 由消息流派生）
  userMsgIds: computed(() => new Set(userMessages.value.map((m) => m.id))),
})

/** 是否存在 A2UI 界面 */
const hasA2UISurfaces = computed(() => Object.keys(props.a2uiSurfaces).length > 0)

/** A2UI 动作转发 */
function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  emit('a2ui-action', surfaceId, action)
}

/** 工具确认回调（选择型/确认型工具，事件行流 ToolRow 透传） */
function onToolConfirm(event: { toolId: string; approved: boolean }): void {
  resolveToolConfirmation(event.toolId, event.approved)
}

// ===== 自动滚动到底部的触发时机 =====
// 事件行数组、A2UI 界面、末条助手正文内容长度变化时，若用户在底部跟随状态则自动滚动
watchDebounced(() => agentStream.value.length, () => scheduleScrollToBottom(), { debounce: 50 })
// 流式输出：末条助手正文行 content 原地增长（delta 不可变替换），跟随其长度变化持续自动跟随
watchDebounced(
  () => {
    const stream = agentStream.value
    let lastLen = 0
    for (let i = stream.length - 1; i >= 0; i--) {
      const row = stream[i]
      if (row.type === 'assistant') {
        lastLen = (row.msg.content?.length ?? 0) + ((row.msg as { thinking?: string }).thinking?.length ?? 0)
        break
      }
    }
    return lastLen
  },
  () => scheduleScrollToBottom(),
  { debounce: 30 },
)
watchDebounced(() => Object.keys(props.a2uiSurfaces).length, () => scheduleScrollToBottom(), { debounce: 50 })

// 保持公共契约：父组件 AgentChat 通过 ref 调用 scrollToBottom 和访问 messagesContainer
defineExpose({
  scrollToBottom,
  messagesContainer
})
</script>

<style scoped>
.chat-messages {
  flex: 1;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: row;
  position: relative;
  min-height: 0;
}

.messages-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: none;
  min-height: 0;
  /* [2] 消息流区域宽度跟随输入栏（--conv-w）：内容居中，与输入栏同宽 */
  width: 100%;
  max-width: var(--conv-w);
  align-self: center;
  /* 止血包：禁用浏览器原生 scroll anchoring——流式内容增长时原生锚定会自动调整 scrollTop，
     与自制锚定（observedTop 账本 + 程序化 scrollToBottom）互相打架，是视口跳动的来源之一 */
  overflow-anchor: none;
  /* 抖动修复㉑（2026-09-05）：阻断顶/底边界的滚动链传递——滚到边界继续滚时滚轮事件
     不再穿透祖先滚动容器，避免外层布局随动造成的边界闪烁 */
  overscroll-behavior: contain;
}

.messages-scroll > * {
  flex-shrink: 0;
}

.messages-scroll::-webkit-scrollbar {
  display: none;
}

/* 性能优化:窗口化占位符 - 不参与可见布局,仅撑开滚动条高度 */
.window-placeholder {
  width: 100%;
  flex-shrink: 0;
  pointer-events: none;
}

/* total_steps 预算满额横幅：弱化警示条（非报错红），强调「继续」动作。fade 过渡与全局一致 */
.step-budget-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 6px 0;
  padding: 8px 12px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border, var(--border));
  background: var(--bg-muted, var(--color-surface-elevated));
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-secondary);
}
.banner-continue {
  flex-shrink: 0;
  padding: 3px 12px;
  border-radius: var(--radius-pill, 14px);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  font-size: var(--font-size-xs, 12px);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--dur-fast, 0.15s);
}
.banner-continue:hover {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}

/* 等候动画 ↔ 运行行段交叉过渡：
 * enter 立即淡入（行段间隙时尽快出现）；leave 延迟 0.4s 淡出——与行段入场
 * delay 0.4s（流区 ws-stream-row-enter）对齐，行段淡入时等候动画同步淡出 */
.wait-cross-enter-active { transition: opacity 0.22s ease; }
.wait-cross-enter-from,
.wait-cross-leave-to { opacity: 0; }
.wait-cross-leave-active { transition: opacity 0.22s ease 0.4s; }
</style>
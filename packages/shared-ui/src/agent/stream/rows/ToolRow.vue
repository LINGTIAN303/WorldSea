<!--
  ToolRow：扁平工具行
  - 非交互工具：单行（状态点脉冲/✓/✗ + 工具名 + 状态文案 + 参数摘要 + chevron），点击展开详情（参数+结果）；
  - choice/confirm/display 交互工具：整行内嵌 <InteractiveToolCall> 保留交互。
  取消卡片边框/背景装饰（自带扁平样式，复用 InlineToolCall 的逻辑代码而非其外壳）。
  emits：block-action / tool-confirm / hover / leave。
-->
<template>
  <div
    class="ws-stream-row ws-stream-tool"
    :data-msg-id="item.id"
    :data-animating="animating ? '' : undefined"
    @mouseenter="emit('hover', item.id)"
    @mouseleave="emit('leave')"
  >
    <!-- 交互工具：保留选择/确认交互 -->
    <InteractiveToolCall
      v-if="isInteractive"
      :tc="item.tc"
      @block-action="(e) => emit('block-action', e)"
      @tool-confirm="(e) => emit('tool-confirm', e)"
    />
    <!-- 普通工具：扁平单行 -->
    <template v-else>
      <!-- 2026-09-04 折叠条文字化 v2：仅前缀文字（verb+subject+name）可点击展开，其余元素
           只读展示；无 hover 背景高亮；仅 running 时前缀文字字形内流光（ws-shine-text） -->
      <div
        class="ws-stream-tool-summary"
        :class="[`kind-${rowKind}`, { 'is-failed': isFailed }]"
      >
        <!-- 2026-09-05 箭头移前缀（用户拍板）：详情展开 chevron 放行首（open 旋转语义保留）；
             2026-09-05 二轮：失败行恢复可展开（与其他行一致），chevron 悬停显示推广至全部行段 -->
        <WsIcon name="chevron-right" size="xs" class="ws-stream-tool-chevron" :class="{ open: isExpanded }" />
        <!-- 能力类图标（R-0 分派 15 类）；文件类改用文件类型图标（R-a：ui-kit 资产两端共用） -->
        <FileIcon v-if="isFileClass && fileName" :name="fileName" class="ws-stream-tool-fileicon" />
        <component v-else :is="markIcon" size="14" stroke="1.75" class="ws-stream-tool-mark-icon" />
        <!-- 前缀文字（点击区）：语义动词 + 操作对象 + 工具名；点击展开详情，running 时流光 -->
        <span
          class="ws-stream-tool-prefix"
          :class="{ 'ws-shine-text': isStreaming }"
          role="button"
          tabindex="0"
          :aria-expanded="isExpanded"
          :title="subjectTitle || undefined"
          @click="toggleExpand"
          @keydown.enter.prevent="toggleExpand"
          @keydown.space.prevent="toggleExpand"
        >
          <span v-if="shellLabel" class="ws-stream-tool-shell">{{ shellLabel }}</span>
          <span class="ws-stream-tool-verb">{{ verb }}</span>
          <span v-if="summarySubject" class="ws-stream-tool-subject">{{ summarySubject }}</span>
          <span class="ws-stream-tool-name">({{ label }})</span>
        </span>
        <!-- 状态标识在前缀右侧（2026-09-05 用户拍板）：running 脉冲点；completed/failed 用 ✓/✗ -->
        <span class="ws-stream-tool-dot" :class="item.tc.status" v-if="item.tc.status === 'running'"></span>
        <WsIcon v-else-if="item.tc.status === 'completed'" name="check" size="xs" class="ws-stream-tool-icon-success" />
        <WsIcon v-else name="x" size="xs" class="ws-stream-tool-icon-fail" />
        <!-- 只读信息：沙箱徽标 / 效果标签 / 执行耗时 / 错误摘要 / 参数预览（不可点击） -->
        <span
          v-if="!isFailed && (sandboxDenied || sandboxLabel)"
          class="ws-stream-tool-sandbox"
          :class="{ 'is-denied': sandboxDenied }"
          :title="sandboxTitle || undefined"
        >{{ sandboxDenied ? '沙箱拒绝' : sandboxLabel }}</span>
        <span v-if="!isFailed && effect" class="ws-stream-tool-effect">{{ effect }}</span>
        <span v-if="durationText" class="ws-stream-tool-duration">{{ durationText }}</span>
        <span v-if="isFailed" class="ws-stream-tool-error">{{ errorText }}</span>
        <span v-else-if="argsPreview" class="ws-stream-tool-args">{{ argsPreview }}</span>
      </div>
      <!-- 展开详情（R 批 R-a：按能力类分派——终端卡 / 文件卡（读·列）/ 通用）；
           折叠外壳（动画 + aria）统一由本行段持有，子组件只产出内容 -->
      <div class="ws-stream-tool-collapse" :class="{ open: isExpanded }" :aria-hidden="!isExpanded">
        <ToolTerminalDetail v-if="detailKind === 'terminal'" :item="item" />
        <ToolFileDetail
          v-else-if="detailKind === 'file-read' || detailKind === 'file-list'"
          :item="item"
          :kind="detailKind"
        />
        <ToolDetailCollapse v-else :item="item" @view-artifact="(h) => emit('view-artifact', h)" />
      </div>
      <!-- 2026-09-02 系统工具流式：bash/powershell 增量输出（实时累积，随流滚动跟随） -->
      <ToolDeltaOutput :item="item" />
      <!-- 2026-09-02 系统工具流式：文件变更 diff（绿红对比 + 被操作文件完整路径） -->
      <ToolFileChange :item="item" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount, type Component } from 'vue'
import {
  IconBook, IconBrain, IconChecklist, IconEdit, IconFolderOpen, IconMessageQuestion,
  IconPencilPlus, IconPlugConnected, IconRobot, IconSearch, IconTerminal2, IconTextScan2,
  IconTool, IconWorld,
} from '@tabler/icons-vue'
import { FileIcon, WsIcon } from '@worldsea/ui-kit'
import InteractiveToolCall from '../../blocks/InteractiveToolCall.vue'
import { getToolLabel } from '../../bubbles/toolLabels'
import { classifyActionRowKind } from '@worldsea/shared-composables/agent/turnModel'
import {
  getOpKind,
  OP_VERB,
  extractOperationSubject,
  extractEffectLabel,
  formatSandboxMode,
  type ToolMeta,
} from './toolSemantics'
import { useToolClass } from './toolCatalogContext'
import type { ToolClass } from './toolClassify'
import ToolDetailCollapse from './tool-detail/ToolDetailCollapse.vue'
import ToolDeltaOutput from './tool-detail/ToolDeltaOutput.vue'
import ToolFileChange from './tool-detail/ToolFileChange.vue'
import ToolFileDetail from './tool-detail/ToolFileDetail.vue'
import ToolTerminalDetail from './tool-detail/ToolTerminalDetail.vue'
import { detailKindFor, parseToolResult, str } from './tool-detail/toolResult'
import type { ToolItem } from './tool-detail/types'
import type { InteractiveToolType } from '@worldsea/shared-composables/agent/useAgent'

const props = defineProps<{
  item: ToolItem
}>()

const emit = defineEmits<{
  (e: 'block-action', event: { blockId: string; action: string; data?: Record<string, unknown> }): void
  (e: 'tool-confirm', event: { toolId: string; approved: boolean }): void
  (e: 'hover', id: string): void
  (e: 'leave'): void
  /** 用户展开详情：置该轮次的 userEverExpanded latch（折叠三条件分派用） */
  (e: 'expand'): void
  /** UX-c：查看外置原文（内容坐标；壳侧经 memory_read_raw 分片取回） */
  (e: 'view-artifact', hash: string): void
}>()

// ===== 交互类型：choice/confirm/display 走 InteractiveToolCall =====
const interactiveType = computed<InteractiveToolType>(() => props.item.tc.interactiveType || 'none')
const isInteractive = computed(() =>
  interactiveType.value === 'choice' || interactiveType.value === 'confirm' || interactiveType.value === 'display',
)

// ===== 工具名（复用 getToolLabel 作工具名显示） =====
const label = computed(() => getToolLabel(props.item.tc.name))

// ===== 行段种类（行段模型 v2）：归约层推导随流透传；旧路径按工具名回退分类 =====
const rowKind = computed(() => props.item.tc.rowKind ?? classifyActionRowKind(props.item.tc.name))

// ===== 操作语义（按工具名分类 + args 提取对象名） =====
const op = computed(() => getOpKind(props.item.tc.name))
const verb = computed(() => OP_VERB[op.value])

// ===== R 批 R-0：能力类分派（① Rust 工具目录 → ② 静态规则 → generic 兜底） =====
const classify = useToolClass()
const toolClass = computed(() => classify(props.item.tc.name))

/** 能力类 → 行首标记图标（替代旧 7 类操作图标；覆盖全部类，`generic` 为兜底） */
const CLASS_ICONS: Record<ToolClass, Component> = {
  terminal: IconTerminal2,
  'file-read': IconTextScan2,
  'file-write': IconPencilPlus,
  'file-edit': IconEdit,
  'file-list': IconFolderOpen,
  search: IconSearch,
  web: IconWorld,
  mcp: IconPlugConnected,
  skill: IconBook,
  subagent: IconRobot,
  plan: IconChecklist,
  memory: IconBrain,
  interaction: IconMessageQuestion,
  domain: IconTool,
  generic: IconTool,
}
const markIcon = computed<Component>(() => CLASS_ICONS[toolClass.value] ?? IconTool)

const subject = computed(() =>
  extractOperationSubject(op.value, props.item.tc.name, props.item.tc.args),
)

// ===== R 批 R-a：展开体分派 + 摘要增强（文件类：类型图标 / 完整路径；终端类：shell 身份） =====
const detailKind = computed(() => detailKindFor(toolClass.value, props.item))
const isFileClass = computed(() =>
  toolClass.value === 'file-read' || toolClass.value === 'file-write'
  || toolClass.value === 'file-edit' || toolClass.value === 'file-list',
)

/** 文件类：完整路径（服务端 `__meta.path` 优先，回落 args.path） */
const filePath = computed(() => {
  if (!isFileClass.value) return ''
  const { meta } = parseToolResult(props.item.tc.result)
  const fromMeta = str(meta?.path)
  const fromArgs = typeof props.item.tc.args.path === 'string' ? (props.item.tc.args.path as string) : ''
  return fromMeta || fromArgs
})
const fileName = computed(() => (filePath.value ? baseNameOf(filePath.value) : ''))

/** 摘要主体：文件类显示路径（超长收缩为「…/末两段」）；其余沿用语义对象 */
const summarySubject = computed(() => {
  if (isFileClass.value && filePath.value) return shortPath(filePath.value)
  return subject.value
})
/** 悬停提示：文件类给完整路径 */
const subjectTitle = computed(() => (isFileClass.value && filePath.value ? filePath.value : ''))

/** 终端类：shell 身份徽标（折叠态即可看出「用的什么终端」） */
const shellLabel = computed(() => {
  if (toolClass.value !== 'terminal') return ''
  const n = props.item.tc.name
  if (n === 'bash') return 'bash'
  if (n === 'powershell') return 'PowerShell'
  if (n.startsWith('shell_session_')) return 'PTY'
  return ''
})

/** 路径末段（文件名） */
function baseNameOf(p: string): string {
  const norm = p.replace(/\\/g, '/')
  return norm.split('/').filter(Boolean).pop() ?? p
}

/** 路径摘要：≤48 字符原样；超出取「…/末两段」（末段是文件名，必须可见） */
function shortPath(p: string): string {
  const norm = p.replace(/\\/g, '/')
  if (norm.length <= 48) return norm
  const segs = norm.split('/').filter(Boolean)
  return segs.length <= 2 ? norm : `…/${segs.slice(-2).join('/')}`
}

// ===== 结果 __meta 解析（JSON 容错；旧工具无 __meta → 回退 args 摘要） =====
const parsedResult = computed<Record<string, unknown> | null>(() => {
  const r = props.item.tc.result
  if (!r) return null
  try {
    const parsed = JSON.parse(r)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
})
const meta = computed<ToolMeta | null>(() => {
  const m = parsedResult.value?.__meta
  return m && typeof m === 'object' ? (m as ToolMeta) : null
})
const effect = computed(() => extractEffectLabel(meta.value))

// ===== E3-4 沙箱徽标：__meta.sandbox（审计元信息对外可见；无戳记不渲染） =====
// 被沙箱拒绝时改显「沙箱拒绝」（警示态 + 悬停说明），模式标签让位
const sandboxLabel = computed(() => formatSandboxMode(meta.value?.sandbox))
const sandboxDenied = computed(() => meta.value?.sandbox_denied === true)
const sandboxTitle = computed(() =>
  sandboxDenied.value
    ? '沙箱拒绝：该命令的写操作被系统拒绝（工作区外路径，或只读档下的任何写）'
    : '',
)

// ===== 执行耗时（H7 P0.5 事件权威字段）；shell 类已由 __meta duration_ms 进 effect，避免重复 =====
const durationText = computed(() => {
  const ms = props.item.tc.durationMs
  if (ms === undefined || ms <= 0) return ''
  if (meta.value?.duration_ms !== undefined) return ''
  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
})

// ===== 运行态 / 失败态 =====
/** tool 调用是否仍在执行（前缀文字流光 + 输出区滚动跟随的共用判据） */
const isStreaming = computed(() => props.item.tc.status === 'running')
const isFailed = computed(() => props.item.tc.status === 'failed')
const errorText = computed(() => {
  const r = props.item.tc.result
  if (r) {
    // 优先解码 result 中的 error 字段（Rust/桥错误约定 { error: "..." }）
    const m = parsedResult.value
    if (m && typeof m.error === 'string') return m.error
    // 纯字符串结果直接展示
    if (typeof r === 'string') {
      const t = r.trim()
      if (t && t !== '执行失败') return t.length > 80 ? t.slice(0, 77) + '...' : t
    }
  }
  return '执行失败'
})

// ===== 展开态（失败不展开） =====
const isExpanded = ref(false)
/**
 * 展开/收起动画进行中标记：详情 0fr→1fr 高度渐变期间，窗口化 ResizeObserver 每帧测中间高度
 * → 前缀和每帧重建 → 切片可能卸载重挂 → 动画重跑 = 疯狂闪烁反馈环。动画期置 data-animating 跳过测高。
 */
const animating = ref(false)
let animTimer: number | null = null
function markAnimating(): void {
  animating.value = true
  if (animTimer !== null) window.clearTimeout(animTimer)
  animTimer = window.setTimeout(() => {
    animating.value = false
    animTimer = null
  }, 320)
}
function toggleExpand() {
  // 2026-09-05 二轮：失败行恢复可展开（参数/结果同样渲染），不再拦截
  isExpanded.value = !isExpanded.value
  markAnimating() // 折叠/展开都有高度动画，标记防窗口化测高反馈环
  if (isExpanded.value) emit('expand')
}

/** 参数摘要：优先关键参数的一行预览 */
const argsPreview = computed(() => {
  const args = props.item.tc.args
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  const priorityKeys = ['name', 'query', 'keyword', 'type', 'entityType', 'id', 'path', 'url', 'prompt', 'content']
  for (const pk of priorityKeys) {
    if (args[pk] && typeof args[pk] === 'string') {
      const val = String(args[pk])
      return val.length > 60 ? val.slice(0, 57) + '...' : val
    }
  }
  for (const k of keys) {
    if (typeof args[k] === 'string') {
      const val = String(args[k])
      return val.length > 60 ? val.slice(0, 57) + '...' : val
    }
  }
  return keys.slice(0, 3).map(k => `${k}=${JSON.stringify(args[k])}`).join(', ')
})

// ===== 系统工具流式（R 批 R-0：输出区 / diff 区 / 参数结果区拆至 tool-detail/ 子组件） =====

onBeforeUnmount(() => {
  if (animTimer !== null) {
    window.clearTimeout(animTimer)
    animTimer = null
  }
})
</script>
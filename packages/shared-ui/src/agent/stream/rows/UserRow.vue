<!--
  UserRow：用户行（右对齐气泡 + chips + 操作栏）
  从 AgentMessageBody 的 user 分支迁移（去掉 assistant 内容），保留对话锚点。
  2026-09-05 移除用户头像（用户要求）：右侧仅保留气泡本体。
  emits：hover / leave / copy / retry。
-->
<template>
  <!-- 批次 C·S1（2026-09-20）：定时唤醒自动投递行（meta.input_kind === 'timer'）——
       非普通用户气泡：左侧系统行样式 + 时钟图标 + 载荷文本（长文可折叠） -->
  <div v-if="isTimer" class="ws-stream-row ws-timer-row" :data-msg-id="msg.id">
    <div class="ws-timer-head">
      <WsIcon name="clock" size="xs" />
      <span class="ws-timer-label">定时唤醒</span>
      <span class="ws-timer-time">{{ actions.timeLabel }}</span>
      <button
        v-if="timerOverflow"
        type="button"
        class="ws-timer-toggle"
        @click="timerExpanded = !timerExpanded"
      >{{ timerExpanded ? '收起' : '展开' }}</button>
    </div>
    <pre class="ws-timer-text" :class="{ folded: timerOverflow && !timerExpanded }">{{ msg.content }}</pre>
  </div>
  <div
    v-else
    class="ws-stream-row ws-user-row"
    :class="{ 'msg-user': true }"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)"
    @mouseleave="emit('leave')"
  >
    <div class="ws-user-inner">
      <!-- 用户文本：chips（@path 引用）+ 正文（Markdown 渲染，2026-09-03——仅显示层，消息原文/发送内容不动）；
           超阈值折叠：截断 + 渐隐 + 「展开全文」（方案2，2026-09-03） -->
      <div ref="textEl" class="ws-user-text ws-agent-md" :class="{ folded: overflow && !expanded }">
        <template v-for="(seg, i) in userSegments" :key="i">
          <span v-if="seg.type === 'chip'" class="kb-chip-inline"><WsIcon name="file" size="xs" />{{ seg.label }}</span>
          <div v-else class="ws-user-md-seg" v-html="renderSeg(seg.text)"></div>
        </template>
      </div>
      <div v-if="overflow" class="ws-user-fold-toggle">
        <button type="button" @click="expanded = !expanded">{{ expanded ? '收起' : '展开全文' }}</button>
      </div>

      <!-- N2 修复：复制=copy、重试=redo（原 outline/delete 图标与功能语义错位） -->
      <div class="msg-actions" :class="{ visible: isHovered }">
        <!-- UX-a 会话分支：仅当上层匹配到该消息对应的请求边界时显示（匹配不到不显示——绝不猜锚点） -->
        <button
          v-if="canBranch"
          type="button"
          class="action-btn"
          title="从此处分叉"
          aria-label="从此处分叉"
          @click="emit('branch', { action: 'fork', msg })"
        ><WsIcon name="tree" size="xs" /></button>
        <button
          v-if="canBranch"
          type="button"
          class="action-btn"
          title="回滚到此处"
          aria-label="回滚到此处"
          @click="emit('branch', { action: 'rewind', msg })"
        ><WsIcon name="undo" size="xs" /></button>
        <button type="button" class="action-btn" title="复制" aria-label="复制消息" @click="emit('copy', msg)"><WsIcon name="copy" size="xs" /></button>
        <button type="button" class="action-btn" title="重试" aria-label="重试消息" @click="emit('retry', msg)"><WsIcon name="redo" size="xs" /></button>
        <span class="msg-time">{{ actions.timeLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useMessageActions } from '../../bubbles/useMessageActions'
import { renderMarkdownHtml } from '../../bubbles/useMarkdownRender'
import '../../markdown/markdown.css'
import type { AgentMessage, UserContentSegment } from '../../bubbles/types'

/** 用户行 props：消息体 + 是否 hover（驱动操作栏显隐）+ 分支可操作性（上层注入） */
const props = defineProps<{
  msg: AgentMessage
  isHovered?: boolean
  /**
   * 分支可操作判定（UX-a）：上层用请求边界列表匹配该消息；返回 false / 未注入
   * → 不显示分叉 / 回滚按钮（**匹配不到不显示**——绝不猜锚点）
   */
  branchable?: (msg: AgentMessage) => boolean
}>()

const emit = defineEmits<{
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'retry', msg: AgentMessage): void
  (e: 'branch', payload: { action: 'fork' | 'rewind'; msg: AgentMessage }): void
}>()

// ===== 定时唤醒行（批次 C·S1，2026-09-20）=====
/** 来源标记：消息 metadata.input_kind（Rust 侧注入的 user 消息 meta 透传） */
const isTimer = computed(() => props.msg.metadata?.input_kind === 'timer')
const timerExpanded = ref(false)

/** 本行是否可分支（上层注入的边界匹配函数；函数内读响应式数据，列表更新后自动重判） */
const canBranch = computed(() => !isTimer.value && !!props.branchable?.(props.msg))
/** 定时唤醒载荷较长时提供折叠（按字符粗判，避免 DOM 测量） */
const timerOverflow = computed(() => (props.msg.content || '').length > 240)

// ===== 操作栏（时间 + 导出能力，仅用 timeLabel） =====
const actions = useMessageActions(
  () => props.msg.content,
  () => props.msg.timestamp,
)

// ===== 用户 @path 引用拆为 chip + 文本（复用 useAgentRenderPlan 策略，逻辑内联） =====
const userSegments = computed<UserContentSegment[]>(() => {
  const content = props.msg.content || ''
  if (!content) return []
  const segments: UserContentSegment[] = []
  const pattern = /@([\w/.-]+\.md|[\w/.-]+\/[\w/.-]+\.\w+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    const fullPath = match[1]
    const label = fullPath.split('/').pop() || fullPath
    segments.push({ type: 'chip', label })
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) })
  }
  return segments
})

/** 文本段 Markdown 渲染（breaks 模式：单换行→<br>，修复多行输入显示成一坨；仅显示层，原文不动） */
function renderSeg(text: string): string {
  return renderMarkdownHtml(text)
}

// ===== 长内容折叠（方案2）：渲染后测高，超阈值截断显示 + 展开全文/收起 =====
const FOLD_THRESHOLD = 300
const textEl = ref<HTMLElement | null>(null)
/** 内容超出阈值（决定「展开全文」按钮显隐） */
const overflow = ref(false)
/** 是否已展开（展开后显示「收起」） */
const expanded = ref(false)

/** 测量气泡内容高度：超阈值进入可折叠态；内容不再超高时复位展开态 */
function measureFold(): void {
  const el = textEl.value
  if (!el) {
    overflow.value = false
    return
  }
  overflow.value = el.scrollHeight > FOLD_THRESHOLD + 4 // 4px 容差
  if (!overflow.value) expanded.value = false
}

onMounted(() => nextTick(measureFold))
watch(
  () => props.msg.content,
  () => nextTick(measureFold),
)
</script>

<style scoped>
/* ── 定时唤醒行（批次 C·S1，2026-09-20）：左侧系统行样式，与用户气泡区分 ── */
.ws-timer-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 0;
  padding: 8px 12px;
  border-left: 2px solid var(--agent-accent, var(--color-primary, #6b7280));
  background: var(--agent-tool-bg, rgba(127, 127, 127, 0.06));
  border-radius: 6px;
  max-width: 92%;
}
.ws-timer-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--agent-text-muted, var(--text-secondary));
  font-size: var(--font-size-xs, 11px);
}
.ws-timer-label {
  font-weight: 600;
}
.ws-timer-time {
  opacity: 0.75;
}
.ws-timer-toggle {
  margin-left: auto;
  background: none;
  border: none;
  padding: 0;
  color: var(--agent-accent, var(--color-primary, #6b7280));
  cursor: pointer;
  font-size: inherit;
}
.ws-timer-toggle:hover {
  text-decoration: underline;
}
.ws-timer-text {
  margin: 0;
  font-family: var(--agent-font);
  font-size: var(--font-size-sm, 13px);
  line-height: 1.5;
  color: var(--agent-text);
  white-space: pre-wrap;
  word-break: break-word;
}
/* 折叠态：限高 + 底部渐隐（提示可展开） */
.ws-timer-text.folded {
  max-height: 4.5em;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 60%, transparent 100%);
}

.ws-user-row {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  margin-left: auto;
  max-width: 85%;
}
.ws-user-inner {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
  font-size: var(--font-size-base);
  line-height: 1.6;
  color: var(--agent-text);
  font-family: var(--agent-font);
}
/* 用户气泡（圆角 5%，2026-09-03；relative 供折叠渐隐遮罩定位） */
.ws-user-text {
  position: relative;
  display: inline-block;
  text-align: left;
  background: var(--agent-user-bubble);
  backdrop-filter: blur(8px);
  padding: 8px 12px;
  border-radius: 5%;
  max-width: 100%;
  word-break: break-word;
}
/* 折叠态：截断 + 底部渐隐入气泡底色 */
.ws-user-text.folded {
  max-height: 300px;
  overflow: hidden;
}
.ws-user-text.folded::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--agent-user-bubble));
  pointer-events: none;
}
/* 展开全文/收起按钮行 */
.ws-user-fold-toggle {
  margin-top: 2px;
}
.ws-user-fold-toggle button {
  border: none;
  background: transparent;
  color: var(--agent-text-tertiary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s;
}
.ws-user-fold-toggle button:hover {
  color: var(--agent-accent);
}
/* Markdown 段在气泡内的兜底：块级元素不撑破气泡、代码块可横向滚动 */
.ws-user-text :deep(p) { margin: 0; }
.ws-user-text :deep(p + p) { margin-top: 4px; }
.ws-user-text :deep(pre) { max-width: 100%; overflow-x: auto; margin: 4px 0; }
.ws-user-text :deep(.ws-code-block) { text-align: left; }
.ws-user-text :deep(table) { max-width: 100%; display: block; overflow-x: auto; }
.ws-user-text :deep(img) { max-width: 100%; }
/* @path 知识引用 chips */
.kb-chip-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  background: color-mix(in srgb, var(--agent-info) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-info) 30%, transparent);
  border-radius: 8px;
  font-size: 11px;
  color: color-mix(in srgb, var(--agent-info) 90%, transparent);
  vertical-align: middle;
  white-space: nowrap;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 操作栏（复用 AgentMessageBody 样式） */
.msg-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  height: 20px;
}
.msg-actions.visible { opacity: 1; }
.action-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.1s;
}
.action-btn:hover { opacity: 1; }
.msg-time {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-left: auto;
}
</style>
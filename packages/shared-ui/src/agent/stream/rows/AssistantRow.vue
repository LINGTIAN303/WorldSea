<!--
  AssistantRow：正文行（左对齐、无气泡底）
  复用 useMarkdownRender（v-html ws-agent-md）+ images/files + MessageBlocks
  + manuscript 贴顶 + 操作栏（useMessageActions：复制/导出图片/GIF/时间）
  + 根 onRootClick 事件委托（代码复制 + 实体 mention → useEntityMiniPanel）+ applyFontSpanStyles。
  长文折叠已移除（2026-08-30 用户拍板：「展开全文」不再使用，正文全量展示）。
  emits：hover / leave / copy / block-action / manuscript-local-action。
-->
<template>
  <div
    ref="rootEl"
    class="ws-stream-row ws-assistant-row"
    :class="{ 'is-result': isResult !== false }"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)"
    @mouseleave="emit('leave')"
    @click="onRootClick"
  >
    <!-- manuscript 贴顶渲染（独立于正文顺序） -->
    <BlockManuscript
      v-for="block in manuscriptBlocks"
      :key="block.id"
      :block="block"
      @action="(e) => emit('block-action', e)"
      @local-action="(e) => emit('manuscript-local-action', e)"
    />

    <!-- 图片 / 文件附件 -->
    <div v-if="images.length || files.length" class="ws-attach">
      <div v-if="images.length" class="img-row">
        <img v-for="(img, i) in images" :key="i" :src="`data:${img.mimeType};base64,${img.data}`" class="ws-stream-img" />
      </div>
      <div v-if="files.length" class="file-row">
        <div v-for="(file, i) in files" :key="i" class="file-item">
          <span class="file-icon"><WsIcon name="manuscript" size="xs" /></span>
          <span class="file-name">{{ file.name }}</span>
        </div>
      </div>
    </div>

    <!-- 正文 Markdown（2026-08-30 用户拍板：移除长文折叠，「展开全文」不再使用）
         C2 增量渲染：双段容器——stable 段跨帧仅追加（v-html 值不变则 Vue 不触碰该 DOM），
         tail 段承载活动尾块每帧重渲；两段拼接与整段渲染等价（契约测试锁定） -->
    <div class="ws-assistant-text" :style="agentFontStyle">
      <div class="ws-agent-md">
        <div v-if="stableHtml" class="ws-md-seg ws-md-stable" v-html="stableHtml"></div>
        <div v-if="tailHtml" class="ws-md-seg ws-md-tail" v-html="tailHtml"></div>
      </div>
    </div>

    <!-- Block*（非 manuscript）紧贴正文后 -->
    <MessageBlocks :blocks="blockBlocks" @block-action="(e) => emit('block-action', e)" />

    <!-- 操作栏（复制 / 导出图片 / 导出GIF / 时间）；N2：复制图标改 copy（原 outline 与功能错位）
         仅 ③ 结果层拥有：过程文本段不是最终答案，不提供复制/导出（避免过程内容被误当答案导出） -->
      <div v-if="showActions" class="msg-actions" :class="{ visible: isHovered }">
        <button type="button" class="action-btn" title="复制" aria-label="复制消息" @click="emit('copy', msg)"><WsIcon name="copy" size="xs" /></button>
      <button type="button" class="action-btn" title="导出为图片" aria-label="导出为图片" @click="actions.onExportImage"><WsIcon name="image" size="xs" /></button>
      <button type="button" class="action-btn" title="导出为GIF" aria-label="导出为GIF" @click="actions.onExportGif"><WsIcon name="video" size="xs" /></button>
      <span class="msg-time">{{ actions.timeLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import BlockManuscript from '../../blocks/BlockManuscript.vue'
import MessageBlocks from '../../bubbles/MessageBlocks.vue'
import { useAgentUiDeps } from '@worldsea/shared-composables/agent/deps'
import { useEntityMiniPanel } from '@worldsea/shared-composables/entity/useEntityMiniPanel'
import { useMarkdownRender, handleCodeCopyClick } from '../../bubbles/useMarkdownRender'
import { useMessageActions } from '../../bubbles/useMessageActions'
import type { AgentMessage, BlockActionEvent } from '../../bubbles/types'
import '../../bubbles/agent-markdown.css'

/** 正文行 props：消息体 + 是否 hover（驱动操作栏显隐）+ 是否 ③ 结果层 */
const props = defineProps<{
  msg: AgentMessage
  isHovered?: boolean
  /** ③ 结果层标记：结果层带操作栏并做字号/字重微调。
   *  ② 过程层的过程文本段传 false。默认 undefined 视为 true——既有调用方行为不变 */
  isResult?: boolean
}>()

/** 仅结果层展示操作栏；过程文本段不是最终答案，不提供复制/导出 */
const showActions = computed(() => props.isResult !== false)

const emit = defineEmits<{
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'block-action', event: BlockActionEvent): void
  (e: 'manuscript-local-action', event: BlockActionEvent): void
}>()

// ===== Markdown 渲染（正文，assistant 角色；C2：stable/tail 双段增量） =====
const { renderedMarkdown, stableHtml, tailHtml } = useMarkdownRender(() => props.msg.content)

// ===== 操作栏（复制/导出图片/GIF/时间） =====
const actions = useMessageActions(
  () => props.msg.content,
  () => props.msg.timestamp,
)

// ===== 字体偏好推导内联样式（applyFontSpan） =====
const { fontFamily: depFontFamily, fontPrefs } = useAgentUiDeps()
const agentFontStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {}
  const family = fontPrefs.value?.family || depFontFamily.value || ''
  if (family) style.fontFamily = family
  const pref = fontPrefs.value
  if (pref?.family && pref.weight && pref.weight !== 400) style.fontWeight = String(pref.weight)
  if (pref?.family && pref.style && pref.style !== 'normal') style.fontStyle = pref.style
  return style
})

// ===== 附件 =====
const images = computed(() => props.msg.images || [])
const files = computed(() => props.msg.files || [])

// ===== manuscript blocks（贴顶）与其余 blocks =====
const manuscriptBlocks = computed(() =>
  (props.msg.blocks || []).filter((b): b is import('@worldsea/agent-runtime').ManuscriptBlock => b.type === 'manuscript'),
)
const blockBlocks = computed(() =>
  (props.msg.blocks || []).filter(b => b.type !== 'manuscript'),
)

// ===== 根事件委托：代码复制优先，其次实体 mention 点击 =====
const miniPanel = useEntityMiniPanel()
function onRootClick(e: MouseEvent) {
  if (handleCodeCopyClick(e)) return
  const target = e.target as HTMLElement
  if (!target) return
  const mention = target.closest('.ws-entity-mention') as HTMLElement | null
  if (!mention) return
  const entityId = mention.getAttribute('data-ws-entity-id')
  const entityType = mention.getAttribute('data-ws-entity-type') || ''
  const name = mention.getAttribute('data-ws-entity-name') || ''
  if (!entityId) return
  const triggerRect = mention.getBoundingClientRect()
  miniPanel.open(entityId, triggerRect, { entityType, name })
  e.stopPropagation()
}

// ===== applyFontSpanStyles：扫描 [data-ws-font] 并应用内联字体（仅限本行根内） =====
const rootEl = ref<HTMLElement | null>(null)
function applyFontSpanStyles() {
  if (!rootEl.value) return
  const fontSpans = rootEl.value.querySelectorAll('[data-ws-font]')
  for (const span of fontSpans) {
    const family = span.getAttribute('data-ws-font')
    const weight = span.getAttribute('data-ws-weight')
    const style = span.getAttribute('data-ws-style')
    if (family) {
      const htmlEl = span as HTMLElement
      htmlEl.style.fontFamily = `"${family}", sans-serif`
      if (weight && weight !== '400') htmlEl.style.fontWeight = weight
      if (style && style !== 'normal') htmlEl.style.fontStyle = style
    }
  }
}
watch(renderedMarkdown, () => {
  nextTick(applyFontSpanStyles)
})
</script>

<style scoped>
/* 正文行：左对齐、无气泡底、无彩边 */
.ws-assistant-row {
  display: block;
  width: 100%;
  max-width: 100%;
  padding: 2px 4px;
  animation: ws-stream-row-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.ws-assistant-row > * {
  margin-bottom: 6px;
}
.ws-assistant-row > *:last-child {
  margin-bottom: 0;
}

/* 附件 */
.ws-attach { display: flex; flex-direction: column; gap: 6px; }
.img-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ws-stream-img {
  max-width: 280px;
  max-height: 200px;
  border-radius: 8px;
  object-fit: contain;
  cursor: pointer;
  transition: transform 0.15s;
}
.ws-stream-img:hover { transform: scale(1.03); }
.file-row { display: flex; flex-wrap: wrap; gap: 6px; }
.file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-hover-bg);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
}
.file-icon { font-size: var(--font-size-sm); }
.file-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 正文 */
.ws-assistant-text {
  max-width: 100%;
  font-size: var(--font-size-base);
  line-height: 1.7;
  color: var(--agent-text);
  word-break: break-word;
  font-family: var(--agent-font);
}

/* manuscript 画布布局：放宽宽度 */
.ws-assistant-row:has(.manuscript-canvas) { max-width: 100%; }
.ws-assistant-row:has(.manuscript-canvas) .manuscript-canvas { flex: 1 1 0; min-width: 280px; max-width: 60%; margin-left: auto; }

/* 操作栏 */
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
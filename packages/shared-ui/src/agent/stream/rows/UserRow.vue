<!--
  UserRow：用户行（右对齐气泡 + 头像 + chips + 操作栏）
  从 AgentMessageBody 的 user 分支迁移（去掉 assistant 内容），保留对话锚点。
  emits：hover / leave / copy / retry。
-->
<template>
  <div
    class="ws-stream-row ws-user-row"
    :class="{ 'msg-user': true }"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)"
    @mouseleave="emit('leave')"
  >
    <AvatarBadge
      class="ws-avatar"
      :avatar="speaker.avatar"
      :name="speaker.name"
      :color="speaker.color"
      :size="24"
      shape="rounded"
    />
    <div class="ws-user-inner">
      <!-- 用户文本：chips（@path 引用）+ 正文 -->
      <div class="ws-user-text">
        <template v-for="(seg, i) in userSegments" :key="i">
          <span v-if="seg.type === 'chip'" class="kb-chip-inline"><WsIcon name="file" size="xs" />{{ seg.label }}</span>
          <template v-else>{{ seg.text }}</template>
        </template>
      </div>

      <!-- N2 修复：复制=copy、重试=redo（原 outline/delete 图标与功能语义错位） -->
      <div class="msg-actions" :class="{ visible: isHovered }">
        <button type="button" class="action-btn" title="复制" aria-label="复制消息" @click="emit('copy', msg)"><WsIcon name="copy" size="xs" /></button>
        <button type="button" class="action-btn" title="重试" aria-label="重试消息" @click="emit('retry', msg)"><WsIcon name="redo" size="xs" /></button>
        <span class="msg-time">{{ actions.timeLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useMessageSpeaker } from '@worldsmith/shared-composables/agent/useMessageSpeaker'
import { useAgentUiDeps } from '@worldsmith/shared-composables/agent/deps'
import { useMessageActions } from '../../bubbles/useMessageActions'
import type { AgentMessage, UserContentSegment } from '../../bubbles/types'

/** 用户行 props：消息体 + 是否 hover（驱动操作栏显隐） */
const props = defineProps<{
  msg: AgentMessage
  isHovered?: boolean
}>()

const emit = defineEmits<{
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'retry', msg: AgentMessage): void
}>()

// ===== 发言者信息（头像/名称/颜色） =====
const speaker = useMessageSpeaker(() => props.msg)

// ===== 头像组件（注入式获取，复用端实现） =====
const { AvatarBadge } = useAgentUiDeps()

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
</script>

<style scoped>
.ws-user-row {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  max-width: 85%;
  /* 右对齐气泡 + 头像（row-reverse 让头像在右） */
  flex-direction: row-reverse;
}
.ws-user-row > :not(.ws-avatar) {
  min-width: 0;
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
/* 用户气泡 */
.ws-user-text {
  display: inline-block;
  text-align: left;
  background: var(--agent-user-bubble);
  backdrop-filter: blur(8px);
  padding: 8px 12px;
  border-radius: 16px 16px 4px 16px;
  max-width: 100%;
  word-break: break-word;
}
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
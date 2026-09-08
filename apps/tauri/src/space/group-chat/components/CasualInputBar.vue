<template>
  <div class="casual-input-bar">
    <div v-if="replyTarget" class="reply-bar">
      <span class="reply-hint">↩ {{ replyTarget.name }}：{{ replyTarget.text }}</span>
      <button class="reply-cancel" @click="$emit('cancelReply')"><WsIcon name="x" size="xs" /></button>
    </div>
    <div v-if="mentionQuery != null" class="mention-popup">
      <div
        v-for="m in filteredMembers"
        :key="m.id"
        class="mention-item"
        @click="onSelectMention(m)"
      >
        <div class="mention-avatar" :style="{ background: m.color }">{{ m.name[0] }}</div>
        <span class="mention-name">{{ m.name }}</span>
        <span class="mention-role">{{ m.role }}</span>
      </div>
      <div v-if="filteredMembers.length === 0" class="mention-empty">无匹配成员</div>
    </div>
    <div class="input-row">
      <textarea
        ref="inputRef"
        v-model="text"
        class="input-field"
        placeholder="输入消息..."
        rows="1"
        @keydown.enter.exact.prevent="send"
        @input="onInput"
        @keydown.esc="onEsc"
      ></textarea>
      <button class="tool-btn" title="图片" @click="$emit('attachImage')"><WsIcon name="image" size="xs" /></button>
      <button class="tool-btn" title="文件" @click="$emit('attachFile')">📎</button>
      <button class="tool-btn" title="@提及" @click="$emit('openMention')">@</button>
      <button class="send-btn" :disabled="!text.trim() || sending" @click="send">{{ sending ? '发送中...' : '发送' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { GroupMember } from '../types'
import { WsIcon } from '@worldsea/ui-kit'

const props = defineProps<{
  replyTarget?: { messageId: string; name: string; text: string } | null
  mentionQuery?: string | null
  members?: GroupMember[]
  sending?: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
  cancelReply: []
  attachImage: []
  attachFile: []
  openMention: []
  closeMention: []
  selectMention: [member: GroupMember]
  updateMentionQuery: [query: string]
}>()

const text = ref('')
const inputRef = ref<HTMLTextAreaElement>()

const filteredMembers = computed(() => {
  if (props.mentionQuery == null) return []
  if (!props.members) return []
  if (props.mentionQuery === '') return props.members
  const q = props.mentionQuery.toLowerCase()
  return props.members.filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.role.toLowerCase().includes(q)
  )
})

function send(): void {
  const trimmed = text.value.trim()
  if (!trimmed) return
  emit('send', trimmed)
  text.value = ''
  nextTick(() => autoResize())
}

function onInput(): void {
  autoResize()
  const el = inputRef.value
  if (!el) return

  const cursorPos = el.selectionStart ?? text.value.length
  const charBeforeCursor = text.value[cursorPos - 1]

  if (charBeforeCursor === '@') {
    emit('openMention')
  }

  // 实时更新 mentionQuery
  if (props.mentionQuery != null) {
    const textBeforeCursor = text.value.slice(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    if (lastAtIndex === -1) {
      // 光标前没有 @，关闭 mention popup
      emit('closeMention')
    } else if (lastAtIndex === cursorPos - 1) {
      // @ 刚输入，query 为空
      emit('updateMentionQuery', '')
    } else {
      const query = textBeforeCursor.slice(lastAtIndex + 1)
      // 如果 query 中包含空格，说明光标已移出 @ 区域
      if (query.includes(' ') || query.includes('\n')) {
        emit('closeMention')
      } else {
        emit('updateMentionQuery', query)
      }
    }
  }
}

function onSelectMention(member: GroupMember): void {
  const el = inputRef.value
  if (el) {
    const cursorPos = el.selectionStart ?? text.value.length
    const textBeforeCursor = text.value.slice(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    if (lastAtIndex !== -1) {
      const before = text.value.slice(0, lastAtIndex)
      const after = text.value.slice(cursorPos)
      const insertText = `@${member.name} `
      text.value = before + insertText + after
      nextTick(() => {
        const newPos = before.length + insertText.length
        el.setSelectionRange(newPos, newPos)
      })
    }
  }
  emit('selectMention', member)
}

function onEsc(): void {
  if (props.mentionQuery != null) {
    emit('closeMention')
  }
}

function autoResize(): void {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function focusInput(): void {
  inputRef.value?.focus()
}

defineExpose({ focusInput })
</script>

<style scoped>
.casual-input-bar { border-top: 1px solid var(--color-border); padding: 8px 12px; background: var(--color-surface-elevated); position: relative; }

.reply-bar { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; padding: 4px 6px; background: var(--bg-muted, rgba(0,0,0,0.05)); border-radius: var(--radius-xs); border-left: 2px solid var(--color-primary); font-size: var(--fs-xs); color: var(--color-text-tertiary); }
.reply-hint { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply-cancel { background: none; border: none; cursor: pointer; opacity: 0.5; font-size: var(--fs-sm); padding: 2px 4px; }
.reply-cancel:hover { opacity: 1; }

.mention-popup { position: absolute; bottom: 100%; left: 12px; right: 12px; max-height: 200px; overflow-y: auto; background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-mid); box-shadow: 0 -4px 12px rgba(0,0,0,0.1); z-index: 50; margin-bottom: 4px; }
.mention-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; }
.mention-item:hover { background: var(--color-surface); }
.mention-avatar { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: var(--fs-xs); flex-shrink: 0; }
.mention-name { font-size: var(--fs-sm); font-weight: 600; }
.mention-role { font-size: var(--fs-2xs); color: var(--color-text-tertiary); }
.mention-empty { padding: 8px 10px; font-size: var(--fs-xs); color: var(--color-text-tertiary); text-align: center; }

.input-row { display: flex; align-items: flex-end; gap: 6px; }
.input-field { flex: 1; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 8px 12px; font-size: var(--fs-md); resize: none; outline: none; background: var(--color-surface); color: var(--color-text); max-height: 120px; line-height: 1.5; font-family: inherit; }
.input-field:focus { border-color: var(--color-primary); }

.tool-btn { width: 32px; height: 32px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-lg); display: flex; align-items: center; justify-content: center; transition: background 0.12s; }
.tool-btn:hover { background: var(--color-surface); }

.send-btn { padding: 6px 14px; border: none; background: var(--color-primary); color: var(--on-accent); border-radius: var(--radius-mid); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; transition: opacity 0.15s; }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn:not(:disabled):hover { opacity: 0.9; }
</style>
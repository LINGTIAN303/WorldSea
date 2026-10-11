<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    :update-delay="80"
    :should-show="shouldShow"
    :options="{ placement: 'top', offset: 10 }"
  >
    <div class="nb-bubble">
      <button
        v-for="btn in buttons()"
        :key="btn.id"
        :class="['nb-bb-btn', { active: btn.isActive() }]"
        :title="btn.title"
        :aria-label="btn.title"
        @mousedown.prevent
        @click="btn.run()"
      ><WsIcon :name="btn.icon" size="xs" /></button>
      <!-- 链接输入态：点链接图标展开，确认 setLink / 清除 unsetLink -->
      <template v-if="linkEditing">
        <input
          ref="linkInputRef"
          v-model="linkUrl"
          class="nb-bb-link-input"
          placeholder="https://…"
          @keydown.enter.prevent="confirmLink"
          @keydown.escape.prevent="linkEditing = false"
          @mousedown.stop
        />
        <button class="nb-bb-btn" title="确认链接" aria-label="确认链接" @mousedown.prevent @click="confirmLink"><WsIcon name="check" size="xs" /></button>
        <button
          v-if="editor.isActive('link')"
          class="nb-bb-btn nb-bb-danger"
          title="移除链接" aria-label="移除链接"
          @mousedown.prevent
          @click="editor.chain().focus().unsetLink().run(); linkEditing = false"
        ><WsIcon name="close" size="xs" /></button>
      </template>
      <button
        v-else
        :class="['nb-bb-btn', { active: editor.isActive('link') }]"
        title="链接"
        aria-label="链接"
        @mousedown.prevent
        @click="startLink"
      ><WsIcon name="link" size="xs" /></button>
    </div>
  </BubbleMenu>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { WsIcon } from '@worldsea/ui-kit'
import type { Editor } from '@tiptap/core'

const props = defineProps<{ editor: Editor | undefined }>()

/**
 * 显示条件：编辑器聚焦 + 非空选区 + 不在代码块内（行内格式对代码块无意义）。
 * mention/斜杠弹层开着时不弹（shouldShow 在每帧重估，editor 状态天然覆盖）。
 */
function shouldShow({ editor, from, to }: { editor: Editor; state: unknown; from: number; to: number }): boolean {
  if (!editor.isFocused) return false
  if (from === to) return false
  if (editor.isActive('codeBlock')) return false
  return true
}

/** editor 非 Vue 响应式对象 —— 按钮激活态靠 transaction 触发重渲（refreshTick 为渲染依赖） */
const refreshTick = ref(0)
let offTransaction: (() => void) | null = null
onMounted(() => {
  const ed = props.editor
  if (!ed) return
  const handler = () => { refreshTick.value++ }
  ed.on('transaction', handler)
  offTransaction = () => ed.off('transaction', handler)
})
onBeforeUnmount(() => { offTransaction?.() })

interface BubbleButton {
  id: string
  icon: string
  title: string
  isActive: () => boolean
  run: () => void
}

function buttons(): BubbleButton[] {
  void refreshTick.value // 渲染依赖：transaction 后重算 active 态
  const ed = props.editor
  return [
    { id: 'bold', icon: 'bold', title: '粗体', isActive: () => ed?.isActive('bold') ?? false, run: () => ed?.chain().focus().toggleBold().run() },
    { id: 'italic', icon: 'italic', title: '斜体', isActive: () => ed?.isActive('italic') ?? false, run: () => ed?.chain().focus().toggleItalic().run() },
    { id: 'strike', icon: 'strikethrough', title: '删除线', isActive: () => ed?.isActive('strike') ?? false, run: () => ed?.chain().focus().toggleStrike().run() },
    { id: 'code', icon: 'code', title: '行内代码', isActive: () => ed?.isActive('code') ?? false, run: () => ed?.chain().focus().toggleCode().run() },
  ]
}

const linkEditing = ref(false)
const linkUrl = ref('')
const linkInputRef = ref<HTMLInputElement | null>(null)

function startLink(): void {
  const current = props.editor?.getAttributes('link').href as string | undefined
  linkUrl.value = current ?? ''
  linkEditing.value = true
  void nextTick(() => linkInputRef.value?.focus())
}

function confirmLink(): void {
  const url = linkUrl.value.trim()
  const chain = props.editor?.chain().focus()
  if (!chain) return
  if (!url) {
    if (props.editor?.isActive('link')) chain.unsetLink().run()
  } else {
    chain.extendMarkRange('link').setLink({ href: url }).run()
  }
  linkEditing.value = false
}
</script>

<style scoped>
.nb-bubble {
  display: flex; align-items: center; gap: 2px;
  padding: 4px; border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-md);
}
.nb-bb-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--radius-xs);
  background: transparent; color: var(--color-text-secondary); cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.nb-bb-btn:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.nb-bb-btn.active { background: color-mix(in srgb, var(--color-primary) 18%, transparent); color: var(--color-primary); }
.nb-bb-danger { color: var(--color-danger); }
.nb-bb-danger:hover { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
.nb-bb-link-input {
  width: 180px; padding: 3px 8px; border: 1px solid var(--color-border);
  border-radius: var(--radius-xs); background: var(--color-bg-base);
  color: var(--color-text-primary); font-size: var(--font-size-xs); outline: none;
}
.nb-bb-link-input:focus { border-color: var(--color-primary); }
</style>

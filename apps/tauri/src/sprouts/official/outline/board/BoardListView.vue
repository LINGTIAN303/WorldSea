<template>
  <!--
    白板列表层（BoardListView）—— 卡片网格
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §0.1（照 manuscript 书籍卡片网格先例）
    · 单击卡片进入编辑器；重命名走行内输入；删除需二次确认（按钮变「确认删除」）
  -->
  <div class="blv">
    <div v-if="boards.length" class="blv-grid">
      <article
        v-for="b in boards"
        :key="b.id"
        class="blv-card"
        role="button"
        tabindex="0"
        @click="onOpen(b.id)"
        @keydown.enter.prevent="onOpen(b.id)"
      >
        <div class="blv-actions">
          <button
            class="blv-act"
            type="button"
            title="重命名"
            aria-label="重命名"
            @click.stop="startRename(b)"
          ><WsIcon name="edit" size="xs" /></button>
          <button
            class="blv-act"
            :class="{ 'blv-act--danger': confirmId === b.id }"
            type="button"
            :title="confirmId === b.id ? '再点一次确认删除' : '删除白板'"
            :aria-label="confirmId === b.id ? '确认删除白板' : '删除白板'"
            @click.stop="onDelete(b.id)"
          >{{ confirmId === b.id ? '确认删除' : '' }}<WsIcon v-if="confirmId !== b.id" name="delete" size="xs" /></button>
        </div>

        <div class="blv-cover">
          <WsIcon name="outline" size="lg" />
        </div>

        <input
          v-if="renameId === b.id"
          :ref="setRenameInput"
          v-model="renameDraft"
          class="blv-rename"
          type="text"
          @click.stop
          @keydown.enter.prevent="commitRename(b.id)"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename(b.id)"
        />
        <div v-else class="blv-name">{{ b.name }}</div>

        <div class="blv-meta">
          <span>{{ containerCount(b.id) }} 个容器</span>
          <span>{{ updatedText(b.updatedAt) }}</span>
        </div>
      </article>
    </div>

    <WsEmpty
      v-else
      preset="no-data"
      title="还没有白板"
      description="新建一块白板，把大纲节点摆上去"
    >
      <template #icon><WsIcon name="outline" size="xl" /></template>
    </WsEmpty>
  </div>
</template>

<script setup lang="ts">
/**
 * 列表层：展示 + 事件上报。删除的二次确认做在组件内（不引入弹层依赖），
 * 确认态 3 秒后自动失效，避免误触后忘记。
 */
import { nextTick, ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

defineProps<{
  boards: Entity[]
  containerCount: (boardId: string) => number
}>()

const emit = defineEmits<{
  (e: 'open', boardId: string): void
  (e: 'rename', boardId: string, name: string): void
  (e: 'remove', boardId: string): void
}>()

const renameId = ref<string | null>(null)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const confirmId = ref<string | null>(null)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

/** v-for 内的字符串 ref 会被收集成数组，故用函数 ref 精确指向当前输入框 */
function setRenameInput(el: unknown): void {
  renameInput.value = (el as HTMLInputElement | null) ?? null
}

function onOpen(boardId: string): void {
  if (renameId.value === boardId) return
  emit('open', boardId)
}

async function startRename(board: Entity): Promise<void> {
  renameId.value = board.id
  renameDraft.value = board.name ?? ''
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function commitRename(boardId: string): void {
  if (renameId.value !== boardId) return
  const next = renameDraft.value.trim()
  renameId.value = null
  if (next) emit('rename', boardId, next)
}

function cancelRename(): void {
  renameId.value = null
}

function onDelete(boardId: string): void {
  if (confirmId.value === boardId) {
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = null
    confirmId.value = null
    emit('remove', boardId)
    return
  }
  confirmId.value = boardId
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => {
    confirmId.value = null
    confirmTimer = null
  }, 3000)
}

function updatedText(updatedAt?: string): string {
  if (!updatedAt) return ''
  const d = new Date(updatedAt)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.blv { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; }
.blv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.blv-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: var(--bg-secondary, #1e1e1e);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.blv-card:hover { border-color: var(--primary); }
.blv-card:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.blv-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.blv-card:hover .blv-actions,
.blv-card:focus-within .blv-actions { opacity: 1; }
.blv-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border: none;
  border-radius: var(--radius-xs);
  background: var(--menubar-bg, transparent);
  /* 图标按钮容器必须显式设色（项目通用坑：WsIcon 走 currentColor） */
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
}
.blv-act:hover { color: var(--primary); background: var(--hover-bg); }
.blv-act--danger { color: var(--error, #dc2626); }
.blv-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 72px;
  margin-bottom: 8px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
}
.blv-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.blv-rename {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-sm);
  outline: none;
}
.blv-meta {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
</style>

<script setup lang="ts">
/**
 * SessionList：会话列表面板（精致极简 · 分组 + 搜索）
 *
 * 左侧导航轨道右侧的会话面板：按「今天 / 更早」分组，支持标题搜索，
 * 展示相对时间与消息数；删除经父级确认框（App.vue → TuiConfirm）。
 * 标题经 `useAgentRust().sessionTitle` 从首条用户消息截断展示。
 * 详细why请见 docs/details/注释/tauri/SessionList.md
 */
import { ref, computed } from 'vue'
import { useAgentRust } from '../composables/useAgentRust'
import { WsIcon } from '@worldsmith/ui-kit'
import TuiEmpty from '../../components/ui/TuiEmpty.vue'
import { formatRelativeTime } from '../../components/ui/format'

interface SessionInfo {
  id: string
  created_at: number
  message_count: number
}

const props = defineProps<{
  sessions: SessionInfo[]
  currentSessionId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create'): void
  (e: 'remove', id: string): void
}>()

const backend = useAgentRust()

/** 会话标题（缓存首条用户消息，无则短 id） */
function title(id: string): string {
  return backend.sessionTitle(id)
}

/** 搜索关键词（会话数量较多时才展示搜索框） */
const keyword = ref('')

/** 过滤后的会话（按标题匹配关键词） */
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return props.sessions
  return props.sessions.filter((s) => title(s.id).toLowerCase().includes(q))
})

/** 组内方向键导航：↑/↓ 移动焦点到相邻会话项（批次90 1.1 列表键盘效率） */
function onListKeydown(e: KeyboardEvent, el: HTMLElement) {
  const items = Array.from(el.querySelectorAll<HTMLElement>('.item'))
  if (items.length === 0) return
  const idx = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = items[Math.min(idx + 1, items.length - 1)]
    next?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const next = items[Math.max(idx - 1, 0)]
    next?.focus()
  }
}

/** 分组：今天 / 更早（基于 created_at 零点切分），组内按创建时间倒序 */
const groups = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayTs = today.getTime()
  const list = [...filtered.value].sort((a, b) => b.created_at - a.created_at)
  return [
    { label: '今天', items: list.filter((s) => s.created_at >= todayTs) },
    { label: '更早', items: list.filter((s) => s.created_at < todayTs) },
  ].filter((g) => g.items.length > 0)
})
</script>

<template>
  <div class="panel">
    <div class="panel-head">
      <div class="panel-title-group">
        <span class="panel-title">会话</span>
        <span v-if="sessions.length" class="panel-count">{{ sessions.length }}</span>
      </div>
      <button class="new" title="新建会话" aria-label="新建会话" @click="emit('create')">
        <WsIcon name="plus" :size="14" :stroke-width="2" />
      </button>
    </div>

    <!-- 搜索（会话较多时） -->
    <div v-if="sessions.length > 3" class="search">
      <WsIcon name="search" :size="13" class="search-icon" :stroke-width="1.7" />
      <input
        v-model="keyword"
        type="text"
        aria-label="搜索会话"
        placeholder="搜索会话…"
        spellcheck="false"
      />
      <button
        v-show="keyword"
        class="search-clear"
        title="清空搜索"
        aria-label="清空搜索"
        @click="keyword = ''"
      >
        <WsIcon name="close" :size="11" :stroke-width="1.7" />
      </button>
    </div>

    <TuiEmpty
      v-if="filtered.length === 0"
      icon="chat"
      :title="sessions.length === 0 ? '暂无会话' : '没有匹配的会话'"
      :hint="sessions.length === 0 ? '点击右上角新建会话' : '换个关键词试试'"
      compact
    />

    <div v-for="g in groups" :key="g.label" class="group">
      <div class="group-label">{{ g.label }}</div>
      <ul class="list" @keydown="(e) => onListKeydown(e, e.currentTarget as HTMLElement)">
        <li
          v-for="s in g.items"
          :key="s.id"
          :class="{ active: s.id === props.currentSessionId }"
        >
          <button class="item" @click="emit('select', s.id)">
            <span class="item-title">{{ title(s.id) }}</span>
            <span class="item-meta">
              <span v-if="s.message_count > 0" class="item-count">{{ s.message_count }}</span>
              <span class="item-time">{{ formatRelativeTime(s.created_at) }}</span>
            </span>
          </button>
          <button class="del" title="删除会话" aria-label="删除会话" @click="emit('remove', s.id)">
            <WsIcon name="trash" :size="13" :stroke-width="1.7" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: var(--panel-w);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  min-height: 0;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 顶部内边距对齐各面板 head 12px 基准（批次60：18px → 12px） */
  padding: 12px 16px 10px;
}
.panel-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.4px;
}
.panel-count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  background: var(--bg-muted);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
}
.new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-lg);
  height: var(--icon-btn-lg);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.new:hover {
  background: var(--bg-muted);
  color: var(--accent);
}
/* 按压反馈（批次89） */
.new:active {
  transform: scale(var(--press-scale));
}

/* 搜索框 */
.search {
  position: relative;
  padding: 0 16px 8px;
}
.search-icon {
  position: absolute;
  left: 26px;
  top: 50%;
  transform: translateY(-58%);
  color: var(--text-muted);
  pointer-events: none;
}
.search input {
  width: 100%;
  height: var(--input-sm-h);
  padding: 0 28px 0 30px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: var(--fs-md);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.search input::placeholder {
  color: var(--text-muted);
}
.search input:focus {
  border-color: var(--accent);
  background: var(--bg-surface);
}
/* 清空按钮：有输入才显示，弱化圆形，点击清空（与对话输入栏清空同一语言） */
.search-clear {
  position: absolute;
  right: 21px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--bg-active);
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.search-clear:hover {
  color: var(--text-primary);
  background: var(--border-strong);
}
/* 按压反馈（批次89） */
.search-clear:active {
  transform: scale(var(--press-scale));
}

.group {
  flex-shrink: 0;
}
.group-label {
  padding: 10px 16px 4px;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.4px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 2px 8px 8px;
}
.group:last-child .list {
  padding-bottom: 12px;
}
.list li {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
  margin-bottom: 2px;
  transition: background var(--dur-fast) var(--ease);
}
.list li:hover {
  background: var(--bg-muted);
}
/* hover 标题强调：与记忆/终端列表同一反馈语言（背景 + 标题 accent，批次89 2.1 收敛） */
.list li:hover .item-title {
  color: var(--accent);
}
.list li.active {
  background: var(--accent-soft);
}
.item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  padding: 8px 10px 7px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.item-title {
  font-size: var(--fs-md);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.list li.active .item-title {
  color: var(--accent);
  font-weight: 500;
}
.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.item-count {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  background: var(--bg-muted);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
}
.list li.active .item-count {
  background: var(--accent-soft-border);
  color: var(--accent);
}
.item-time {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.del {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  border: none;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.list li:hover .del {
  opacity: 1;
}
/* 键盘聚焦时也显形：Tab 可聚焦到 opacity:0 按钮，焦点环需可见 */
.del:focus-visible {
  opacity: 1;
}
.del:hover {
  color: var(--danger);
  background: var(--danger-soft);
}
/* 按压反馈（批次89） */
.del:active {
  transform: scale(var(--press-scale));
}
</style>

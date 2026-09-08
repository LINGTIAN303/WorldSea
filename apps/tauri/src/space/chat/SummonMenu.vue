<template>
  <Teleport to="body">
    <Transition name="summon">
      <div
        v-if="visible"
        class="summon-menu"
        :style="menuStyle"
        role="listbox"
        aria-label="召唤菜单"
        :aria-busy="loading"
      >
        <div v-if="loading" class="summon-hint">加载中…</div>
        <div v-else-if="filtered.length === 0" class="summon-hint summon-empty">
          {{ emptyHint || '无匹配项' }}
        </div>
        <ul v-else class="summon-list">
          <li
            v-for="(item, i) in filtered"
            :key="item.id"
            :class="['summon-item', { active: i === activeIndex }]"
            role="option"
            :aria-selected="i === activeIndex"
            @mouseenter="activeIndex = i"
            @mousedown.prevent
            @click="select(item)"
          >
            <WsIcon :name="item.icon" size="sm" class="summon-icon" />
            <span class="summon-prefix">{{ item.prefix }}</span>
            <span class="summon-name">{{ item.name }}</span>
            <span class="summon-desc">{{ item.description }}</span>
          </li>
        </ul>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { matchesFilter, type SummonItem } from './summon-registry'

const props = withDefaults(defineProps<{
  visible: boolean
  items: SummonItem[]
  filter?: string
  position?: { left: string; bottom: string; width: string }
  loading?: boolean
  emptyHint?: string
}>(), {
  filter: '',
  position: () => ({ left: '0px', bottom: '0px', width: '300px' }),
  loading: false,
  emptyHint: '',
})

const emit = defineEmits<{
  select: [item: SummonItem]
  cancel: []
}>()

/** 过滤后的可选项（按名称 / id / payload） */
const filtered = computed(() => props.items.filter((i) => matchesFilter(i, props.filter)))

/** 是否有匹配项（供父组件判断是否拦截 Enter 发送） */
const hasMatches = computed(() => filtered.value.length > 0)

const activeIndex = ref(0)
watch(
  [() => props.items, () => props.filter, () => props.visible],
  () => {
    activeIndex.value = 0
  },
)

const menuStyle = computed(() => ({
  left: props.position.left,
  bottom: props.position.bottom,
  width: props.position.width,
}))

function select(item: SummonItem) {
  emit('select', item)
}

function resetIndex() {
  activeIndex.value = 0
}

/** 键盘导航（由父组件在菜单可见时调用） */
function handleKeydown(e: KeyboardEvent): boolean {
  const count = filtered.value.length
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      activeIndex.value = count === 0 ? 0 : (activeIndex.value + 1) % count
      return true
    case 'ArrowUp':
      e.preventDefault()
      activeIndex.value = count === 0 ? 0 : (activeIndex.value - 1 + count) % count
      return true
    case 'Enter':
      e.preventDefault()
      if (count > 0) select(filtered.value[activeIndex.value])
      return true
    case 'Escape':
      e.preventDefault()
      emit('cancel')
      return true
    default:
      return false
  }
}

defineExpose({
  handleKeydown,
  resetIndex,
  hasMatches,
})
</script>

<style scoped>
.summon-menu {
  position: fixed;
  z-index: 12000;
  max-height: 320px;
  overflow-y: auto;
  background: var(--color-surface-elevated, #1a1a2e);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  padding: 6px;
}

.summon-hint {
  padding: 12px 14px;
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-tertiary, #888);
  text-align: center;
}

.summon-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.summon-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-sm, 13px);
  color: var(--color-text-secondary, #bbb);
  transition: background 0.12s, color 0.12s;
}

.summon-item.active,
.summon-item:hover {
  background: var(--color-primary-muted, rgba(59, 130, 246, 0.14));
  color: var(--color-text, #eee);
}

.summon-icon {
  flex-shrink: 0;
  color: var(--color-text-tertiary, #888);
}

.summon-item.active .summon-icon {
  color: var(--color-primary, #3b82f6);
}

.summon-prefix {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-weight: 600;
  color: var(--color-primary, #3b82f6);
  flex-shrink: 0;
}

.summon-name {
  flex-shrink: 0;
  font-weight: 500;
}

.summon-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-tertiary, #888);
}

.summon-enter-active,
.summon-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.summon-enter-from,
.summon-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>

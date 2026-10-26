<template>
  <Transition name="ws-fade">
    <div v-if="visible" class="g-path">
      <div class="g-path-head">
        <WsIcon name="route" size="xs" />
        <span class="g-path-title">路径搜索</span>
        <button class="g-path-close" aria-label="关闭路径搜索" @click="$emit('close')">
          <WsIcon name="close" size="xs" />
        </button>
      </div>

      <div class="g-path-body">
        <label class="g-path-field">
          <span class="g-path-label">起点</span>
          <input
            v-model="fromQuery"
            class="g-path-input"
            placeholder="搜索实体..."
            @focus="activeField = 'from'"
            @blur="onBlur"
          />
          <ul v-if="activeField === 'from' && fromQuery.trim() && fromSuggestions.length" class="g-path-tips">
            <li v-for="node in fromSuggestions" :key="node.id">
              <button class="g-path-tip" @mousedown.prevent @click="pick('from', node)">
                <WsIcon :name="node.typeIcon" size="xs" />
                <span class="g-path-tip-name">{{ node.name }}</span>
                <span class="g-path-tip-type">{{ node.typeLabel }}</span>
              </button>
            </li>
          </ul>
        </label>

        <label class="g-path-field">
          <span class="g-path-label">终点</span>
          <input
            v-model="toQuery"
            class="g-path-input"
            placeholder="搜索实体..."
            @focus="activeField = 'to'"
            @blur="onBlur"
          />
          <ul v-if="activeField === 'to' && toQuery.trim() && toSuggestions.length" class="g-path-tips">
            <li v-for="node in toSuggestions" :key="node.id">
              <button class="g-path-tip" @mousedown.prevent @click="pick('to', node)">
                <WsIcon :name="node.typeIcon" size="xs" />
                <span class="g-path-tip-name">{{ node.name }}</span>
                <span class="g-path-tip-type">{{ node.typeLabel }}</span>
              </button>
            </li>
          </ul>
        </label>

        <div class="g-path-actions">
          <button class="g-path-btn" :disabled="!fromId || !toId" @click="swap">互换</button>
          <button class="g-path-btn g-path-btn--primary" :disabled="!fromId || !toId" @click="submit">
            查找路径
          </button>
          <button class="g-path-btn" :disabled="!fromId && !toId" @click="reset">清空</button>
        </div>

        <div v-if="result || message" class="g-path-result">
          <p v-if="result" class="g-path-result-line">
            <span class="g-path-hops">{{ result.hops }} 步</span>
            <span class="g-path-chain">{{ chainText }}</span>
          </p>
          <p v-else class="g-path-result-empty">{{ message }}</p>
        </div>
      </div>

      <div class="g-path-foot">仅在有关系的实体之间可达；关闭面板会取消高亮</div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { OverviewNode } from '../model/types'
import type { GraphPath } from '../model/path'

const props = defineProps<{
  visible: boolean
  nodes: OverviewNode[]
  result: GraphPath | null
  message: string
}>()

const emit = defineEmits<{
  close: []
  run: [fromId: string, toId: string]
  clear: []
}>()

const fromQuery = ref('')
const toQuery = ref('')
const fromId = ref<string | null>(null)
const toId = ref<string | null>(null)
const activeField = ref<'from' | 'to' | null>(null)

const nodeById = computed(() => new Map(props.nodes.map(node => [node.id, node])))

function suggest(query: string): OverviewNode[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return []
  return props.nodes
    .filter(node => node.name.toLowerCase().includes(keyword))
    .slice(0, 8)
}

const fromSuggestions = computed(() => suggest(fromQuery.value))
const toSuggestions = computed(() => suggest(toQuery.value))

const chainText = computed(() => {
  if (!props.result) return ''
  const names = props.result.nodeIds.map(id => nodeById.value.get(id)?.name ?? id)
  return names.length > 5 ? `${names.slice(0, 3).join(' → ')} → … → ${names[names.length - 1]}` : names.join(' → ')
})

function onBlur(): void {
  // 延迟收起候选，先让候选按钮的 click 落地
  setTimeout(() => { activeField.value = null }, 120)
}

function submit(): void {
  if (!fromId.value || !toId.value) return
  emit('run', fromId.value, toId.value)
}

function pick(field: 'from' | 'to', node: OverviewNode): void {
  if (field === 'from') {
    fromId.value = node.id
    fromQuery.value = node.name
  } else {
    toId.value = node.id
    toQuery.value = node.name
  }
  activeField.value = null
}

function swap(): void {
  const [from, to] = [fromId.value, toId.value]
  const [fromText, toText] = [fromQuery.value, toQuery.value]
  fromId.value = to
  toId.value = from
  fromQuery.value = toText
  toQuery.value = fromText
  emit('clear')
}

function reset(): void {
  fromId.value = null
  toId.value = null
  fromQuery.value = ''
  toQuery.value = ''
  emit('clear')
}

// 输入被改成非候选文本时，视为放弃已选实体
watch(fromQuery, value => {
  if (nodeById.value.get(fromId.value ?? '')?.name !== value) fromId.value = null
})
watch(toQuery, value => {
  if (nodeById.value.get(toId.value ?? '')?.name !== value) toId.value = null
})

watch(() => props.visible, visible => {
  if (visible) return
  fromId.value = null
  toId.value = null
  fromQuery.value = ''
  toQuery.value = ''
  activeField.value = null
})
</script>

<style scoped>
.g-path {
  position: absolute; top: 56px; left: 12px; width: 268px;
  display: flex; flex-direction: column;
  border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-mid);
  background: var(--g-panel-bg, rgba(8,12,20,0.94)); backdrop-filter: blur(12px);
  z-index: 9; overflow: hidden;
}
.g-path-head { display: flex; align-items: center; gap: 7px; padding: 10px 12px 8px; border-bottom: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); color: var(--g-text-dim, #94a3b8); }
.g-path-title { flex: 1; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--g-text-strong, #e2e8f0); }
.g-path-close { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text-dim, #94a3b8); cursor: pointer; }
.g-path-close:hover { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-path-body { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 8px; }
.g-path-field { position: relative; display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-sm); }
.g-path-label { font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
.g-path-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); }
.g-path-input::placeholder { color: var(--g-text-dim, #94a3b8); }
.g-path-tips {
  position: absolute; left: -1px; right: -1px; top: calc(100% + 4px); z-index: 10;
  margin: 0; padding: 3px; list-style: none; max-height: 168px; overflow-y: auto;
  border: 1px solid var(--g-panel-border, rgba(255,255,255,0.12)); border-radius: var(--radius-sm);
  background: var(--g-panel-bg, rgba(8,12,20,0.98));
}
.g-path-tip { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 6px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); text-align: left; cursor: pointer; }
.g-path-tip:hover { background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-path-tip-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-path-tip-type { color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
.g-path-actions { display: flex; gap: 6px; }
.g-path-btn { flex: 1; padding: 4px 8px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.12)); border-radius: var(--radius-sm); background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); cursor: pointer; }
.g-path-btn:hover:not(:disabled) { background: var(--g-hover, rgba(255,255,255,0.08)); color: var(--g-text-strong, #e2e8f0); }
.g-path-btn:disabled { opacity: 0.35; cursor: default; }
.g-path-btn--primary { color: var(--g-accent, #6ea8fe); border-color: color-mix(in srgb, var(--g-accent, #6ea8fe) 45%, transparent); }
.g-path-result { padding: 6px 8px; border-radius: var(--radius-sm); background: var(--g-hover, rgba(255,255,255,0.05)); font-size: var(--font-size-xs); }
.g-path-result-line { display: flex; flex-direction: column; gap: 3px; margin: 0; }
.g-path-hops { color: var(--g-accent, #6ea8fe); font-weight: var(--font-weight-semibold); }
.g-path-chain { color: var(--g-text, #cbd5e1); line-height: 1.5; word-break: break-all; }
.g-path-result-empty { margin: 0; color: var(--g-text-dim, #94a3b8); line-height: 1.5; }
.g-path-foot { padding: 6px 12px; border-top: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); }
</style>

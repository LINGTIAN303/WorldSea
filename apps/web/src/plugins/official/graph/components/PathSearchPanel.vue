<template>
  <div v-if="visible" class="gg-path-panel">
    <div class="gg-path-header">
      <span>路径搜索</span>
      <button class="gg-path-close" @click="$emit('close')">✕</button>
    </div>
    <div class="gg-path-body">
      <div class="gg-path-row">
        <label>起点</label>
        <input v-model="fromName" class="gg-path-input" placeholder="输入实体名称" @input="searchFrom" />
      </div>
      <div v-if="fromSuggestions.length" class="gg-path-suggestions">
        <button v-for="s in fromSuggestions" :key="s.id" class="gg-path-sug" @click="fromId = s.id; fromName = s.name; fromSuggestions = []">{{ s.icon }} {{ s.name }}</button>
      </div>
      <div class="gg-path-row">
        <label>终点</label>
        <input v-model="toName" class="gg-path-input" placeholder="输入实体名称" @input="searchTo" />
      </div>
      <div v-if="toSuggestions.length" class="gg-path-suggestions">
        <button v-for="s in toSuggestions" :key="s.id" class="gg-path-sug" @click="toId = s.id; toName = s.name; toSuggestions = []">{{ s.icon }} {{ s.name }}</button>
      </div>
      <button class="gg-path-btn" :disabled="!fromId || !toId" @click="search">搜索路径</button>
      <div v-if="pathLength >= 0" class="gg-path-result">
        找到路径，经过 {{ pathLength }} 个节点
      </div>
      <div v-if="notFound" class="gg-path-result gg-path-notfound">
        未找到路径
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { type GraphNode } from '@worldsmith/ui-kit'

const props = defineProps<{
  visible: boolean
  nodes: GraphNode[]
  pathLength: number
  notFound: boolean
}>()

const emit = defineEmits<{
  close: []
  search: [fromId: string, toId: string]
}>()

const fromName = ref('')
const toName = ref('')
const fromId = ref('')
const toId = ref('')
const fromSuggestions = ref<GraphNode[]>([])
const toSuggestions = ref<GraphNode[]>([])

function searchFrom() {
  const q = fromName.value.toLowerCase()
  if (!q) { fromSuggestions.value = []; fromId.value = ''; return }
  fromSuggestions.value = props.nodes.filter(n => n.name.toLowerCase().includes(q)).slice(0, 8)
}

function searchTo() {
  const q = toName.value.toLowerCase()
  if (!q) { toSuggestions.value = []; toId.value = ''; return }
  toSuggestions.value = props.nodes.filter(n => n.name.toLowerCase().includes(q)).slice(0, 8)
}

function search() {
  if (fromId.value && toId.value) emit('search', fromId.value, toId.value)
}
</script>

<style scoped>
.gg-path-panel { position: absolute; top: 50px; left: 12px; z-index: var(--z-dropdown); background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 12px; width: 260px; backdrop-filter: blur(8px); }
.gg-path-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: var(--font-size-sm); color: var(--color-primary); font-weight: bold; }
.gg-path-close { border: none; background: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); }
.gg-path-body { font-size: var(--font-size-sm); }
.gg-path-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.gg-path-row label { font-size: var(--font-size-xs); color: var(--color-text-secondary); width: 30px; flex-shrink: 0; }
.gg-path-input { flex: 1; padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); outline: none; }
.gg-path-input:focus { border-color: var(--color-primary); }
.gg-path-suggestions { max-height: 120px; overflow-y: auto; margin-bottom: 4px; }
.gg-path-sug { display: block; width: 100%; padding: 4px 8px; border: none; background: none; color: var(--color-text-primary); font-size: var(--font-size-sm); text-align: left; cursor: pointer; }
.gg-path-sug:hover { background: var(--color-primary-subtle); }
.gg-path-btn { width: 100%; margin-top: 8px; padding: 6px; border: 1px solid var(--color-primary); border-radius: var(--radius-sm); background: var(--color-primary-subtle); color: var(--color-primary); cursor: pointer; font-size: var(--font-size-sm); }
.gg-path-btn:disabled { opacity: 0.4; cursor: default; }
.gg-path-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--color-primary) 20%, transparent); }
.gg-path-result { margin-top: 6px; font-size: var(--font-size-xs); color: var(--color-success); }
.gg-path-notfound { color: var(--color-danger); }
</style>

<template>
  <div class="orchestrator-panel">
    <!-- 运行区 -->
    <div class="op-run">
      <div class="op-run-head">
        <span class="op-label">{{ title }}</span>
      </div>
      <div class="op-run-row">
        <input
          v-model="inputText"
          class="op-input"
          :placeholder="placeholder"
          :disabled="busy"
          @keydown.enter.prevent="runPerformed"
        />
        <button class="op-run-btn" :disabled="busy || !inputText.trim()" @click="runPerformed">
          <template v-if="busy">运行中…</template>
          <template v-else>{{ runLabel }}</template>
        </button>
      </div>
      <div v-if="error" class="op-error">{{ error }}</div>
    </div>

    <!-- 结果区 -->
    <div v-if="result" class="op-result">
      <div class="op-result-label">结果</div>
      <div class="op-status">
        <span class="op-status-tag" :class="result.status">{{ statusText }}</span>
        <span class="op-iterations">迭代 {{ result.iterations }}</span>
      </div>
      <div v-if="result.finalMessage" class="op-final">{{ result.finalMessage }}</div>
      <div v-if="treeEntries.length" class="op-tree">
        <div class="op-tree-label">思维节点 ({{ treeEntries.length }})</div>
        <div class="op-tree-grid">
          <div v-for="(node, i) in treeEntries" :key="i" class="op-tree-node">
            <span class="op-tree-idx">{{ node.idx }}</span>
            <span class="op-tree-text">{{ node.text }}</span>
            <span v-if="node.score !== undefined" class="op-tree-score">{{ node.score }}/100</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="op-empty">
      <TuiEmpty :icon="icon" :fill="false" :title="emptyTitle" :hint="emptyHint" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 编排模式单个面板（ToT / GoT / Supervisor 共用结构）。
 * 四段式：运行区（输入+运行）/ 结果区（状态/终态消息/思维节点）。遵循 agent-ux-guidelines。
 * 按 mode 选择对应的模块级单例 composable（useToTRust / useGoTRust / useSupervisorRust）
 * 调相应 `orchestrator_run_*` Tauri 命令。
 */
import { ref, computed } from 'vue'
import TuiEmpty from '@/components/ui/TuiEmpty.vue'
import { useToTRust } from '../composables/useToTRust'
import { useGoTRust } from '../composables/useGoTRust'
import { useSupervisorRust } from '../composables/useSupervisorRust'

const props = defineProps<{
  /** 模式：tot | got | supervisor */
  mode: string
  title: string
  icon: string
  placeholder: string
  runLabel: string
  emptyTitle: string
  emptyHint: string
  /** supervisor 模式需要的 specs（结构化子 Agent 规格） */
  specs?: Array<{ id: string; name: string; description: string }>
}>()

// 按 mode 选单例 composable（互斥；mode 在实例生命周期不变，直接解构其 refs）
const { busy, error, result, run, reset } = props.mode === 'tot'
  ? useToTRust()
  : props.mode === 'got'
    ? useGoTRust()
    : useSupervisorRust()
const inputText = ref('')

const statusText = computed(() => {
  const st = result.value?.status
  return st === 'completed' ? '完成' : st === 'aborted' ? '中止' : st === 'error' ? '错误' : st === 'timeout' ? '超时' : ''
})

// 从 finalState 提取思维节点（ToT/GoT 树；兼容数组/近似结构）
const treeEntries = computed<Array<{ idx: string; text: string; score?: unknown }>>(() => {
  const fs = result.value?.finalState as Record<string, unknown> | undefined
  if (!fs) return []
  const tree = (fs.tree ?? fs.nodes ?? fs.final_thought ?? fs.thoughts) as unknown[] | undefined
  if (!Array.isArray(tree)) return []
  return tree.slice(0, 30).map((n, i) => {
    const node = (n ?? {}) as Record<string, unknown>
    return {
      idx: String(node.id ?? node.node_id ?? i + 1),
      text: String(node.content ?? node.text ?? node.thought ?? ''),
      score: node.score ?? node.score_value,
    }
  })
})

async function runPerformed() {
  const text = inputText.value.trim()
  if (!text || busy.value) return
  reset()
  if (props.mode === 'supervisor') {
    await run(text, { specs: props.specs ?? [] })
  } else {
    await run(text)
  }
  inputText.value = ''
}
</script>

<style scoped>
.orchestrator-panel { display: flex; flex-direction: column; gap: 12px; }
.op-label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.op-run-head { margin-bottom: 6px; }
.op-run-row { display: flex; gap: 8px; }
.op-input { flex: 1; min-width: 0; padding: 7px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-muted); color: var(--text-primary); font-size: var(--fs-sm); font-family: inherit; }
.op-input:focus { outline: none; border-color: var(--accent); }
.op-input:disabled { opacity: 0.6; }
.op-run-btn { border: none; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-size: var(--fs-xs); font-weight: 600; padding: 0 14px; cursor: pointer; transition: opacity 0.15s, transform 0.15s; }
.op-run-btn:hover:not(:disabled) { filter: brightness(1.05); }
.op-run-btn:active:not(:disabled) { transform: scale(var(--press-scale)); }
.op-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.op-error { margin-top: 8px; font-size: var(--fs-xs); color: var(--danger, #e5484d); word-break: break-word; }

.op-result-label { font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 6px; }
.op-status { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.op-status-tag { font-size: var(--fs-xs); font-weight: 600; padding: 2px 8px; border-radius: 4px; }
.op-status-tag.completed { background: var(--success-soft, rgba(46,160,67,.12)); color: var(--success, #2ea043); }
.op-status-tag.error { background: var(--danger-soft, rgba(229,72,77,.12)); color: var(--danger, #e5484d); }
.op-status-tag.aborted, .op-status-tag.timeout { background: var(--warning-soft, rgba(196,150,51,.12)); color: var(--warning, #c49633); }
.op-iterations { font-size: var(--fs-2xs); color: var(--text-muted); }
.op-final { font-size: var(--fs-sm); color: var(--text-primary); line-height: 1.5; white-space: pre-wrap; word-break: break-word; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-muted); border: 1px solid var(--border); }

.op-tree { margin-top: 10px; }
.op-tree-label { font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 6px; }
.op-tree-grid { display: flex; flex-direction: column; gap: 4px; }
.op-tree-node { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--bg-muted); border: 1px solid var(--border); }
.op-tree-idx { font-family: var(--font-mono); font-size: var(--fs-2xs); color: var(--text-muted); }
.op-tree-text { flex: 1; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.op-tree-score { font-size: var(--fs-xs); font-weight: 600; color: var(--accent); flex-shrink: 0; }
</style>
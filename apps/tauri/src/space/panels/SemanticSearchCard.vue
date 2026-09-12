<template>
  <div class="semantic-card">
    <div
      class="sc-head"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
      @keydown.enter.prevent="expanded = !expanded"
      @keydown.space.prevent="expanded = !expanded"
    >
      <WsIcon name="search" :size="14" :stroke-width="1.7" class="sc-head-icon" />
      <span class="sc-title">语义检索</span>
      <span class="sc-sub">{{ statusLine }}</span>
      <WsIcon
        class="sc-chevron"
        :class="{ open: expanded }"
        name="chevron-down"
        :size="12"
        :stroke-width="1.7"
      />
    </div>

    <div v-show="expanded" class="sc-body">
      <div class="sc-row">
        <span class="sc-label">端点</span>
        <input v-model="form.apiUrl" class="sc-input" placeholder="https://api.siliconflow.cn/v1/embeddings" />
      </div>
      <div class="sc-row">
        <span class="sc-label">模型</span>
        <input v-model="form.model" class="sc-input" placeholder="BAAI/bge-m3" />
      </div>
      <div class="sc-row">
        <span class="sc-label">维度</span>
        <input v-model.number="form.dim" class="sc-input sc-input-num" type="number" min="1" max="8192" />
        <span class="sc-label sc-label-gap">超时(秒)</span>
        <input v-model.number="form.timeoutSecs" class="sc-input sc-input-num" type="number" min="1" max="300" />
      </div>
      <div class="sc-row">
        <span class="sc-label">API Key</span>
        <input
          v-model="form.apiKey"
          class="sc-input"
          type="password"
          autocomplete="off"
          :placeholder="apiKeySet ? '已配置（留空保持不变）' : '未配置'"
        />
      </div>
      <label class="sc-toggle">
        <input v-model="form.enabled" type="checkbox" />
        <span>启用语义检索（混合召回 BM25+向量 / 语义去重）</span>
      </label>

      <div class="sc-actions">
        <button class="sc-btn sc-btn-primary" :disabled="busy" @click="save">
          <WsIcon name="check" :size="12" :stroke-width="1.7" />保存
        </button>
        <button class="sc-btn" :disabled="busy || !currentSessionId" :title="currentSessionId ? '按当前会话重建索引' : '请先打开会话'" @click="rebuild">
          <WsIcon name="refresh" :size="12" :stroke-width="1.7" />重建索引
        </button>
      </div>

      <div v-if="message" class="sc-msg" :class="msgKind === 'err' ? 'sc-msg-err' : 'sc-msg-ok'">
        {{ message }}
      </div>
      <div class="sc-status">
        索引：关键词 {{ stats.keywordLen }} · 向量 {{ stats.vectorLen }} · 维度 {{ stats.dim || form.dim }}
      </div>
      <p class="sc-hint">
        仅记忆摘要（标题/摘要/事实/标签）会发送到该端点，不含原始对话；保存后对全部会话即时生效。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SemanticSearchCard：A2 戊1「语义检索」配置区块（右栏 配置 → 记忆 子页）
 *
 * 数据面：`cmd_semantic_config_get/set`（端点/模型/维度/超时/Key）+ `cmd_semantic_status`
 * （索引条数）+ `cmd_semantic_rebuild`（按当前会话重建索引）。
 * 保存即生效：后端配置句柄共享，所有会话的检索栈按配置指纹自动重建。
 * Key 走安全存储（本组件不回显明文，只显示「已配置/未配置」）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { useAgentRust } from '@/agent/composables/useAgentRust'

interface SemanticSettingsDto {
  enabled: boolean
  apiUrl: string
  model: string
  dim: number
  timeoutSecs: number
  apiKeySet: boolean
}

interface SemanticStatsDto {
  keywordLen: number
  vectorLen: number
  dim: number
}

interface RebuildResultDto {
  docs: number
  stats: SemanticStatsDto
}

const { currentSessionId } = useAgentRust()

const expanded = ref(true)
const busy = ref(false)
const message = ref('')
const msgKind = ref<'ok' | 'err'>('ok')
const apiKeySet = ref(false)
const stats = ref<SemanticStatsDto>({ keywordLen: 0, vectorLen: 0, dim: 0 })
const form = reactive({
  enabled: false,
  apiUrl: '',
  model: '',
  dim: 1024,
  timeoutSecs: 30,
  apiKey: '',
})

const statusLine = computed(() =>
  form.enabled ? `已启用 · ${form.model || '未选模型'}` : '未启用',
)

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function setMsg(kind: 'ok' | 'err', text: string): void {
  msgKind.value = kind
  message.value = text
}

function applySettings(cfg: SemanticSettingsDto): void {
  form.enabled = cfg.enabled
  form.apiUrl = cfg.apiUrl
  form.model = cfg.model
  form.dim = cfg.dim
  form.timeoutSecs = cfg.timeoutSecs
  apiKeySet.value = cfg.apiKeySet
  form.apiKey = ''
}

async function refresh(): Promise<void> {
  busy.value = true
  try {
    const [cfg, st] = await Promise.all([
      invoke<SemanticSettingsDto>('cmd_semantic_config_get'),
      invoke<SemanticStatsDto>('cmd_semantic_status'),
    ])
    applySettings(cfg)
    stats.value = st
  } catch (e) {
    setMsg('err', `读取配置失败：${errText(e)}`)
  } finally {
    busy.value = false
  }
}

async function save(): Promise<void> {
  busy.value = true
  message.value = ''
  try {
    const cfg = await invoke<SemanticSettingsDto>('cmd_semantic_config_set', {
      settings: {
        enabled: form.enabled,
        apiUrl: form.apiUrl,
        model: form.model,
        dim: form.dim,
        timeoutSecs: form.timeoutSecs,
        // 留空 = 不覆盖已有 Key（undefined 会被 invoke 序列化丢弃）
        apiKey: form.apiKey || undefined,
        clearApiKey: false,
      },
    })
    applySettings(cfg)
    stats.value = await invoke<SemanticStatsDto>('cmd_semantic_status')
    setMsg('ok', cfg.enabled ? '已保存并生效' : '已保存（当前未启用）')
  } catch (e) {
    setMsg('err', errText(e))
  } finally {
    busy.value = false
  }
}

async function rebuild(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) {
    setMsg('err', '请先打开一个会话（索引按会话重建）')
    return
  }
  busy.value = true
  message.value = ''
  try {
    const r = await invoke<RebuildResultDto>('cmd_semantic_rebuild', { sessionId: sid })
    stats.value = r.stats
    setMsg('ok', `索引已重建：${r.docs} 条`)
  } catch (e) {
    setMsg('err', errText(e))
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.semantic-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: 10px;
  background: var(--color-surface);
  overflow: hidden;
}

.sc-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
}
.sc-head:hover {
  background: var(--color-surface-hover, var(--color-border));
}
.sc-head-icon {
  color: var(--color-text-tertiary);
}
.sc-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}
.sc-sub {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  margin-left: 2px;
}
.sc-chevron {
  margin-left: auto;
  color: var(--color-text-tertiary);
  transition: transform 0.15s;
}
.sc-chevron.open {
  transform: rotate(180deg);
}

.sc-body {
  padding: 2px 10px 10px;
}

.sc-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 6px;
}

.sc-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  width: 56px;
  flex-shrink: 0;
}
.sc-label-gap {
  width: auto;
  margin-left: 6px;
}

.sc-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg, transparent);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  padding: 4px 6px;
  outline: none;
}
.sc-input:focus {
  border-color: var(--color-primary);
}
.sc-input-num {
  flex: 0 0 64px;
}

.sc-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.sc-toggle input {
  accent-color: var(--color-primary);
}

.sc-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.sc-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  padding: 3px 10px;
  cursor: pointer;
}
.sc-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.sc-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.sc-btn-primary {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.sc-msg {
  font-size: var(--font-size-xs);
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  word-break: break-all;
}
.sc-msg-ok {
  color: var(--color-success, #16a34a);
  background: rgba(22, 163, 74, 0.08);
}
.sc-msg-err {
  color: var(--color-danger, #dc2626);
  background: rgba(220, 38, 38, 0.08);
}

.sc-status {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.sc-hint {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  margin: 4px 0 0;
  line-height: 1.4;
}
</style>

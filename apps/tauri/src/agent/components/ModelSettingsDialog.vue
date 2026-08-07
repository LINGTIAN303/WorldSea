<script setup lang="ts">
import { ref, watch } from 'vue'
import TuiModal from '../../components/ui/TuiModal.vue'
import TuiSegmented from '../../components/ui/TuiSegmented.vue'
import TuiButton from '../../components/ui/TuiButton.vue'
import TuiSelect from '../../components/ui/TuiSelect.vue'

/** 与 useAgentRust `setProviderConfig` 入参（RustProviderConfigFull）对齐 */
interface ProviderConfigFull {
  mode: 'cloud' | 'local' | 'custom'
  provider?: string
  model_id?: string
  api_key?: string
  endpoint?: string
  api_type?: string
  base_url?: string
  context_window?: number
  max_tokens?: number
}

const props = defineProps<{
  show: boolean
  /** 保存回调（由 App.vue 注入，调 backend.setProviderConfig） */
  onSaveConfig: (config: ProviderConfigFull) => Promise<void>
}>()

const emit = defineEmits<{
  close: []
}>()

const mode = ref<'cloud' | 'local' | 'custom'>('cloud')
const cloud = ref({ provider: '', model_id: '', api_key: '' })
const local = ref({ endpoint: '', api_type: 'ollama', model_id: '' })
const custom = ref({
  base_url: '',
  api_key: '',
  api_type: 'openai-compatible',
  model_id: '',
  context_window: 1048576,
  max_tokens: 65536,
})
const saving = ref(false)
const error = ref('')

/** 模式切换选项 */
const modeOptions = [
  { value: 'cloud', label: '云端' },
  { value: 'local', label: '本地' },
  { value: 'custom', label: '自定义' },
]

/** API Key 本地存储键（Rust skip_serializing 不回显，只能前端持久化） */
function apiKeyKey(provider: string): string {
  return `worldsmith:api_key:${provider}`
}

// 打开弹窗时回填本地存储的 API Key
watch(
  () => props.show,
  (show) => {
    if (!show) return
    error.value = ''
    const saved = localStorage.getItem(apiKeyKey(cloud.value.provider || 'default'))
    if (saved) cloud.value.api_key = saved
  },
)

/** 保存：按模式构造 payload 调 setProviderConfig，成功后持久化 API Key 并关闭 */
async function onSave() {
  const config: ProviderConfigFull = { mode: mode.value }
  if (mode.value === 'cloud') {
    config.provider = cloud.value.provider
    config.model_id = cloud.value.model_id
    config.api_key = cloud.value.api_key
    if (cloud.value.provider) {
      localStorage.setItem(apiKeyKey(cloud.value.provider), cloud.value.api_key)
    }
  } else if (mode.value === 'local') {
    config.endpoint = local.value.endpoint
    config.api_type = local.value.api_type
    config.model_id = local.value.model_id
  } else {
    config.base_url = custom.value.base_url
    config.api_key = custom.value.api_key
    config.api_type = custom.value.api_type
    config.model_id = custom.value.model_id
    config.context_window = custom.value.context_window
    config.max_tokens = custom.value.max_tokens
  }

  saving.value = true
  error.value = ''
  try {
    await props.onSaveConfig(config)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <TuiModal :show="show" title="模型配置" size="md" @close="emit('close')">
    <!-- 模式切换（分段选择器） -->
    <TuiSegmented v-model="mode" :options="modeOptions" />

    <div class="fields">
      <!-- 云端模式 -->
      <template v-if="mode === 'cloud'">
        <div class="field">
          <label class="field-label">Provider</label>
          <input v-model="cloud.provider" type="text" list="provider-suggest" placeholder="如 deepseek / openai" />
          <!-- 常用 provider 预置建议（原生 datalist，下拉可选） -->
          <datalist id="provider-suggest">
            <option value="deepseek" />
            <option value="openai" />
            <option value="moonshot" />
            <option value="zhipu" />
            <option value="qwen" />
            <option value="siliconflow" />
            <option value="anthropic" />
          </datalist>
        </div>
        <div class="field">
          <label class="field-label">模型 ID</label>
          <input v-model="cloud.model_id" type="text" placeholder="如 deepseek-v4-flash" />
        </div>
        <div class="field">
          <label class="field-label">API Key</label>
          <input v-model="cloud.api_key" type="password" placeholder="填写的 Key 仅存本地" autocomplete="off" />
        </div>
      </template>

      <!-- 本地模式 -->
      <template v-else-if="mode === 'local'">
        <div class="field">
          <label class="field-label">端点 URL</label>
          <input v-model="local.endpoint" type="text" placeholder="如 http://localhost:11434" />
        </div>
        <div class="field">
          <label class="field-label">API 类型</label>
          <TuiSelect
            v-model="local.api_type"
            size="md"
            :options="[
              { value: 'ollama', label: 'ollama' },
              { value: 'lm-studio', label: 'lm-studio' },
              { value: 'vllm', label: 'vllm' },
              { value: 'llama-cpp', label: 'llama-cpp' },
            ]"
          />
        </div>
        <div class="field">
          <label class="field-label">模型 ID</label>
          <input v-model="local.model_id" type="text" placeholder="本地模型名" />
        </div>
      </template>

      <!-- 自定义模式 -->
      <template v-else>
        <div class="field">
          <label class="field-label">Base URL</label>
          <input v-model="custom.base_url" type="text" placeholder="如 https://api.example.com/v1" />
        </div>
        <div class="field">
          <label class="field-label">API 类型</label>
          <TuiSelect
            v-model="custom.api_type"
            size="md"
            :options="[
              { value: 'openai-compatible', label: 'openai-compatible' },
              { value: 'anthropic-compatible', label: 'anthropic-compatible' },
            ]"
          />
        </div>
        <div class="field">
          <label class="field-label">模型 ID</label>
          <input v-model="custom.model_id" type="text" placeholder="模型名" />
        </div>
        <div class="field">
          <label class="field-label">API Key</label>
          <input v-model="custom.api_key" type="password" placeholder="填写的 Key 仅存本地" autocomplete="off" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">上下文窗口</label>
            <input v-model.number="custom.context_window" type="number" placeholder="默认 1048576" />
          </div>
          <div class="field">
            <label class="field-label">最大输出 token</label>
            <input v-model.number="custom.max_tokens" type="number" placeholder="默认 65536" />
          </div>
        </div>
      </template>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <template #footer>
      <TuiButton variant="ghost" @click="emit('close')">取消</TuiButton>
      <TuiButton variant="primary" :disabled="saving" @click="onSave">
        {{ saving ? '保存中…' : '保存' }}
      </TuiButton>
    </template>
  </TuiModal>
</template>

<style scoped>
.fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-row {
  display: flex;
  gap: 12px;
}
.field-row .field {
  flex: 1;
}
.field-label {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.field input,
.field select {
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  color: var(--text-primary);
  outline: none;
  background: var(--bg-surface);
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.field input:focus,
.field select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/* TuiSelect 替换原生 select 后需与 input 同宽（flex column 默认 stretch 只作用于根，trigger 需显式撑满） */
.field :deep(.tui-select) {
  width: 100%;
}
.field :deep(.tui-select__trigger) {
  width: 100%;
}
.error {
  margin-top: 12px;
  font-size: var(--fs-md);
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid var(--danger-soft);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
}
</style>

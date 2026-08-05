<template>
  <Teleport to="body">
    <Transition name="model">
      <div v-if="show" class="model-overlay" @click.self="onOverlayClick">
        <div class="model-panel">
          <div class="model__header">
            <h2 class="model__title">模型配置</h2>
            <button class="model__close" @click="emit('close')">
              <WsIcon name="close" size="xs" />
            </button>
          </div>

          <div class="model__body">
            <!-- 模式切换 -->
            <div class="model__modes">
              <label class="mode-option">
                <input type="radio" value="cloud" v-model="mode" />
                <span>云端</span>
              </label>
              <label class="mode-option">
                <input type="radio" value="local" v-model="mode" />
                <span>本地</span>
              </label>
              <label class="mode-option">
                <input type="radio" value="custom" v-model="mode" />
                <span>自定义</span>
              </label>
            </div>

            <div class="model__fields">
              <!-- 云端模式 -->
              <template v-if="mode === 'cloud'">
                <div class="field">
                  <label class="field-label">Provider</label>
                  <input v-model="cloud.provider" type="text" placeholder="如 deepseek / openai" />
                </div>
                <div class="field">
                  <label class="field-label">模型 ID</label>
                  <input v-model="cloud.model_id" type="text" placeholder="如 deepseek-v4-flash" />
                </div>
                <div class="field">
                  <label class="field-label">API Key</label>
                  <input v-model="cloud.api_key" type="password" placeholder="填写的 Key 仅存本地" />
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
                  <select v-model="local.api_type">
                    <option value="ollama">ollama</option>
                    <option value="lm-studio">lm-studio</option>
                    <option value="vllm">vllm</option>
                    <option value="llama-cpp">llama-cpp</option>
                  </select>
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
                  <select v-model="custom.api_type">
                    <option value="openai-compatible">openai-compatible</option>
                    <option value="anthropic-compatible">anthropic-compatible</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">模型 ID</label>
                  <input v-model="custom.model_id" type="text" placeholder="模型名" />
                </div>
                <div class="field">
                  <label class="field-label">API Key</label>
                  <input v-model="custom.api_key" type="password" placeholder="填写的 Key 仅存本地" />
                </div>
                <div class="field field-row">
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

            <div v-if="saving" class="model__saving">保存中…</div>
            <div v-if="error" class="model__error">{{ error }}</div>
          </div>

          <div class="model__footer">
            <button class="model__cancel" @click="emit('close')">取消</button>
            <button class="model__save" :disabled="saving" @click="onSave">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

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

/** 点击遮罩关闭（与 ExportCorrectorDialog 一致） */
function onOverlayClick() {
  emit('close')
}

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

<style scoped>
.model-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.model-panel {
  background: #fff;
  border-radius: 12px;
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.3);
}
.model__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e5e5e5;
}
.model__title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: #333;
}
.model__close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.model__close:hover {
  background: #f5f5f5;
  color: #333;
}
.model__body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.model__modes {
  display: flex;
  gap: 8px;
}
.mode-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 0;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  color: #555;
  cursor: pointer;
}
.mode-option:has(input:checked) {
  border-color: #1a73e8;
  color: #1a73e8;
  background: #e8f0fe;
}
.mode-option input {
  accent-color: #1a73e8;
}
.model__fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-row {
  flex-direction: row;
  gap: 10px;
}
.field-row .field {
  flex: 1;
}
.field-label {
  font-size: 12px;
  color: #999;
}
.field input,
.field select {
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  color: #333;
  outline: none;
  background: #fff;
}
.field input:focus,
.field select:focus {
  border-color: #1a73e8;
}
.model__saving {
  font-size: 13px;
  color: #1a73e8;
}
.model__error {
  font-size: 13px;
  color: #d93025;
  background: #fce8e6;
  padding: 8px 10px;
  border-radius: 6px;
}
.model__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #e5e5e5;
}
.model__cancel {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: #666;
  cursor: pointer;
}
.model__save {
  padding: 8px 18px;
  border: none;
  border-radius: 6px;
  background: #1a73e8;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.model__save:disabled {
  background: #ccc;
  cursor: not-allowed;
}
.model-enter-active,
.model-leave-active {
  transition: opacity 0.2s ease;
}
.model-enter-from,
.model-leave-to {
  opacity: 0;
}
</style>
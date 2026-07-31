<template>
  <div class="sub-panel">
    <div class="settings-section">
      <div class="settings-label">视觉分析</div>
      <div class="settings-hint">当主模型不支持图片理解时，Agent 会自动调用 vision_analyze 工具，通过视觉模型分析图片并将结果传回主模型</div>
      <div class="settings-row">
        <span class="settings-key">供应商</span>
        <select :value="settingsStore.visionSubAgentProvider" @change="onVisionProviderChange" class="settings-select">
          <option value="">自动选择</option>
          <option v-for="p in visionProviders" :key="p" :value="p">{{ visionProviderLabels[p] || p }}</option>
        </select>
      </div>
      <div class="settings-row">
        <span class="settings-key">视觉模型</span>
        <template v-if="visionSubAgentModels.length > 0">
          <select :value="settingsStore.visionSubAgentModel" @change="onVisionModelChange" class="settings-select">
            <option v-for="m in visionSubAgentModels" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </template>
        <template v-else>
          <input type="text" class="settings-input" v-model="settingsStore.visionSubAgentModel" placeholder="视觉模型 ID" />
        </template>
      </div>
      <div class="settings-hint" v-if="!currentModelSupportsVision">当前主模型不支持视觉，发送图片时 Agent 将通过 vision_analyze 工具调用视觉模型分析</div>
      <div class="settings-hint" v-else>当前主模型已支持视觉，可直接识图；也可通过 vision_analyze 工具获取更详细的分析</div>
    </div>
    <div style="border-top:1px solid var(--agent-border);margin:8px 0"></div>
    <div class="settings-section">
      <div class="settings-label">图像生成</div>
      <div class="settings-hint">Agent 可通过 image_generate 工具生成图片</div>
      <div class="settings-row">
        <span class="settings-key">供应商</span>
        <select :value="imageGenProvider" @change="onImageGenProviderChange" class="settings-select">
          <option value="">未配置</option>
          <option v-for="p in imageGenProviders" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>
      <div class="settings-row">
        <span class="settings-key">模型 ID</span>
        <template v-if="imageGenModelOptions.length > 0">
          <select :value="imageGenModel" @change="onImageGenModelChange" class="settings-select">
            <option v-for="m in imageGenModelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </template>
        <template v-else>
          <input type="text" class="settings-input" v-model="imageGenModel" placeholder="如 dall-e-3" />
        </template>
      </div>
      <div class="settings-row" v-if="imageGenProvider === 'custom'">
        <span class="settings-key">供应商</span>
        <select :value="imageGenCustomProviderId" @change="onImageGenCustomProviderChange" class="settings-select">
          <option value="">选择自定义供应商</option>
          <option v-for="cp in settingsStore.customProviders" :key="cp.id" :value="cp.id">{{ cp.name || cp.baseUrl }}</option>
        </select>
      </div>
      <div class="settings-hint" v-if="imageGenProvider">API Key 自动复用上方已配置的密钥</div>
      <div class="settings-hint" v-if="imageGenProvider">已配置 {{ imageGenProviders.find(p => p.value === (imageGenProvider === 'custom' ? `custom:${imageGenCustomProviderId}` : imageGenProvider))?.label || imageGenProvider }} 图像生成</div>
      <div class="settings-hint" v-else>未配置图像生成，image_generate 工具将不可用</div>
    </div>
    <div style="border-top:1px solid var(--agent-border);margin:8px 0"></div>
    <div class="settings-section">
      <div class="settings-label">视频生成</div>
      <div class="settings-hint">Agent 可通过 video_generate 工具生成视频（异步模式）</div>
      <div class="settings-row">
        <span class="settings-key">供应商</span>
        <select :value="videoGenProvider" @change="onVideoGenProviderChange" class="settings-select">
          <option value="">未配置</option>
          <option v-for="p in videoGenProviders" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>
      <div class="settings-row">
        <span class="settings-key">模型 ID</span>
        <template v-if="videoGenModelOptions.length > 0">
          <select :value="videoGenModel" @change="onVideoGenModelChange" class="settings-select">
            <option v-for="m in videoGenModelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </template>
        <template v-else>
          <input type="text" class="settings-input" v-model="videoGenModel" placeholder="如 agnes-video-v2.0" />
        </template>
      </div>
      <div class="settings-hint" v-if="videoGenProvider">API Key 自动复用上方已配置的密钥</div>
      <div class="settings-hint" v-if="videoGenProvider">已配置 {{ videoGenProviders.find(p => p.value === videoGenProvider)?.label }} 视频生成</div>
      <div class="settings-hint" v-else>未配置视频生成，video_generate 工具将不可用</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { getModelsByProvider, getModelInfo, modelSupportsVision, getVisionModels, getProviderLabelMap } from '@worldsmith/agent-runtime'

const settingsStore = useSettingsStore()

const visionProviders = computed(() => {
  const providers = new Set<string>()
  for (const m of getVisionModels()) {
    providers.add(m.provider)
  }
  return Array.from(providers)
})

const visionProviderLabels: Record<string, string> = getProviderLabelMap()

const visionSubAgentModels = computed(() => {
  const provider = settingsStore.visionSubAgentProvider
  if (!provider) return getVisionModels().map(m => ({ id: m.id, name: m.name }))
  return getModelsByProvider(provider).filter(m => {
    const info = getModelInfo(m.id)
    return info?.supportsVision ?? false
  })
})

const currentModelSupportsVision = computed(() => modelSupportsVision(settingsStore.aiCloudModel))

function onVisionProviderChange(e: Event): void {
  const provider = (e.target as HTMLSelectElement).value
  settingsStore.visionSubAgentProvider = provider
  if (provider) {
    const visionModels = getModelsByProvider(provider).filter(m => {
      const info = getModelInfo(m.id)
      return info?.supportsVision ?? false
    })
    if (visionModels.length > 0) {
      settingsStore.visionSubAgentModel = visionModels[0].id
    }
  } else {
    const allVision = getVisionModels()
    settingsStore.visionSubAgentModel = allVision.length > 0 ? allVision[0].id : ''
  }
}

function onVisionModelChange(e: Event): void {
  const modelId = (e.target as HTMLSelectElement).value
  settingsStore.visionSubAgentModel = modelId
}

// ── 图像生成配置 ──
const imageGenProvider = ref(localStorage.getItem('worldsmith_image_gen_provider') || '')
const imageGenModel = ref(localStorage.getItem('worldsmith_image_gen_model') || '')
const imageGenBaseUrl = ref(localStorage.getItem('worldsmith_image_gen_base_url') || '')
const imageGenCustomProviderId = ref('')

// 初始化：如果 provider 是 custom，尝试从 baseUrl 匹配自定义供应商 ID
if (imageGenProvider.value === 'custom' && imageGenBaseUrl.value) {
  const matched = settingsStore.customProviders.find(cp => cp.baseUrl === imageGenBaseUrl.value)
  if (matched) imageGenCustomProviderId.value = matched.id
}

watch(imageGenProvider, v => localStorage.setItem('worldsmith_image_gen_provider', v))
watch(imageGenModel, v => localStorage.setItem('worldsmith_image_gen_model', v))
watch(imageGenBaseUrl, v => localStorage.setItem('worldsmith_image_gen_base_url', v))

const imageGenProviders = computed(() => {
  const builtIn = [
    { value: 'openai', label: 'OpenAI (DALL-E)' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'agnes', label: 'Agnes AI' },
    { value: 'stepfun', label: 'StepFun' },
  ]
  const custom = settingsStore.customProviders.map(cp => ({
    value: `custom:${cp.id}`,
    label: `自定义: ${cp.name || cp.baseUrl}`,
  }))
  return [...builtIn, ...custom]
})

const imageGenModelOptions = computed(() => {
  const provider = imageGenProvider.value
  if (provider === 'openai') {
    return [
      { value: 'dall-e-3', label: 'DALL-E 3' },
      { value: 'gpt-image-1', label: 'GPT Image 1' },
    ]
  }
  if (provider === 'openrouter') {
    return getModelsByProvider('openrouter')
      .filter(m => {
        const id = m.id.toLowerCase()
        return id.includes('dall-e') || id.includes('image') || id.includes('flux') || id.includes('stable-diffusion') || id.includes('sdxl')
      })
      .map(m => ({ value: m.id, label: m.name }))
  }
  if (provider === 'agnes') {
    return [
      { value: 'agnes-image-2.1-flash', label: 'Agnes Image 2.1 Flash' },
      { value: 'agnes-image-2.0-flash', label: 'Agnes Image 2.0 Flash' },
    ]
  }
  if (provider === 'stepfun') {
    return [
      { value: 'step-image-edit-2', label: 'Step Image Edit 2' },
      { value: 'step-2x-large', label: 'Step 2X Large' },
      { value: 'step-1x-medium', label: 'Step 1X Medium' },
    ]
  }
  return []
})

function onImageGenProviderChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  if (value.startsWith('custom:')) {
    imageGenProvider.value = 'custom'
    const cpId = value.slice(7)
    imageGenCustomProviderId.value = cpId
    const cp = settingsStore.customProviders.find(p => p.id === cpId)
    if (cp) {
      imageGenBaseUrl.value = cp.baseUrl
      imageGenModel.value = cp.modelId
    }
  } else {
    imageGenProvider.value = value
    imageGenCustomProviderId.value = ''
    imageGenBaseUrl.value = ''
    if (value === 'openai') {
      imageGenModel.value = 'dall-e-3'
    } else if (value === 'openrouter' || value === 'stepfun') {
      const models = imageGenModelOptions.value
      imageGenModel.value = models.length > 0 ? models[0].value : ''
    } else {
      imageGenModel.value = ''
    }
  }
}

function onImageGenCustomProviderChange(e: Event): void {
  const cpId = (e.target as HTMLSelectElement).value
  imageGenCustomProviderId.value = cpId
  const cp = settingsStore.customProviders.find(p => p.id === cpId)
  if (cp) {
    imageGenBaseUrl.value = cp.baseUrl
    imageGenModel.value = cp.modelId
  }
}

function onImageGenModelChange(e: Event): void {
  imageGenModel.value = (e.target as HTMLSelectElement).value
}

// ── 视频生成配置 ──
const videoGenProvider = ref(localStorage.getItem('worldsmith_video_gen_provider') || '')
const videoGenModel = ref(localStorage.getItem('worldsmith_video_gen_model') || '')

watch(videoGenProvider, v => localStorage.setItem('worldsmith_video_gen_provider', v))
watch(videoGenModel, v => localStorage.setItem('worldsmith_video_gen_model', v))

const videoGenProviders = [
  { value: 'agnes', label: 'Agnes AI' },
  { value: 'minimax', label: 'MiniMax (海螺)' },
  { value: 'zhipu', label: '智谱 (CogVideoX)' },
  { value: 'qwen', label: '阿里 (Wan)' },
  { value: 'bytedance', label: '字节 (Seedance)' },
  { value: 'kling', label: '快手 (可灵)' },
]

const videoGenModelOptions = computed(() => {
  const provider = videoGenProvider.value
  if (provider === 'agnes') {
    return [
      { value: 'agnes-video-v2.0', label: 'Agnes Video V2.0' },
    ]
  }
  if (provider === 'minimax') {
    return [
      { value: 'MiniMax-Hailuo-02', label: 'Hailuo 02' },
      { value: 'T2V-01-Director', label: 'T2V-01 导演版' },
      { value: 'I2V-01-Director', label: 'I2V-01 导演版' },
      { value: 'T2V-01', label: 'T2V-01' },
      { value: 'I2V-01', label: 'I2V-01' },
    ]
  }
  if (provider === 'zhipu') {
    return [
      { value: 'cogvideox-2', label: 'CogVideoX-2' },
      { value: 'cogvideox', label: 'CogVideoX' },
    ]
  }
  if (provider === 'qwen') {
    return [
      { value: 'wan2.7-t2v-2026-04-25', label: 'Wan2.7 文生视频' },
      { value: 'wan2.7-i2v', label: 'Wan2.7 图生视频' },
      { value: 'wan2.2-i2v-flash', label: 'Wan2.2 Flash' },
    ]
  }
  if (provider === 'bytedance') {
    return [
      { value: 'doubao-seedance-2.0', label: 'Seedance 2.0' },
    ]
  }
  if (provider === 'kling') {
    return [
      { value: 'kling-v3', label: 'Kling V3' },
      { value: 'kling-v2.6', label: 'Kling V2.6' },
    ]
  }
  return []
})

function onVideoGenProviderChange(e: Event): void {
  const provider = (e.target as HTMLSelectElement).value
  videoGenProvider.value = provider
  const defaults: Record<string, string> = {
    agnes: 'agnes-video-v2.0',
    minimax: 'MiniMax-Hailuo-02',
    zhipu: 'cogvideox-2',
    qwen: 'wan2.7-t2v-2026-04-25',
    bytedance: 'doubao-seedance-2.0',
    kling: 'kling-v3',
  }
  videoGenModel.value = defaults[provider] || ''
}

function onVideoGenModelChange(e: Event): void {
  videoGenModel.value = (e.target as HTMLSelectElement).value
}
</script>

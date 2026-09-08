<template>
  <CardDeck :count="7" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx"
        v-show="idx === 0 ? match('陪伴模式 video 启用 开关 空间 静默') : idx === 1 ? match('弹窗 持续 时间 duration 防抖 超时') : idx === 2 ? match('人格 persona 跨插件 角色 附体 切换 概率') : idx === 3 ? match('概率 luck 运气 活跃 沉默') : idx === 4 ? match('场景 scene 概率 probability 触发') : idx === 5 ? match('弹窗 位置 场景化 停驻 pin 点击') : match('独立 模型 model 供应商 provider')">
        <template v-if="idx === 0">
        <div class="sc-head">陪伴模式</div>
        <div class="set-row"><span>启用陪伴模式</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeEnabled" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-hint">编辑实体时，AI 以角色身份弹出通知评论</div>
        <div class="set-row"><span>Agent 空间内静默</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeSilentInSpace" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-hint">在 Agent 空间中不触发陪伴模式通知</div>
        </template>
        <template v-else-if="idx === 1">
        <div class="sc-head">触发与弹窗</div>
        <div class="set-row"><span>弹窗持续时间（秒）</span><div class="set-range-wrap"><input type="range" min="3" max="15" step="1" v-model.number="store.companionModeDuration" class="set-range" /><span class="set-range-val">{{ store.companionModeDuration }}s</span></div></div>
        <div class="set-row"><span>防抖等待（秒）</span><div class="set-range-wrap"><input type="range" min="2" max="15" step="1" v-model.number="store.companionModeDebounce" class="set-range" /><span class="set-range-val">{{ store.companionModeDebounce }}s</span></div></div>
        <div class="set-row"><span>LLM 超时（秒）</span><div class="set-range-wrap"><input type="range" min="1" max="10" step="1" v-model.number="store.companionModeTimeout" class="set-range" /><span class="set-range-val">{{ store.companionModeTimeout }}s</span></div></div>
        <div class="set-row"><span>连续失败上限</span><div class="set-range-wrap"><input type="range" min="1" max="10" step="1" v-model.number="store.companionModeMaxFailures" class="set-range" /><span class="set-range-val">{{ store.companionModeMaxFailures }}次</span></div></div>
        <div class="set-row"><span>停顿触发阈值（秒）</span><div class="set-range-wrap"><input type="range" min="1" max="5" step="0.5" v-model.number="store.companionModePauseThreshold" class="set-range" /><span class="set-range-val">{{ store.companionModePauseThreshold }}s</span></div></div>
        <div class="set-row"><span>断句触发</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeSentenceTrigger" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-row"><span>字数触发阈值</span><div class="set-range-wrap"><input type="range" min="5" max="50" step="5" v-model.number="store.companionModeCharThreshold" class="set-range" /><span class="set-range-val">{{ store.companionModeCharThreshold }}字</span></div></div>
        </template>
        <template v-else-if="idx === 2">
        <div class="sc-head">人格设置</div>
        <div class="set-row"><span>人格过渡动画</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModePersonaTransition" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-row"><span>跨插件人格附体</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeCrossPlugin" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-hint">编辑非生命体实体时，AI 可能以角色/种族/势力的人格说话</div>
        <div v-if="store.companionModeCrossPlugin" class="set-row set-row-sub"><span>人格切换概率</span><div class="set-range-wrap"><input type="range" min="0" max="100" step="5" v-model.number="store.companionModePersonaSwitchChance" class="set-range" /><span class="set-range-val">{{ store.companionModePersonaSwitchChance }}%</span></div></div>
        </template>
        <template v-else-if="idx === 3">
        <div class="sc-head">概率体系</div>
        <div class="set-row"><span>全局运气</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeLuckEnabled" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-hint">启用后，AI 会经历"活跃期"和"沉默期"，表现更自然</div>
        <template v-if="store.companionModeLuckEnabled">
          <div class="set-row set-row-sub"><span>运气重置周期（分钟）</span><div class="set-range-wrap"><input type="range" min="3" max="15" step="1" v-model.number="store.companionModeLuckResetMinutes" class="set-range" /><span class="set-range-val">{{ store.companionModeLuckResetMinutes }}分</span></div></div>
          <div class="set-row set-row-sub"><span>运气重置操作数</span><div class="set-range-wrap"><input type="range" min="5" max="30" step="1" v-model.number="store.companionModeLuckResetOps" class="set-range" /><span class="set-range-val">{{ store.companionModeLuckResetOps }}次</span></div></div>
        </template>
        </template>
        <template v-else-if="idx === 4">
        <div class="sc-head">场景概率</div>
        <div class="set-hint" style="margin-bottom:8px">每种操作场景的独立触发概率</div>
        <div v-for="sp in sceneProbItems" :key="sp.id" class="set-row">
          <span>{{ sp.label }}</span>
          <div class="set-range-wrap"><input type="range" min="0" max="100" step="5" :value="store.companionModeSceneProbs[sp.id] ?? sp.defaultVal" @input="onSceneProbChange(sp.id, $event)" class="set-range" /><span class="set-range-val">{{ store.companionModeSceneProbs[sp.id] ?? sp.defaultVal }}%</span></div>
        </div>
        </template>
        <template v-else-if="idx === 5">
        <div class="sc-head">弹窗交互</div>
        <div class="set-row"><span>弹窗位置场景化</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModePositionContext" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-hint">根据操作场景自动调整弹窗出现位置</div>
        <div class="set-row"><span>点击停驻</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeClickPin" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-hint">点击弹窗可停驻并查看历史消息</div>
        </template>
        <template v-else>
        <div class="sc-head">模型配置</div>
        <div class="set-row"><span>使用独立模型</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeCustomModel" /><span class="set-toggle-slider"></span></label></div>
        <div class="set-hint">关闭时跟随主模型配置；开启后从已配置的供应商中选择</div>
        <template v-if="store.companionModeCustomModel">
          <div class="set-row set-row-sub"><span>供应商</span>
            <select v-model="store.companionModeProviderKey" class="set-select">
              <option value="" disabled>选择供应商</option>
              <option v-for="p in companionProviderList" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select>
          </div>
          <template v-if="store.companionModeProviderKey">
            <div class="set-row set-row-sub"><span>模型</span>
              <div class="cp-model-field">
                <select v-if="companionCurrentModels.length > 0" v-model="store.companionModeModelId" class="set-select">
                  <option value="" disabled>选择模型</option>
                  <option v-for="m in companionCurrentModels" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
                <input v-else type="text" v-model="store.companionModeModelId" class="set-input" placeholder="输入模型 ID" />
                <button v-if="companionCanFetch" class="cp-fetch-btn" @click="fetchCompanionModels" :disabled="companionFetching" :title="companionFetchErr || '拉取模型列表'">
                  <WsIcon :name="companionFetching ? 'loading' : 'refresh'" size="xs" />
                </button>
              </div>
            </div>
            <div v-if="companionFetchErr" class="set-hint" style="color:var(--text-error)">{{ companionFetchErr }}</div>
          </template>
        </template>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '@worldsea/entity-core'
import { getModelsByProvider, getDefaultModelId, MODEL_REGISTRY, getProviderLabelMap } from '@worldsea/agent-runtime'
import { CardDeck } from '@worldsea/ui-kit'
import WsIcon from '../../WsIcon.vue'
import { matchKeywords, SCENE_PROB_ITEMS, type CompanionProviderEntry } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const store = useSettingsStore()

const sceneProbItems = SCENE_PROB_ITEMS

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

// ── 叠放翻卡（CardDeck）实例：左列标题点击 → 翻到对应分节卡 ──
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)

defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

function onSceneProbChange(sceneId: string, event: Event) {
  const val = Number((event.target as HTMLInputElement).value)
  store.companionModeSceneProbs = { ...store.companionModeSceneProbs, [sceneId]: val }
  emit('dirty')
}

// ── 陪伴模式模型列表 ──
const CLOUD_PROVIDER_LABELS: Record<string, string> = getProviderLabelMap()

const companionProviderList = computed<CompanionProviderEntry[]>(() => {
  const list: CompanionProviderEntry[] = []
  // 云端供应商：从 modelRegistry 中已有模型的供应商自动列出
  const allProviders = new Set<string>()
  for (const m of MODEL_REGISTRY) allProviders.add(m.provider)
  for (const provider of allProviders) {
    const label = CLOUD_PROVIDER_LABELS[provider] || provider
    list.push({ key: `cloud:${provider}`, label: `${label}（云端）`, type: 'cloud' })
  }
  // 本地模型：如果主配置中本地端点有模型
  if (store.aiLocalModel) {
    list.push({ key: 'local:default', label: `${store.aiLocalType.toUpperCase()}（本地）`, type: 'local' })
  }
  // 自定义供应商
  for (const cp of store.customProviders) {
    list.push({ key: `custom:${cp.id}`, label: `${cp.name || cp.baseUrl}（自定义）`, type: 'custom' })
  }
  return list
})

const companionProviderType = computed<'cloud' | 'local' | 'custom' | ''>(() => {
  const key = store.companionModeProviderKey
  if (!key) return ''
  const [mode] = key.split(':')
  return mode as 'cloud' | 'local' | 'custom'
})

// 云端：直接从 modelRegistry 获取模型列表
const companionCloudModelsFromRegistry = computed(() => {
  if (companionProviderType.value !== 'cloud') return []
  const provider = store.companionModeProviderKey.split(':').slice(1).join(':')
  return getModelsByProvider(provider)
})

// 本地/自定义：拉取的模型列表
const companionFetchedModels = ref<{ id: string; name: string }[]>([])
const companionFetching = ref(false)
const companionFetchErr = ref('')

const companionCanFetch = computed(() => {
  const type = companionProviderType.value
  if (type === 'local') return !!store.aiLocalEndpoint
  if (type === 'custom') {
    const cpId = store.companionModeProviderKey.split(':').slice(1).join(':')
    const cp = store.customProviders.find(p => p.id === cpId)
    return !!cp?.baseUrl
  }
  return false
})

const companionCurrentModels = computed(() => {
  if (companionProviderType.value === 'cloud') {
    return companionCloudModelsFromRegistry.value
  }
  return companionFetchedModels.value
})

async function fetchCompanionModels() {
  const type = companionProviderType.value
  if (type === 'cloud') return // 云端不需要拉取，直接从 registry 获取

  companionFetching.value = true
  companionFetchErr.value = ''
  companionFetchedModels.value = []

  try {
    if (type === 'local') {
      const endpoint = store.aiLocalEndpoint.replace(/\/+$/, '')
      const url = endpoint.includes('/api/') ? `${endpoint}/tags` : `${endpoint}/api/tags`
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) { companionFetchErr.value = `拉取失败: HTTP ${res.status}`; return }
      const data = await res.json()
      const models: { id: string; name: string }[] = (data.models || [])
        .map((m: any) => ({ id: m.name || m.model, name: m.name || m.model }))
        .filter((m: any) => typeof m.id === 'string')
        .sort((a: any, b: any) => a.id.localeCompare(b.id))
      if (models.length === 0) { companionFetchErr.value = '未发现可用模型'; return }
      companionFetchedModels.value = models
    } else if (type === 'custom') {
      const cpId = store.companionModeProviderKey.split(':').slice(1).join(':')
      const cp = store.customProviders.find(p => p.id === cpId)
      if (!cp) { companionFetchErr.value = '供应商未找到'; return }
      const baseUrl = cp.baseUrl.replace(/\/+$/, '')
      const isRemote = /^https?:\/\//.test(baseUrl)
      let modelsUrl: string
      const headers: Record<string, string> = {}
      if (isRemote) {
        try {
          const url = new URL(baseUrl)
          headers['X-Target-Base-Url'] = `${url.protocol}//${url.host}`
          let basePath = url.pathname.replace(/\/+$/, '')
          if (!basePath) basePath = '/v1'
          modelsUrl = `/api/custom-proxy${basePath}/models`
        } catch { companionFetchErr.value = '无效的 Base URL'; return }
      } else {
        modelsUrl = baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
      }
      const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(15000) })
      if (!res.ok) { companionFetchErr.value = `拉取失败: HTTP ${res.status}`; return }
      const data = await res.json()
      const models: { id: string; name: string }[] = (data.data || [])
        .map((m: any) => ({ id: m.id, name: m.id }))
        .filter((m: any) => typeof m.id === 'string')
        .sort((a: any, b: any) => a.id.localeCompare(b.id))
      if (models.length === 0) { companionFetchErr.value = '未发现可用模型'; return }
      companionFetchedModels.value = models
    }
  } catch (e: any) {
    companionFetchErr.value = e.name === 'TimeoutError' ? '拉取超时' : `拉取失败: ${e.message || e}`
  } finally {
    companionFetching.value = false
  }
}

// 切换供应商时重置模型列表和已拉取数据
watch(() => store.companionModeProviderKey, () => {
  companionFetchedModels.value = []
  companionFetchErr.value = ''
  // 云端自动设置默认模型
  if (companionProviderType.value === 'cloud') {
    const provider = store.companionModeProviderKey.split(':').slice(1).join(':')
    const defaultId = getDefaultModelId(provider)
    if (defaultId) store.companionModeModelId = defaultId
  } else {
    store.companionModeModelId = ''
  }
})
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */
.set-row-sub { padding-left: 16px; }

.set-input { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); }
.set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-range-wrap { display: flex; align-items: center; gap: 8px; }
.set-range { width: 100px; accent-color: var(--primary, var(--color-primary)); }
.set-range-val { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 28px; text-align: right; font-family: monospace; }

.cp-model-field { display: flex; align-items: center; gap: 4px; flex: 1; }
.cp-model-field .set-select,
.cp-model-field .set-input { flex: 1; min-width: 0; }
.cp-fetch-btn { background: none; border: 1px solid var(--border-color, #444); border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer; padding: 4px 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: border-color 0.15s, color 0.15s; }
.cp-fetch-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.cp-fetch-btn:disabled { opacity: 0.35; cursor: not-allowed; }
</style>

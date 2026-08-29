<template>
  <div class="model-switcher" :class="{ expanded: isExpanded }" ref="switcherRef">
    <!-- [③] 入口去胶囊：扁平无边框，hover 浅底 + 主色 -->
    <button
      class="model-pill"
      aria-haspopup="listbox"
      :aria-expanded="open"
      aria-controls="model-listbox"
      :aria-label="`当前模型：${shortName}，切换模型`"
      @mousedown.prevent
      @click.stop="toggleDropdown()"
      @keydown.down.prevent="onTriggerKeydown"
      @keydown.up.prevent="onTriggerKeydown"
      @keydown.enter.prevent="toggleDropdown()"
      @keydown.space.prevent="toggleDropdown()"
      @keydown.esc.prevent="closeDropdown()"
    >
      <img v-if="providerIconUrl" :src="providerIconUrl" class="model-pill-icon" alt="" />
      <span v-else class="model-pill-provider">{{ providerLabel }}</span>
      <span class="model-pill-name">{{ shortName }}</span>
      <WsIcon name="chevron-down" size="xs" class="model-pill-arrow" :class="{ open }" />
    </button>
    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="open" class="model-dropdown-backdrop" @click="open = false"></div>
      </Transition>
      <Transition name="dropdown">
        <div
          v-if="open"
          id="model-listbox"
          class="model-dropdown"
          role="listbox"
          aria-label="模型列表"
          :style="dropdownStyle"
          @keydown="onListboxKeydown"
        >
          <div class="dropdown-header">切换模型
            <!-- D3 全局刷新模型列表入口：对已配置 key 且支持 listing 的供应商后台刷新后重建列表 -->
            <button class="model-refresh-btn" type="button" :disabled="refreshingModels" :title="'刷新模型列表'" @click.stop="onRefreshModelList">
              <WsIcon :name="refreshingModels ? 'loading' : 'refresh'" size="xs" />
            </button>
          </div>
          <!-- [⑦] AutoModel 条目：WorldSmith Logo 图标（自动选型逻辑暂放，占位） -->
          <button
            class="model-option"
            :class="{ active: currentModelId === 'auto' }"
            @click="selectAutoModel"
          >
            <span class="model-option-status" aria-hidden="true"><WsIcon v-if="currentModelId === 'auto'" name="check" size="xs" /></span>
            <WorldSmithLogo :size="16" class="model-option-icon" alt="WorldSmith" />
            <span class="model-option-name">AutoModel</span>
            <span class="model-option-tag">自动</span>
          </button>
          <!-- [②] 去掉供应商分组标题，仅保留模型（仍按供应商排列，组间细分隔线） -->
          <div v-for="group in dropdownGroups" :key="group.group" class="model-group">
            <button
              v-for="m in group.models"
              :key="m.id"
              class="model-option"
              :class="{ active: m.id === currentModelId }"
              role="option"
              :aria-selected="m.id === currentModelId"
              :aria-label="`${m.name}（${group.group}）`"
              :ref="(el) => collectOptionEl(el as HTMLElement | null, m.id)"
              @click="selectModel(m.provider, m.id)"
              @focus="activeOptionId = m.id"
            >
              <span class="model-option-status" aria-hidden="true"><WsIcon v-if="m.id === currentModelId" name="check" size="xs" /></span>
              <!-- [⑤] 供应商 Logo 图标 -->
              <img :src="getProviderIconUrl(m.provider)" class="model-option-icon" alt="" />
              <span class="model-option-name">{{ m.name }}</span>
              <!-- [⑥] 思考档位悬停触发（仅支持思考的模型；原入口按钮移除） -->
              <span
                v-if="modelSupportsThinking(m.id)"
                class="think-hint"
                :class="{ active: thinkTarget?.id === m.id }"
                title="思考档位"
                @mouseenter.stop="onThinkEnter(m, $event)"
                @mouseleave.stop="onThinkLeave"
                @click.stop
              ><WsIcon name="brain" size="xs" /></span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- [⑥] 思考档位悬停浮窗（按模型自身档位） -->
    <Teleport to="body">
      <Transition name="dropdown">
        <div
          v-if="thinkTarget"
          class="think-pop"
          :style="thinkStyle"
          @mouseenter="onThinkEnter(thinkTarget, $event)"
          @mouseleave="onThinkLeave"
          @click.stop
        >
          <div class="think-header">{{ thinkTarget.name }} · 思考档位</div>
          <div class="think-levels">
            <button
              v-for="lvl in thinkLevels"
              :key="lvl.value"
              class="think-level"
              :class="{ on: isThinkActive(lvl.value) }"
              type="button"
              @click="selectThinkLevel(lvl.value)"
            >
              <span class="think-level-label">{{ lvl.label }}</span>
              <span class="think-level-desc">{{ lvl.desc }}</span>
              <WsIcon v-if="isThinkActive(lvl.value)" name="check" size="xs" class="think-level-check" />
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { getModelInfo, getModelPresets, getProviderManifest, refreshModels, getThinkingLevels } from '@worldsmith/agent-runtime'
import type { ThinkingLevel } from '@worldsmith/agent-runtime'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgent } from '@/agent/composables/useAgent'
import { useSessionViewState } from '@/agent/composables/useSessionViewState'
import { loadApiKey, hasApiKey } from '@agent/index'
import { getProviderIconUrl } from '@/assets/providerIcons'
import WorldSmithLogo from '@/components/brand/WorldSmithLogo.vue'

const props = withDefaults(defineProps<{
  isExpanded?: boolean
}>(), {
  isExpanded: false,
})

const emit = defineEmits<{
  change: [provider: string, modelId: string]
}>()

const settingsStore = useSettingsStore()
const { updateModel, thinkingLevel, updateThinkingLevel } = useAgent()
const sessionView = useSessionViewState()

const open = ref(false)
const switcherRef = ref<HTMLElement>()
const activeOptionId = ref('')
const optionEls = new Map<string, HTMLElement>()
// 全局刷新模型的 loading 状态（刷新按钮展示）
const refreshingModels = ref(false)

/** [E3] 会话级模型优先；缺省回退全局 settingsStore（新会话用全局默认） */
const sessionModel = computed(() => sessionView.activeState.value?.model ?? null)

const providerLabel = computed(() => {
  const labels: Record<string, string> = {
    anthropic: 'An', openai: 'OAI', google: 'GM', deepseek: 'DS',
    groq: 'GQ', zhipu: 'ZP', qwen: 'QW', minimax: 'MX', kimi: 'KM', agnes: 'AG',
  }
  const provider = settingsStore.aiProviderMode === 'cloud' ? settingsStore.aiCloudProvider : settingsStore.aiCustomType
  return labels[provider] || provider.slice(0, 2).toUpperCase()
})

const providerIconUrl = computed(() => {
  const provider = settingsStore.aiProviderMode === 'cloud' ? settingsStore.aiCloudProvider : ''
  return provider ? getProviderIconUrl(provider) : ''
})

const currentModelId = computed(() => {
  const sm = sessionModel.value
  if (sm?.modelId) return sm.modelId
  if (settingsStore.aiProviderMode === 'cloud') return settingsStore.aiCloudModel
  if (settingsStore.aiProviderMode === 'local') return settingsStore.aiLocalModel
  return settingsStore.aiCustomModel
})

const shortName = computed(() => {
  const id = currentModelId.value
  const info = getModelInfo(id)
  if (info) {
    const n = info.name
    return n.length > 16 ? n.slice(0, 14) + '…' : n
  }
  return id.length > 20 ? id.slice(0, 18) + '…' : id
})

const dropdownStyle = ref<Record<string, string>>({ top: '0px', left: '0px' })
const dropdownGroups = ref<{ group: string; models: { id: string; name: string; provider: string }[] }[]>([])

async function updateDropdownPosition() {
  if (!switcherRef.value) return
  const rect = switcherRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    bottom: `${window.innerHeight - rect.top + 6}px`,
    left: `${Math.max(8, rect.left + rect.width / 2 - 100)}px`,
  }
  const allGroups = getModelPresets()
  const filtered: typeof allGroups = []
  for (const group of allGroups) {
    const providerKey = group.models[0]?.provider
    if (providerKey && await hasApiKey(providerKey)) {
      filtered.push(group)
    }
  }
  dropdownGroups.value = filtered
}

/** 拍平所有选项（按分组顺序），供键盘导航使用 */
const allOptions = computed(() => {
  const list: { provider: string; id: string }[] = []
  for (const group of dropdownGroups.value) {
    for (const m of group.models) list.push({ provider: m.provider, id: m.id })
  }
  return list
})

function collectOptionEl(el: HTMLElement | null, id: string) {
  if (el) optionEls.set(id, el)
}

async function toggleDropdown() {
  open.value = !open.value
  if (open.value) {
    await updateDropdownPosition()
    // 打开时默认聚焦当前模型，若无则聚焦第一项
    activeOptionId.value = currentModelId.value
    nextTick(() => {
      const target = optionEls.get(activeOptionId.value) ?? optionEls.get(allOptions.value[0]?.id ?? '')
      target?.focus()
    })
  }
}

function closeDropdown() {
  open.value = false
}

function focusOptionById(id: string) {
  activeOptionId.value = id
  const el = optionEls.get(id)
  el?.focus()
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (!open.value) {
    toggleDropdown()
    return
  }
  // 打开状态下的方向键：从当前/首项开始移动
  const cur = activeOptionId.value || currentModelId.value
  const idx = allOptions.value.findIndex(o => o.id === cur)
  const count = allOptions.value.length
  if (count === 0) return
  const nextIdx = e.key === 'ArrowDown' ? Math.min(count - 1, (idx < 0 ? -1 : idx) + 1) : Math.max(0, (idx < 0 ? 0 : idx) - 1)
  focusOptionById(allOptions.value[nextIdx].id)
}

function onListboxKeydown(e: KeyboardEvent) {
  const count = allOptions.value.length
  if (count === 0) return
  let idx = allOptions.value.findIndex(o => o.id === activeOptionId.value)
  if (idx < 0) idx = allOptions.value.findIndex(o => o.id === currentModelId.value)
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      focusOptionById(allOptions.value[Math.min(count - 1, (idx < 0 ? -1 : idx) + 1)].id)
      break
    case 'ArrowUp':
      e.preventDefault()
      focusOptionById(allOptions.value[Math.max(0, (idx < 0 ? 0 : idx) - 1)].id)
      break
    case 'Home':
      e.preventDefault()
      focusOptionById(allOptions.value[0].id)
      break
    case 'End':
      e.preventDefault()
      focusOptionById(allOptions.value[count - 1].id)
      break
    case 'Enter':
    case ' ':
      // 选项本身是 button，Enter/Space 默认触发 click；这里无需重复处理
      break
    case 'Escape':
      e.preventDefault()
      closeDropdown()
      switcherRef.value?.focus()
      break
  }
}

async function selectModel(provider: string, modelId: string) {
  open.value = false
  thinkTarget.value = null
  if (modelId === currentModelId.value) return

  const info = getModelInfo(modelId)
  const contextWindow = info?.contextLength || 128000
  const maxOut = info?.maxOutputTokens || 8192

  if (settingsStore.aiProviderMode === 'cloud') {
    settingsStore.aiCloudProvider = provider as any
    settingsStore.aiCloudModel = modelId
  } else if (settingsStore.aiProviderMode === 'local') {
    settingsStore.aiLocalModel = modelId
  } else {
    settingsStore.aiCustomModel = modelId
  }

  const apiKey = await loadApiKey(provider)
  // Rust updateModel 签名：(provider, modelId, baseUrl?, apiKey?, contextWindow?, maxTokens?, temperature?)
  await updateModel(provider, modelId, undefined, apiKey || undefined, contextWindow, maxOut)
  try {
    localStorage.setItem('agent_current_model', JSON.stringify({ provider, modelId, contextLength: contextWindow }))
  } catch {}
  // [E3] 会话级记忆：当前会话记住该模型（切换会话恢复）
  sessionView.setModel({ provider, modelId })
  // [④] 切换模型后校验思考档位：新模型不支持当前档位则重置到可用档（如 glm-5.3 思考恒开，无 off）
  syncThinkingLevelToModel(modelId)
  emit('change', provider, modelId)
}

/** [④] 校验并同步思考档位到目标模型（档位集 = getThinkingLevels(modelId)） */
async function syncThinkingLevelToModel(modelId: string): Promise<void> {
  const valid = getThinkingLevels(modelId)
  const cur = thinkingLevel.value as string
  if (valid.some(l => l.value === cur)) return
  const fallback = valid.find(l => l.value === 'off') ?? valid[0]
  if (!fallback) return
  try {
    await updateThinkingLevel(fallback.value as ThinkingLevel)
    thinkingLevel.value = fallback.value as ThinkingLevel
    localStorage.setItem('agent_thinking_level', fallback.value)
  } catch { /* 降级：仅本地态更新失败不影响模型切换 */ }
}

/** [⑦] AutoModel 占位：暂不真正切换（显示选项 + 标记，TODO 自动选型逻辑下轮实现） */
async function selectAutoModel() {
  open.value = false
  if (currentModelId.value === 'auto') return
  console.warn('[ModelSwitcher] AutoModel 暂未实现（占位）')
  emit('change', '', 'auto')
}

/**
 * D3 全局刷新模型列表：对模型预设中所有已配置 key 且支持模型列表的供应商
 * 后台 refreshModels（写缓存），完成后重建下拉分组（fire-and-forget，只刷新当前已配置的）
 */
async function onRefreshModelList(): Promise<void> {
  if (refreshingModels.value) return
  refreshingModels.value = true
  try {
    const providers = Array.from(new Set(
      getModelPresets().map(g => g.models[0]?.provider).filter(Boolean),
    )) as string[]
    await Promise.all(providers.map(async (provider) => {
      try {
        const manifest = getProviderManifest(provider)
        if (!manifest || manifest.supportsModelListing === false) return
        const key = await loadApiKey(provider)
        if (!key) return // 未配置 key 的供应商跳过
        await refreshModels(provider, key)
      } catch { /* 单个供应商失败不影响其它 */ }
    }))
    // 刷新完成后重建下拉分组（读取新缓存 + key 过滤）
    await updateDropdownPosition()
  } finally {
    refreshingModels.value = false
  }
}

// ── [④⑥] 思考档位悬停浮窗 ─────────────────────────────────────────
interface ThinkTarget { id: string; name: string; provider: string }
const thinkTarget = ref<ThinkTarget | null>(null)
const thinkStyle = ref<Record<string, string>>({ top: '0px', right: '8px' })
let thinkTimer: ReturnType<typeof setTimeout> | null = null

/** 模型是否支持思考（决定是否渲染悬停触发点） */
function modelSupportsThinking(id: string): boolean {
  return !!getModelInfo(id)?.supportsThinking
}

function onThinkEnter(m: ThinkTarget, ev: MouseEvent) {
  if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null }
  thinkTarget.value = m
  // 浮窗定位：跟随触发点下方右侧
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  thinkStyle.value = {
    top: `${Math.min(rect.bottom + 4, window.innerHeight - 120)}px`,
    right: `${Math.max(8, window.innerWidth - rect.right + 4)}px`,
  }
}

function onThinkLeave() {
  // 防抖关闭：允许鼠标移入浮窗（浮窗 mouseenter 会取消定时器）
  if (thinkTimer) clearTimeout(thinkTimer)
  thinkTimer = setTimeout(() => { thinkTarget.value = null }, 120)
}

/** 当前悬停模型的可用档位 */
const thinkLevels = computed(() => thinkTarget.value ? getThinkingLevels(thinkTarget.value.id) : [])

/** 当前档位是否生效（仅当悬停模型就是当前模型时高亮） */
function isThinkActive(level: string): boolean {
  return !!thinkTarget.value
    && thinkTarget.value.id === currentModelId.value
    && thinkingLevel.value === level
}

/** 选择档位：悬停模型非当前模型时先切换，再应用档位 */
async function selectThinkLevel(level: string) {
  const t = thinkTarget.value
  if (!t) return
  if (t.id !== currentModelId.value) {
    await selectModel(t.provider, t.id)
  }
  try {
    await updateThinkingLevel(level as ThinkingLevel)
    thinkingLevel.value = level as ThinkingLevel
    localStorage.setItem('agent_thinking_level', level)
  } catch (err) {
    console.warn('[ModelSwitcher] 设置思考档位失败:', err)
  }
  thinkTarget.value = null
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const target = e.target as HTMLElement
  if (switcherRef.value && !switcherRef.value.contains(target) && !target.closest('.model-dropdown')) {
    open.value = false
  }
}

/** I1 修复：全局 Escape 关闭（原仅触发器/列表框聚焦时生效，焦点在输入框时无响应） */
function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false
    thinkTarget.value = null
  }
}

onMounted(() => {
  // capture 阶段监听：抢在 useShortcuts（document 冒泡，命中即 stopImmediatePropagation）之前消费 Esc
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKeydown, true)
  if (thinkTimer) clearTimeout(thinkTimer)
})
</script>

<style scoped>
.model-switcher {
  flex-shrink: 0;
  position: relative;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* [③] 入口去胶囊：扁平无边框，hover 浅底 + 主色字 */
.model-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, color 0.2s;
  height: 28px;
}

.model-pill:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.model-pill-provider {
  font-weight: 600;
  color: var(--color-primary);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.02em;
}

.model-pill-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex-shrink: 0;
}

.model-pill-name {
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-pill-arrow {
  font-size: var(--fs-3xs);
  opacity: 0.5;
  margin-left: 2px;
  transition: transform 0.2s;
}
.model-pill-arrow.open {
  transform: rotate(180deg);
}

.model-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

/* [①] 下拉高度降至原 60%：70vh × 0.6 ≈ 42vh */
.model-dropdown {
  position: fixed;
  min-width: 200px;
  max-height: 42vh;
  overflow-y: auto;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 6px;
  z-index: 10001;
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 4px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 4px;
}

.model-refresh-btn {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  padding: 2px 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.model-refresh-btn:hover:not(:disabled) {
  color: var(--color-primary);
  background: var(--color-surface);
}
.model-refresh-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* [②] 分组无标题，组间细分割线（首个分组无上边线） */
.model-group + .model-group {
  border-top: 1px solid var(--color-border);
  margin-top: 4px;
  padding-top: 2px;
}

.model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}

.model-option:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.model-option.active {
  background: var(--color-primary-muted);
  color: var(--color-text);
}

.model-option-status {
  width: 14px;
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  flex-shrink: 0;
}

/* [⑤] 供应商 Logo 图标（模型名左侧） */
.model-option-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex-shrink: 0;
}

.model-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* [⑦] AutoModel 占位标签 */
.model-option-tag {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0 6px;
}

/* [⑥] 思考档位悬停触发点（原入口按钮移除） */
.think-hint {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  opacity: 0.55;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}
.think-hint:hover,
.think-hint.active {
  opacity: 1;
  color: var(--color-primary);
  background: var(--color-surface);
}

/* 思考档位浮窗 */
.think-pop {
  position: fixed;
  min-width: 220px;
  max-height: 40vh;
  overflow-y: auto;
  background: var(--color-surface-elevated);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 8px;
  z-index: 10002;
}
.think-header {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 6px;
  padding: 0 2px 4px;
  border-bottom: 1px solid var(--color-border);
}
.think-levels {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.think-level {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  color: var(--color-text-secondary);
  transition: background 0.12s;
}
.think-level:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.think-level.on {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.think-level-label {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-width: 32px;
}
.think-level-desc {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
}
.think-level.on .think-level-desc {
  color: var(--color-text-secondary);
}
.think-level-check {
  flex-shrink: 0;
}

.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
</style>

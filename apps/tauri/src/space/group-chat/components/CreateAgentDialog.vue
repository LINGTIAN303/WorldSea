<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @click.self="$emit('close')"></div>
    <div class="dialog-wrapper" :style="wrapperStyle">
      <div class="create-agent-dialog">
      <div class="dialog-title">{{ isEdit ? '编辑 Agent' : '创建 Agent' }}</div>

      <div class="avatar-section">
        <div class="avatar-wrap">
          <AvatarBadge class="avatar-circle" :avatar="agentAvatar" :name="agentName" :color="selectedColor" :size="48" />
          <div class="avatar-actions">
            <button class="avatar-action-btn" @click="avatarInputRef?.click()" title="上传头像"><WsIcon name="image" size="xs" /></button>
            <button v-if="isImageAvatar(agentAvatar)" class="avatar-action-btn" @click="onClearAvatar" title="清除头像"><WsIcon name="x" size="xs" /></button>
          </div>
          <input ref="avatarInputRef" type="file" accept="image/*" class="avatar-file-input" @change="onAvatarFileChange" />
        </div>
        <div class="avatar-fields">
          <input class="name-input" v-model="agentName" placeholder="Agent 名字" />
          <input class="role-input" v-model="agentRole" placeholder="角色标签（如：剑客、军师）" />
        </div>
      </div>

      <div class="color-section">
        <div class="section-label">颜色</div>
        <div class="color-options">
          <div
            v-for="c in AGENT_COLORS"
            :key="c"
            class="color-dot"
            :class="{ active: selectedColor === c }"
            :style="{ background: c }"
            role="radio"
            tabindex="0"
            :aria-checked="selectedColor === c"
            :aria-label="`选择颜色 ${c}`"
            @click="selectedColor = c"
            @keydown.enter.prevent="selectedColor = c"
            @keydown.space.prevent="selectedColor = c"
          ></div>
        </div>
      </div>

      <div class="source-section">
        <div class="section-label">人格来源</div>
        <div class="source-options">
          <div class="source-option" :class="{ active: sourceType === 'entity' }" role="radio" tabindex="0" :aria-checked="sourceType === 'entity'" @click="sourceType = 'entity'" @keydown.enter.prevent="sourceType = 'entity'" @keydown.space.prevent="sourceType = 'entity'">
            <span class="source-icon"><WsIcon name="landmark" size="xs" /></span>
            <span class="source-label">从实体选择</span>
          </div>
          <div class="source-option" :class="{ active: sourceType === 'custom' }" role="radio" tabindex="0" :aria-checked="sourceType === 'custom'" @click="sourceType = 'custom'" @keydown.enter.prevent="sourceType = 'custom'" @keydown.space.prevent="sourceType = 'custom'">
            <span class="source-icon"><WsIcon name="pencil" size="xs" /></span>
            <span class="source-label">手动创建</span>
          </div>
        </div>
      </div>

      <div v-if="sourceType === 'entity'" class="entity-section">
        <input class="entity-search" v-model="entitySearch" placeholder="搜索实体..." />
        <div class="entity-list">
          <div
            v-for="entity in filteredEntities"
            :key="entity.id"
            class="entity-item"
            :class="{ selected: selectedEntityId === entity.id }"
            role="button"
            tabindex="0"
            :aria-pressed="selectedEntityId === entity.id"
            @click="onSelectEntity(entity)"
            @keydown.enter.prevent="onSelectEntity(entity)"
            @keydown.space.prevent="onSelectEntity(entity)"
          >
            <div class="entity-avatar">{{ entity.name[0] }}</div>
            <div class="entity-info">
              <span class="entity-name">{{ entity.name }}</span>
              <span class="entity-type">{{ getEntityTypeLabel(entity.type) }}</span>
            </div>
            <span v-if="selectedEntityId === entity.id" class="entity-check">✓</span>
          </div>
          <div v-if="filteredEntities.length === 0" class="entity-empty">无匹配实体</div>
        </div>
      </div>

      <div class="prompt-section">
        <div class="section-label">系统提示词</div>
        <textarea class="prompt-input" v-model="systemPrompt" placeholder="描述这个 Agent 的人格、说话风格、知识背景..." rows="5"></textarea>
      </div>

      <div class="baselayer-section">
        <div class="section-label">基础层</div>
        <div class="baselayer-desc">决定 Agent 的知识基础和工具能力</div>
        <div class="baselayer-options">
          <div class="baselayer-option" :class="{ active: baseLayerMode === 'empty' }" role="radio" tabindex="0" :aria-checked="baseLayerMode === 'empty'" @click="baseLayerMode = 'empty'" @keydown.enter.prevent="baseLayerMode = 'empty'" @keydown.space.prevent="baseLayerMode = 'empty'">
            <span class="baselayer-option-title">空</span>
            <span class="baselayer-option-desc">纯聊天 NPC，不使用任何工具</span>
          </div>
          <div class="baselayer-option" :class="{ active: baseLayerMode === 'shared' }" role="radio" tabindex="0" :aria-checked="baseLayerMode === 'shared'" @click="baseLayerMode = 'shared'" @keydown.enter.prevent="baseLayerMode = 'shared'" @keydown.space.prevent="baseLayerMode = 'shared'">
            <span class="baselayer-option-title">共享</span>
            <span class="baselayer-option-desc">标准基础层 + 全部工具能力</span>
          </div>
          <div class="baselayer-option" :class="{ active: baseLayerMode === 'custom' }" role="radio" tabindex="0" :aria-checked="baseLayerMode === 'custom'" @click="baseLayerMode = 'custom'" @keydown.enter.prevent="baseLayerMode = 'custom'" @keydown.space.prevent="baseLayerMode = 'custom'">
            <span class="baselayer-option-title">自定义</span>
            <span class="baselayer-option-desc">手动配置基础层和工具</span>
          </div>
        </div>
        <textarea
          v-if="baseLayerMode === 'custom'"
          class="baselayer-input"
          v-model="customBaseLayer"
          placeholder="输入自定义基础层内容（如工具使用规则、输出格式要求、项目知识等）"
          rows="5"
        ></textarea>
      </div>

      <!-- 能力配置卡片：仅自定义基础层时显示 -->
      <div v-if="baseLayerMode === 'custom'" class="capability-section">
        <div class="capability-card" :class="{ 'panel-open': showCapabilityDrawer }" @click="openCapabilityDrawer">
          <div class="capability-card-header">
            <WsIcon name="zap" size="xs" class="capability-icon" />
            <span class="capability-title">能力配置</span>
            <WsIcon name="chevron-right" size="xs" class="capability-arrow" />
          </div>
          <div class="capability-summary">
            <template v-if="enabledSkills.length > 0">
              <span class="capability-skills">
                {{ enabledSkills.length }} 个技能
              </span>
              <span class="capability-divider">·</span>
              <span class="capability-tools">
                {{ skillDerivedToolNames.length }} 个工具
              </span>
              <span v-if="toolSource === 'manual'" class="capability-manual-badge">已自定义</span>
            </template>
            <template v-else>
              <span class="capability-empty">未配置技能，点击选择</span>
            </template>
          </div>
          <div v-if="enabledSkills.length > 0" class="capability-skill-tags">
            <span v-for="sid in enabledSkills.slice(0, 5)" :key="sid" class="capability-skill-tag">
              {{ getSkillName(sid) }}
            </span>
            <span v-if="enabledSkills.length > 5" class="capability-skill-more">
              +{{ enabledSkills.length - 5 }}
            </span>
          </div>
        </div>
      </div>

      <div class="model-section">
        <div class="section-label">模型</div>
        <div class="model-picker" ref="modelPickerAnchor">
          <div class="picker-trigger" @click="toggleModelPicker">
            <img v-if="selectedProvider && getProviderIconUrl(selectedProvider)" class="picker-icon" :src="getProviderIconUrl(selectedProvider)" alt="" />
            <span class="picker-value" v-if="modelId">{{ getModelName(modelId) }}</span>
            <span class="picker-placeholder" v-else>默认模型</span>
            <WsIcon name="chevron-down" size="xs" />
          </div>
        </div>
      </div>

      <div class="provider-section">
        <div class="section-label">Provider 来源</div>
        <select class="provider-select" v-model="providerSource">
          <option value="default">默认（跟随全局配置）</option>
          <option v-for="slot in availableSlots" :key="slot.id" :value="`slot:${slot.id}`">
            {{ slot.name }}（{{ slot.entries.length }} 个条目）
          </option>
        </select>
        <div v-if="availableSlots.length === 0" class="provider-hint">
          在群信息面板的 Provider 池中管理配置
        </div>
      </div>

      <div class="font-section">
        <div class="section-label">输出字体</div>
        <select class="provider-select" v-model="fontFamily" @change="onAgentFontFamilyChange">
          <option value="">跟随全局 Agent 字体</option>
          <option v-for="e in fontLibraryEntries" :key="e.id" :value="e.family">{{ e.displayName }}</option>
        </select>
        <div v-if="fontFamily && agentFontVariants.length > 1" class="font-variant-row">
          <select class="provider-select provider-select--sm" v-model="agentVariantKey">
            <option v-for="v in agentFontVariants" :key="`${v.weight}-${v.style}`" :value="`${v.weight}-${v.style}`">{{ weightLabel(v.weight) }} {{ v.style === 'italic' ? '斜体' : '' }}</option>
          </select>
        </div>
      </div>

      <button class="create-btn" :disabled="!canCreate" @click="onCreate">
        {{ isEdit ? '保存修改' : '创建 Agent' }}
      </button>
    </div>

    <!-- 能力配置面板：同级弹窗，紧贴主弹窗右侧 -->
    <Transition name="panel-slide">
      <AgentCapabilityDrawer
        v-if="showCapabilityDrawer"
        :enabled-skills="enabledSkills"
        :enabled-tools="enabledTools"
        :tool-source="toolSource"
        @close="closeCapabilityDrawer"
        @update:enabled-skills="enabledSkills = $event"
        @update:enabled-tools="enabledTools = $event"
        @update:tool-source="toolSource = $event"
      />
    </Transition>
    </div>

    <!-- 模型选择下拉面板 -->
    <div v-if="showModelPicker" class="picker-backdrop" @click="closeModelPicker"></div>
    <div v-if="showModelPicker && modelPickerStyle" class="model-picker-dropdown" :style="modelPickerStyle">
      <input
        class="picker-search"
        v-model="modelSearchQuery"
        placeholder="搜索模型..."
        @keydown.escape="closeModelPicker"
        ref="modelSearchRef"
      />
      <div class="picker-list">
        <div class="picker-item picker-item-default" :class="{ selected: !modelId }" @click="selectModelItem(null)">
          <span class="picker-item-name">默认模型</span>
          <span class="picker-item-id">跟随全局配置</span>
        </div>
        <div
          v-for="m in filteredModelList"
          :key="m.id"
          class="picker-item"
          :class="{ selected: modelId === m.id }"
          @click="selectModelItem(m)"
        >
          <img v-if="getProviderIconUrl(m.provider)" class="picker-item-icon" :src="getProviderIconUrl(m.provider)" alt="" />
          <span class="picker-item-name">{{ m.name }}</span>
          <span class="picker-item-id">{{ m.id }}</span>
        </div>
        <div v-if="filteredModelList.length === 0" class="picker-empty">无匹配模型</div>
      </div>
    </div>

  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useEntityStore, type Entity } from '@worldsmith/entity-core'
import { getModelPresets, getModelInfo } from '@worldsmith/agent-runtime'
import { getProviderIconUrl } from '@/assets/providerIcons'
import { AGENT_COLORS, type BaseLayerMode, type ToolSource } from '../types'
import type { ChatAgent } from '../types'
import { getEnabledSkills, resolveToolNames, ALWAYS_AVAILABLE_TOOLS } from '@agent/index'
import { WsIcon } from '@worldsmith/ui-kit'
import AvatarBadge from '@/ui/AvatarBadge.vue'
import { uploadAvatarFromFile, deleteAvatar } from '@/composables/avatarStore'
import { isImageAvatar, isAvatarRef, getAvatarRefId } from '@/ui/avatar'
import { useAgentProfileStore } from '@/stores/agentProfileStore'
import { useFontLibraryStore } from '@/stores/fontLibraryStore'
import AgentCapabilityDrawer from './AgentCapabilityDrawer.vue'

const props = defineProps<{
  agent?: ChatAgent
}>()

const emit = defineEmits<{
  close: []
  created: [agent: ChatAgent]
  updated: [agent: ChatAgent]
}>()

const profileStore = useAgentProfileStore()
const availableSlots = computed(() => profileStore.slots)

const fontLibraryStore = useFontLibraryStore()
const fontLibraryEntries = computed(() => fontLibraryStore.getAllEntries())

const agentFontVariants = computed(() => {
  if (!fontFamily.value) return []
  const entry = fontLibraryEntries.value.find(e => e.family === fontFamily.value)
  return entry?.variants ?? []
})

const agentVariantKey = computed({
  get: () => `${fontWeight.value}-${fontStyle.value}`,
  set: (key: string) => {
    const [w, s] = key.split('-')
    fontWeight.value = Number(w)
    fontStyle.value = s
  },
})

const WEIGHT_LABELS: Record<number, string> = {
  100: '极细', 200: '超细', 300: '细体', 400: '常规',
  500: '中等', 600: '半粗', 700: '粗体', 800: '超粗', 900: '极粗',
}

function weightLabel(w: number): string {
  return WEIGHT_LABELS[w] ?? `${w}`
}

function onAgentFontFamilyChange() {
  // 切换字体时重置变体为默认
  fontWeight.value = 400
  fontStyle.value = 'normal'
}

const isEdit = computed(() => !!props.agent)

const agentName = ref(props.agent?.name || '')
const agentAvatar = ref(props.agent?.avatar || '')
const avatarInputRef = ref<HTMLInputElement | null>(null)
const agentRole = ref(props.agent?.role || '')
const selectedColor = ref(props.agent?.color || AGENT_COLORS[0])
const sourceType = ref<'entity' | 'custom'>(props.agent?.sourceType || 'custom')
const selectedEntityId = ref(props.agent?.sourceEntityId || '')
const systemPrompt = ref(props.agent?.systemPrompt || '')
const modelId = ref(props.agent?.modelId || '')
const entitySearch = ref('')
const enabledSkills = ref<string[]>(props.agent?.enabledSkills || [])

// 基础层配置
const baseLayerMode = ref<BaseLayerMode>(props.agent?.baseLayerMode || 'empty')
const customBaseLayer = ref(props.agent?.customBaseLayer || '')

// 工具来源
const toolSource = ref<ToolSource>(props.agent?.toolSource || 'derived')
const enabledTools = ref<string[]>(props.agent?.enabledTools || [])

// 输出字体
const fontFamily = ref(props.agent?.fontFamily || '')
const fontWeight = ref(props.agent?.fontWeight ?? 400)
const fontStyle = ref(props.agent?.fontStyle ?? 'normal')

// 能力面板
const showCapabilityDrawer = ref(false)
// 面板是否正在显示或动画中（用于 wrapper 定位，避免关闭动画期间主弹窗跳位）
const panelVisibleForLayout = ref(false)

// 面板尺寸常量
const MAIN_DIALOG_WIDTH = 420
const PANEL_WIDTH = 380
const PANEL_GAP = 12

// wrapper 居中定位：面板展开时两面板居中，收起时主弹窗居中
// 使用 panelVisibleForLayout 而非 showCapabilityDrawer，避免关闭动画期间跳位
const wrapperStyle = computed(() => {
  if (panelVisibleForLayout.value) {
    const half = (MAIN_DIALOG_WIDTH + PANEL_GAP + PANEL_WIDTH) / 2
    return { left: `calc(50% - ${half}px)` }
  }
  return { left: `calc(50% - ${MAIN_DIALOG_WIDTH / 2}px)` }
})

function openCapabilityDrawer(): void {
  showCapabilityDrawer.value = true
  panelVisibleForLayout.value = true
}

function closeCapabilityDrawer(): void {
  showCapabilityDrawer.value = false
  // 延迟重置布局标记，等面板关闭动画（0.2s）结束后再移动主弹窗
  setTimeout(() => {
    if (!showCapabilityDrawer.value) {
      panelVisibleForLayout.value = false
    }
  }, 220)
}

// Provider 来源
const providerSource = ref<string>(
  props.agent?.providerSlotId ? `slot:${props.agent.providerSlotId}` : 'default'
)

// 从选中技能派生的工具名列表
const derivedToolNames = computed(() => {
  return resolveToolNames(enabledSkills.value)
})

// 始终可用的工具集合
const alwaysAvailableSet = new Set(ALWAYS_AVAILABLE_TOOLS)

// 仅来自技能派生的工具（排除始终可用的基线工具，用于UI展示）
const skillDerivedToolNames = computed(() => {
  return derivedToolNames.value.filter(n => !alwaysAvailableSet.has(n))
})

// 技能名称映射
const skillNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const s of getEnabledSkills()) {
    map.set(s.id, s.name)
  }
  return map
})

function getSkillName(id: string): string {
  return skillNameMap.value.get(id) || id
}

watch(sourceType, (newType) => {
  if (newType === 'custom') {
    selectedEntityId.value = ''
  }
})

// 切换基础层模式时清理技能/工具状态，并关闭能力面板
watch(baseLayerMode, (mode) => {
  if (mode !== 'custom') {
    enabledSkills.value = []
    enabledTools.value = []
    toolSource.value = 'derived'
    if (showCapabilityDrawer.value) {
      closeCapabilityDrawer()
    }
  }
})

// 技能变更时：重置为派生模式，同步 enabledTools 缓存
watch(enabledSkills, () => {
  toolSource.value = 'derived'
  enabledTools.value = [...derivedToolNames.value]
}, { deep: true })

const entityStore = useEntityStore()

// 模型选择器
const modelPresets = getModelPresets()
const showModelPicker = ref(false)
const modelSearchQuery = ref('')
const modelSearchRef = ref<HTMLInputElement | null>(null)
const modelPickerAnchor = ref<HTMLElement | null>(null)
const modelPickerStyle = ref<Record<string, string> | null>(null)

interface FlatModel { id: string; name: string; provider: string }
const allFlatModels = computed<FlatModel[]>(() => {
  const list: FlatModel[] = []
  for (const g of modelPresets) {
    for (const m of g.models) {
      list.push({ id: m.id, name: m.name, provider: m.provider })
    }
  }
  return list
})

const filteredModelList = computed(() => {
  const q = modelSearchQuery.value.toLowerCase().trim()
  if (!q) return allFlatModels.value
  return allFlatModels.value.filter(m =>
    m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
  )
})

const selectedProvider = computed(() => {
  if (!modelId.value) return ''
  const info = getModelInfo(modelId.value)
  return info?.provider || ''
})

function getModelName(id: string): string {
  if (!id) return ''
  const info = getModelInfo(id)
  return info?.name || id
}

function toggleModelPicker(): void {
  if (showModelPicker.value) {
    closeModelPicker()
  } else {
    showModelPicker.value = true
    modelSearchQuery.value = ''
    nextTick(() => {
      const trigger = modelPickerAnchor.value?.querySelector('.picker-trigger') as HTMLElement
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        const dropdownH = 320
        const spaceBelow = window.innerHeight - rect.bottom - 8
        const top = spaceBelow >= dropdownH
          ? rect.bottom + 4
          : Math.max(8, rect.top - dropdownH - 4)
        modelPickerStyle.value = {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${top}px`,
          width: `${Math.max(rect.width, 280)}px`,
        }
      }
      modelSearchRef.value?.focus()
    })
  }
}

function closeModelPicker(): void {
  showModelPicker.value = false
  modelSearchQuery.value = ''
  modelPickerStyle.value = null
}

function selectModelItem(m: FlatModel | null): void {
  if (m) {
    modelId.value = m.id
  } else {
    modelId.value = ''
  }
  closeModelPicker()
}

const filteredEntities = computed(() => {
  let list = entityStore.entities
  if (entitySearch.value) {
    const q = entitySearch.value.toLowerCase()
    list = list.filter(e =>
      e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)
    )
  }
  return list.slice(0, 50)
})

const canCreate = computed(() => {
  return agentName.value.trim().length > 0 && systemPrompt.value.trim().length > 0
})

function getEntityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    character: '角色',
    region: '地区',
    event: '事件',
    item: '道具',
    organization: '组织',
    concept: '概念',
  }
  return labels[type] || type
}

function buildEntityPrompt(entity: { name: string; type: string; description: string; properties: Record<string, unknown> }): string {
  const parts: string[] = []
  parts.push(`你的名字是「${entity.name}」。`)
  const typeMap: Record<string, string> = {
    character: '你是这个角色本身。用第一人称说话，仿佛你就是这个角色。',
    region: '你是这片土地的叙事者。用地理叙事者的口吻说话。',
    event: '你是这段历史的见证者。用历史见证者的口吻说话。',
    item: '你是这件器物之灵。用器物之灵的口吻说话。',
    organization: '你是这个组织的代言人。用组织代言人的口吻说话。',
    concept: '你是这个概念的化身。用概念化身的口吻说话。',
  }
  if (typeMap[entity.type]) {
    parts.push(typeMap[entity.type])
  }
  if (entity.description) {
    parts.push(`关于你的描述：${entity.description}`)
  }
  const personalityKeys = ['personality', '性格', '性格特点', 'personality_traits']
  for (const key of personalityKeys) {
    const val = entity.properties[key]
    if (val && typeof val === 'string') {
      parts.push(`你的性格：${val}`)
      break
    }
  }
  return parts.join('\n')
}

function onSelectEntity(entity: Entity): void {
  selectedEntityId.value = entity.id
  agentName.value = entity.name
  agentRole.value = getEntityTypeLabel(entity.type)
  systemPrompt.value = buildEntityPrompt(entity)
}

async function onAvatarFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const newAvatar = await uploadAvatarFromFile(file, agentAvatar.value)
    agentAvatar.value = newAvatar
  } catch (err) {
    console.warn('[CreateAgentDialog] 头像上传失败:', err)
  }
  input.value = ''
}

function onClearAvatar(): void {
  const old = agentAvatar.value
  if (isAvatarRef(old)) {
    const id = getAvatarRefId(old)
    if (id) deleteAvatar(id)
  }
  agentAvatar.value = ''
}

// 头像优先级：上传的图片引用 > 名字首字 > '?'
function resolveAvatar(): string {
  return agentAvatar.value || agentName.value.trim()[0] || '?'
}

function onCreate(): void {
  if (!canCreate.value) return

  const now = Date.now()
  const isSlot = providerSource.value.startsWith('slot:')
  const slotId = isSlot ? providerSource.value.slice(5) : undefined

  const finalTools = toolSource.value === 'derived' ? [...derivedToolNames.value] : enabledTools.value

  if (isEdit.value && props.agent) {
    const updated: ChatAgent = {
      ...props.agent,
      name: agentName.value.trim(),
      role: agentRole.value.trim(),
      avatar: resolveAvatar(),
      color: selectedColor.value,
      systemPrompt: systemPrompt.value.trim(),
      modelId: modelId.value || undefined,
      providerConfig: undefined,
      providerSlotId: slotId || undefined,
      sourceType: sourceType.value,
      sourceEntityId: sourceType.value === 'entity' ? selectedEntityId.value : undefined,
      enabledTools: finalTools,
      enabledSkills: enabledSkills.value,
      baseLayerMode: baseLayerMode.value,
      customBaseLayer: baseLayerMode.value === 'custom' ? customBaseLayer.value : undefined,
      toolSource: toolSource.value,
      fontFamily: fontFamily.value || undefined,
      fontWeight: fontFamily.value ? fontWeight.value : undefined,
      fontStyle: fontFamily.value ? fontStyle.value : undefined,
      updatedAt: now,
    }
    emit('updated', updated)
  } else {
    const agent: ChatAgent = {
      id: crypto.randomUUID(),
      name: agentName.value.trim(),
      avatar: resolveAvatar(),
      color: selectedColor.value,
      role: agentRole.value.trim(),
      systemPrompt: systemPrompt.value.trim(),
      modelId: modelId.value || undefined,
      providerConfig: undefined,
      providerSlotId: slotId || undefined,
      sourceType: sourceType.value,
      sourceEntityId: sourceType.value === 'entity' ? selectedEntityId.value : undefined,
      enabledTools: finalTools,
      enabledSkills: enabledSkills.value,
      baseLayerMode: baseLayerMode.value,
      customBaseLayer: baseLayerMode.value === 'custom' ? customBaseLayer.value : undefined,
      toolSource: toolSource.value,
      fontFamily: fontFamily.value || undefined,
      fontWeight: fontFamily.value ? fontWeight.value : undefined,
      fontStyle: fontFamily.value ? fontStyle.value : undefined,
      createdAt: now,
      updatedAt: now,
    }
    emit('created', agent)
  }
}
</script>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 10000; }

/* wrapper：flex 容器，居中定位，面板展开时左推动画 */
.dialog-wrapper {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 12px;
  align-items: flex-start;
  transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10001;
}

.create-agent-dialog { width: 420px; max-height: 80vh; overflow-y: auto; background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); flex-shrink: 0; }
.dialog-title { font-size: var(--fs-lg); font-weight: 600; margin-bottom: 16px; text-align: center; }

.avatar-section { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.avatar-wrap { position: relative; flex-shrink: 0; }
.avatar-circle { flex-shrink: 0; }
.avatar-actions { position: absolute; bottom: -4px; right: -4px; display: flex; gap: 2px; }
.avatar-action-btn { width: 20px; height: 20px; border: 1px solid var(--color-border); border-radius: 50%; background: var(--color-surface-elevated); color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s, color 0.15s; }
.avatar-action-btn:hover { background: var(--color-primary); color: var(--on-accent); }
.avatar-file-input { display: none; }
.avatar-fields { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.name-input { border: none; border-bottom: 1px solid var(--color-border); font-size: var(--fs-lg); font-weight: 600; background: transparent; outline: none; }
.role-input { border: none; border-bottom: 1px solid var(--color-border); font-size: var(--fs-sm); background: transparent; outline: none; color: var(--color-text-secondary); }

.section-label { font-size: var(--fs-xs); color: var(--color-text-tertiary); font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }

.color-section { margin-bottom: 14px; }
.color-options { display: flex; gap: 6px; }
.color-dot { width: 22px; height: 22px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s; }
.color-dot.active { border-color: var(--on-accent); box-shadow: 0 0 0 2px var(--color-primary); }

.source-section { margin-bottom: 14px; }
.source-options { display: flex; gap: 8px; }
.source-option { flex: 1; padding: 8px; border: 2px solid var(--color-border); border-radius: var(--radius-mid); cursor: pointer; text-align: center; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.source-option.active { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
.source-icon { font-size: 18px; display: block; margin-bottom: 2px; }
.source-label { font-size: var(--fs-xs); font-weight: 600; }

.entity-section { margin-bottom: 14px; }
.entity-search { width: 100%; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); font-size: var(--fs-sm); background: var(--color-surface); outline: none; margin-bottom: 6px; }
.entity-list { max-height: 160px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-mid); }
.entity-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; transition: background 0.12s; }
.entity-item:hover { background: var(--color-surface); }
.entity-item.selected { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
.entity-avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--color-surface); display: flex; align-items: center; justify-content: center; font-size: var(--fs-xs); font-weight: 700; flex-shrink: 0; }
.entity-info { flex: 1; min-width: 0; }
.entity-name { font-size: var(--fs-sm); font-weight: 600; }
.entity-type { font-size: var(--fs-2xs); color: var(--color-text-tertiary); margin-left: 4px; }
.entity-check { color: var(--color-primary); font-weight: 700; }
.entity-empty { padding: 12px; font-size: var(--fs-xs); color: var(--color-text-tertiary); text-align: center; }

.prompt-section { margin-bottom: 14px; }
.prompt-input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 8px; font-size: var(--fs-sm); resize: vertical; outline: none; background: var(--color-surface); min-height: 80px; }
.prompt-input:focus { border-color: var(--color-primary); }

.baselayer-section { margin-bottom: 14px; }
.baselayer-desc { font-size: var(--fs-2xs); color: var(--color-text-tertiary); margin-bottom: 6px; }
.baselayer-options { display: flex; gap: 6px; }
.baselayer-option { flex: 1; padding: 8px 6px; border: 2px solid var(--color-border); border-radius: var(--radius-mid); cursor: pointer; text-align: center; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.baselayer-option:hover { border-color: var(--color-primary); }
.baselayer-option.active { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
.baselayer-option-title { display: block; font-size: var(--fs-sm); font-weight: 600; margin-bottom: 2px; }
.baselayer-option-desc { display: block; font-size: var(--fs-3xs); color: var(--color-text-tertiary); line-height: 1.3; }
.baselayer-input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 8px; font-size: var(--fs-sm); resize: vertical; outline: none; background: var(--color-surface); min-height: 80px; margin-top: 8px; }
.baselayer-input:focus { border-color: var(--color-primary); }

/* 能力配置卡片 */
.capability-section { margin-bottom: 14px; }
.capability-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-mid);
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.capability-card:hover {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 3%, transparent);
}
.capability-card.panel-open {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
}
.capability-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.capability-icon { color: var(--color-primary); flex-shrink: 0; }
.capability-title { font-size: var(--fs-sm); font-weight: 600; flex: 1; }
.capability-arrow { color: var(--color-text-tertiary); flex-shrink: 0; }
.capability-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-2xs);
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}
.capability-skills { color: var(--color-text); font-weight: 500; }
.capability-divider { color: var(--color-text-tertiary); }
.capability-tools { color: var(--color-text-secondary); }
.capability-manual-badge {
  font-size: var(--fs-3xs);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
  padding: 0px 5px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  margin-left: 4px;
}
.capability-empty { color: var(--color-text-tertiary); font-style: italic; }
.capability-skill-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.capability-skill-tag {
  font-size: var(--fs-3xs);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
}
.capability-skill-more {
  font-size: var(--fs-3xs);
  color: var(--color-text-tertiary);
  padding: 1px 4px;
}

.model-section { margin-bottom: 14px; }

/* 模型选择器 */
.model-picker { position: relative; }
.picker-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-mid);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  min-height: 32px;
  transition: border-color 0.15s;
}
.picker-trigger:hover { border-color: var(--color-primary); }
.picker-icon { width: 16px; height: 16px; flex-shrink: 0; border-radius: 2px; }
.picker-value { flex: 1; font-size: var(--fs-sm); color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-placeholder { flex: 1; font-size: var(--fs-sm); color: var(--color-text-tertiary); }

/* 下拉面板 */
.picker-backdrop { position: fixed; inset: 0; z-index: 10002; }
.model-picker-dropdown {
  position: fixed;
  max-height: 320px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-mid);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 10003;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.picker-search {
  margin: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-sm);
  outline: none;
  flex-shrink: 0;
}
.picker-search:focus { border-color: var(--color-primary); }
.picker-list { flex: 1; overflow-y: auto; padding: 0 4px 4px; }
.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background 0.1s;
}
.picker-item:hover { background: var(--color-surface); }
.picker-item.selected { background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.picker-item-default { border-bottom: 1px solid var(--color-border); margin-bottom: 2px; }
.picker-item-icon { width: 16px; height: 16px; flex-shrink: 0; border-radius: 2px; }
.picker-item-name { font-size: var(--fs-sm); color: var(--color-text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-item-id { font-size: var(--fs-3xs); color: var(--color-text-tertiary); font-family: monospace; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-empty { padding: 16px; text-align: center; font-size: var(--fs-sm); color: var(--color-text-tertiary); }

.provider-section { margin-bottom: 14px; }
.provider-select { width: 100%; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); font-size: var(--fs-sm); background: var(--color-surface); outline: none; margin-bottom: 6px; }
.provider-hint { font-size: var(--fs-2xs); color: var(--color-text-tertiary); margin-top: 2px; }

.font-section { margin-bottom: 14px; }
.font-variant-row { margin-top: 6px; }
.provider-select--sm { max-width: 160px; font-size: var(--fs-sm); padding: 4px 6px; }

.create-btn { width: 100%; padding: 10px; border: none; background: var(--color-primary); color: var(--on-accent); border-radius: var(--radius-md); cursor: pointer; font-size: var(--fs-md); font-weight: 600; }
.create-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 能力面板滑入动画 */
.panel-slide-enter-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.panel-slide-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.panel-slide-enter-from { opacity: 0; transform: translateX(20px); }
.panel-slide-leave-to { opacity: 0; transform: translateX(30px); }
</style>
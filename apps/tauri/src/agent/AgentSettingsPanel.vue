<template>
  <Transition :name="embedded ? '' : 'ws-menu'">
    <div
      v-if="embedded || visible"
      :class="embedded ? 'agent-settings-embedded' : 'agent-settings agent-panel'"
      :style="embedded ? undefined : panelStyle"
      @mousedown.left="!embedded && onDragStart($event)"
    >
      <div v-if="!embedded" class="settings-drag-handle">
        <span class="menu-title"><WsIcon name="settings" size="sm" /> AI 助手设置</span>
        <button class="menu-close-btn" @click="emit('close')">✕</button>
      </div>
      <div class="settings-body">
        <!-- 左侧纵向分组导航（仅独立悬浮面板；设置内嵌走卡片式布局） -->
        <nav v-if="!embedded" class="settings-nav">
          <div v-for="group in NAV_GROUPS" :key="group.label" class="snav-group">
            <div class="snav-group-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="item.key"
              class="snav-item"
              :class="{ on: settingsSubPanel === item.key }"
              @click="settingsSubPanel = settingsSubPanel === item.key ? '' : item.key"
            ><WsIcon :name="item.icon" size="xs" /><span>{{ item.label }}</span></button>
          </div>
          <button v-if="!embedded" class="snav-item" @click="emit('reset-position')"><WsIcon name="outline" size="xs" /><span>恢复位置</span></button>
        </nav>
        <!-- 右侧面板内容 -->
        <div class="settings-content">
        <!-- 设置内嵌（embedded）：卡片式全展开，无左侧导航 -->
        <template v-if="embedded">
          <!-- 模型卡片 -->
          <div class="agent-set-card">
            <div class="agent-set-head">模型</div>
            <ModelPanel
              :embedded="true"
              :current-model-id="currentModelId"
              :temperature="temperature"
              :max-tokens="maxTokens"
              :context-length="contextLength"
              :max-context-length="maxContextLength"
              :max-output-tokens="maxOutputTokens"
              :max-temperature="maxTemperature"
              :persona-preset="personaPreset"
              :chat-mode="chatMode"
              :chat-modes="[...chatModes]"
              :locked-chat-mode="lockedChatMode"
              :cloud-api-key="cloudApiKey"
              :custom-api-key="customApiKey"
              :fetched-models="fetchedModels"
              :fetching-models="fetchingModels"
              :fetch-error="fetchError"
              :can-fetch-models="canFetchModels"
              @update:temperature="emit('update:temperature', $event)"
              @update:max-tokens="emit('update:maxTokens', $event)"
              @update:context-length="emit('update:contextLength', $event)"
              @update:persona-preset="emit('update:personaPreset', $event)"
              @update:cloud-api-key="cloudApiKey = $event"
              @update:custom-api-key="customApiKey = $event"
              @model-change="(provider, modelId) => emit('model-change', provider, modelId)"
              @chat-mode-change="(mode) => emit('chat-mode-change', mode)"
              @provider-change="(provider, modelId) => emit('provider-change', provider, modelId)"
              @fetch-models="onFetchModels"
            />
          </div>
          <!-- 用量卡片 -->
          <div class="agent-set-card">
            <div class="agent-set-head">用量</div>
            <UsagePanel
              :total-usage="totalUsage"
              :calculated-cost="calculatedCost"
              :cumulative-usage="cumulativeUsage"
              :cache-hit-rate="cacheHitRate"
            />
          </div>
          <!-- 能力与工具卡片 -->
          <div class="agent-set-card">
            <div class="agent-set-head">能力与工具</div>
            <div class="agent-set-sub">搜索</div>
            <div class="settings-row">
              <select :value="searchEngine" @change="onSearchEngineChange" class="settings-select">
                <option value="tavily">Tavily</option>
                <option value="serpapi">SerpAPI</option>
                <option value="bing">Bing</option>
              </select>
            </div>
            <div class="settings-row" style="margin-top:6px">
              <input
                type="password"
                :value="searchApiKey"
                @input="onSearchApiKeyChange"
                placeholder="搜索 API Key"
                class="settings-input"
              />
            </div>
            <div class="settings-hint">web_search 需配置 Key；web_fetch（阅读网页）无需 Key，直接可用</div>
            <div class="agent-set-sub">多模态</div>
            <VisionPanel />
            <div class="agent-set-sub">终端</div>
            <TerminalPanel @open-terminal="emit('open-terminal')" />
          </div>
          <!-- Skills 卡片 -->
          <div class="agent-set-card">
            <div class="agent-set-head">Skills</div>
            <div class="skills-list">
              <div v-for="skill in skills" :key="skill.id" class="skill-item" :class="{ disabled: !skill.enabled }">
                <span class="skill-icon"><WsIcon :name="skill.icon" size="sm" /></span>
                <div class="skill-info">
                  <span class="skill-name">{{ skill.name }}</span>
                  <span class="skill-desc">{{ skill.description }}</span>
                </div>
                <button class="skill-toggle" @click="emit('toggle-skill', skill.id)" :title="skill.enabled ? '点击禁用' : '点击启用'">
                  <WsIcon :name="skill.enabled ? 'check' : 'close'" size="xs" />
                </button>
              </div>
            </div>
            <SkillsStorePanel @skills-changed="emit('skills-changed')" />
          </div>
          <!-- MCP 卡片 -->
          <div class="agent-set-card">
            <div class="agent-set-head">MCP</div>
            <McpPanel
              :mcp-connections="mcpConnections"
              @toggle-mcp="(serverId) => emit('toggle-mcp', serverId)"
              @add-mcp="(config) => emit('add-mcp', config)"
              @remove-mcp="(serverId) => emit('remove-mcp', serverId)"
            />
          </div>
          <!-- 边界与个性卡片 -->
          <div class="agent-set-card">
            <div class="agent-set-head">边界与个性</div>
            <div class="settings-row">
              <span class="settings-row-label">危险操作确认</span>
              <label class="settings-toggle"><input type="checkbox" v-model="settingsStore.aiDangerConfirm" /><span class="settings-toggle-slider"></span></label>
            </div>
            <div class="settings-hint">开启后 AI 删除实体/关系时需用户确认</div>
            <div class="agent-set-sub">思考级别</div>
            <select :value="thinkingLevel" @change="onThinkingLevelChange" class="settings-select">
              <option v-for="lvl in thinkingLevels" :key="lvl.value" :value="lvl.value">{{ lvl.label }}</option>
            </select>
            <div class="settings-hint">控制推理深度：off 直答，深度级别越高推理链越完整</div>
          </div>
        </template>
        <!-- 独立悬浮面板：左侧导航切换子面板 -->
        <template v-else>
        <Transition name="ws-slide-up" mode="out-in">
          <!-- 模型/核心面板（两种模式共用 ModelPanel，内部按 embedded 切换显示） -->
          <ModelPanel v-if="settingsSubPanel === 'model'" key="model"
            :embedded="embedded"
            :current-model-id="currentModelId"
            :temperature="temperature"
            :max-tokens="maxTokens"
            :context-length="contextLength"
            :max-context-length="maxContextLength"
            :max-output-tokens="maxOutputTokens"
            :max-temperature="maxTemperature"
            :persona-preset="personaPreset"
            :chat-mode="chatMode"
            :chat-modes="[...chatModes]"
            :locked-chat-mode="lockedChatMode"
            :cloud-api-key="cloudApiKey"
            :custom-api-key="customApiKey"
            :fetched-models="fetchedModels"
            :fetching-models="fetchingModels"
            :fetch-error="fetchError"
            :can-fetch-models="canFetchModels"
            @update:temperature="emit('update:temperature', $event)"
            @update:max-tokens="emit('update:maxTokens', $event)"
            @update:context-length="emit('update:contextLength', $event)"
            @update:persona-preset="emit('update:personaPreset', $event)"
            @update:cloud-api-key="cloudApiKey = $event"
            @update:custom-api-key="customApiKey = $event"
            @model-change="(provider, modelId) => emit('model-change', provider, modelId)"
            @chat-mode-change="(mode) => emit('chat-mode-change', mode)"
            @provider-change="(provider, modelId) => emit('provider-change', provider, modelId)"
            @fetch-models="onFetchModels"
          />
          <!-- 供应商面板（仅非 embedded） -->
          <ProviderPanel v-else-if="!embedded && settingsSubPanel === 'provider'" key="provider"
            :cloud-api-key="cloudApiKey"
            :custom-api-key="customApiKey"
            :fetched-models="fetchedModels"
            :fetching-models="fetchingModels"
            :fetch-error="fetchError"
            :can-fetch-models="canFetchModels"
            @update:cloud-api-key="cloudApiKey = $event"
            @update:custom-api-key="customApiKey = $event"
            @model-change="(provider, modelId) => emit('model-change', provider, modelId)"
            @provider-change="(provider, modelId) => emit('provider-change', provider, modelId)"
            @fetch-models="onFetchModels"
          />
          <!-- 安全面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'safety'" key="safety" class="sub-panel">
            <div class="settings-section">
              <div class="settings-row">
                <span class="settings-row-label">危险操作确认</span>
                <label class="settings-toggle"><input type="checkbox" v-model="settingsStore.aiDangerConfirm" /><span class="settings-toggle-slider"></span></label>
              </div>
              <div class="settings-hint">开启后 AI 删除实体/关系时需用户确认</div>
            </div>
            <!-- A7：工具安全级别（三档，运行时切换 Rust 侧确认策略） -->
            <div class="settings-section">
              <div class="settings-label">工具安全级别</div>
              <select :value="securityLevel" @change="onSecurityLevelChange" class="settings-select">
                <option value="off">宽松（关闭确认）</option>
                <option value="dangerous_only">推荐（仅危险操作确认）</option>
                <option value="moderate_and_dangerous">严格（写操作/命令一律确认）</option>
              </select>
              <div class="settings-hint">控制 Agent 执行工具前的确认程度，需对当前会话生效</div>
            </div>
          </div>
          <!-- 人格预设面板（内联，对应视觉稿边界与个性组） -->
          <div v-else-if="settingsSubPanel === 'persona'" key="persona" class="sub-panel">
            <div class="settings-section">
              <div class="settings-label">AI 人格预设</div>
              <select :value="personaPreset" @change="onPersonaPresetChange" class="settings-select">
                <option value="default">默认助手</option>
                <option value="creative">创意写手</option>
                <option value="analyst">严谨分析师</option>
                <option value="storyteller">故事叙述者</option>
              </select>
              <div class="settings-hint">定义 AI 的表达风格与角色倾向，切换后后续对话生效</div>
            </div>
          </div>
          <!-- 思考级别面板（内联，对应视觉稿边界与个性组） -->
          <div v-else-if="settingsSubPanel === 'thinking'" key="thinking" class="sub-panel">
            <div class="settings-section">
              <div class="settings-label">思考级别</div>
              <select :value="thinkingLevel" @change="onThinkingLevelChange" class="settings-select">
                <option v-for="lvl in thinkingLevels" :key="lvl.value" :value="lvl.value">{{ lvl.label }}</option>
              </select>
              <div class="settings-hint">控制推理深度：off 直答，深度级别越高推理链越完整</div>
            </div>
          </div>
          <!-- 用量面板 -->
          <UsagePanel v-else-if="settingsSubPanel === 'usage'" key="usage"
            :total-usage="totalUsage"
            :calculated-cost="calculatedCost"
            :cumulative-usage="cumulativeUsage"
            :cache-hit-rate="cacheHitRate"
          />
          <!-- 搜索面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'search'" key="search" class="sub-panel">
            <div class="settings-row">
              <select :value="searchEngine" @change="onSearchEngineChange" class="settings-select">
                <option value="tavily">Tavily</option>
                <option value="serpapi">SerpAPI</option>
                <option value="bing">Bing</option>
              </select>
            </div>
            <div class="settings-row" style="margin-top:6px">
              <input
                type="password"
                :value="searchApiKey"
                @input="onSearchApiKeyChange"
                placeholder="搜索 API Key"
                class="settings-input"
              />
            </div>
            <div class="settings-hint">web_search 需配置 Key；web_fetch（阅读网页）无需 Key，直接可用</div>
          </div>
          <!-- 多模态面板 -->
          <VisionPanel v-else-if="settingsSubPanel === 'vision'" key="vision" />
          <!-- Skills 面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'skills'" key="skills" class="sub-panel">
            <div class="skills-list">
              <div v-for="skill in skills" :key="skill.id" class="skill-item" :class="{ disabled: !skill.enabled }">
                <span class="skill-icon"><WsIcon :name="skill.icon" size="sm" /></span>
                <div class="skill-info">
                  <span class="skill-name">{{ skill.name }}</span>
                  <span class="skill-desc">{{ skill.description }}</span>
                </div>
                <button class="skill-toggle" @click="emit('toggle-skill', skill.id)" :title="skill.enabled ? '点击禁用' : '点击启用'">
                  <WsIcon :name="skill.enabled ? 'check' : 'close'" size="xs" />
                </button>
              </div>
            </div>
            <SkillsStorePanel @skills-changed="emit('skills-changed')" />
          </div>
          <!-- MCP 面板 -->
          <McpPanel v-else-if="settingsSubPanel === 'mcp'" key="mcp"
            :mcp-connections="mcpConnections"
            @toggle-mcp="(serverId) => emit('toggle-mcp', serverId)"
            @add-mcp="(config) => emit('add-mcp', config)"
            @remove-mcp="(serverId) => emit('remove-mcp', serverId)"
          />
          <!-- 终端面板 -->
          <TerminalPanel v-else-if="settingsSubPanel === 'terminal'" key="terminal"
            @open-terminal="emit('open-terminal')"
          />
        </Transition>
        </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { usePanelDrag } from './composables/usePanelDrag'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModelApiKeyConfig } from './composables/useModelApiKeyConfig'
import { useCustomModelFetch } from './composables/useCustomModelFetch'
import SkillsStorePanel from './SkillsStorePanel.vue'
// 拆分出的子面板
import ModelPanel from './panels/ModelPanel.vue'
import ProviderPanel from './panels/ProviderPanel.vue'
import UsagePanel from './panels/UsagePanel.vue'
import VisionPanel from './panels/VisionPanel.vue'
import McpPanel from './panels/McpPanel.vue'
import TerminalPanel from './panels/TerminalPanel.vue'

const settingsStore = useSettingsStore()

const props = withDefaults(defineProps<{
  visible: boolean
  position: { x: number; y: number }
  dragged: boolean
  currentProvider: string
  currentModelId: string
  temperature: number
  maxTokens: number
  contextLength: number
  maxContextLength: number
  maxOutputTokens: number
  maxTemperature: number
  personaPreset: string
  thinkingLevel: string
  thinkingLevels: Array<{ value: string; label: string; desc: string }>
  chatMode: string
  chatModes: ReadonlyArray<{ value: string; icon: string; label: string; desc: string }>
  lockedChatMode: string | null
  totalUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  calculatedCost: { inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number; total: number; savedByCache: number }
  cumulativeUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  cacheHitRate: number
  searchEngine: string
  searchApiKey: string
  skills: Array<{ id: string; icon: string; name: string; description: string; enabled: boolean }>
  mcpConnections: Array<{ id: string; config: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[]; enabled: boolean }; status: string; tools: unknown[]; error?: string }>
  embedded?: boolean
}>(), {
  embedded: false,
  lockedChatMode: null,
})

const emit = defineEmits<{
  close: []
  dragstart: [e: MouseEvent]
  'update:temperature': [value: number]
  'update:maxTokens': [value: number]
  'update:contextLength': [value: number]
  'update:personaPreset': [value: string]
  'model-change': [provider: string, modelId: string]
  'thinking-level-change': [level: string]
  'chat-mode-change': [mode: string]
  'search-engine-change': [engine: string]
  'search-apikey-change': [key: string]
  'toggle-skill': [skillId: string]
  'skills-changed': []
  'toggle-mcp': [serverId: string]
  'add-mcp': [config: any]
  'remove-mcp': [serverId: string]
  'reset-position': []
  'open-terminal': []
  'api-key-change': [provider: string, apiKey: string]
  'provider-change': [provider: string, modelId: string]
  'security-level-change': [level: string]
}>()

// ── 模型 API Key 加载/持久化（拆分至 useModelApiKeyConfig） ──
const { cloudApiKey, customApiKey } = useModelApiKeyConfig({
  onApiKeyChange: (provider, apiKey) => emit('api-key-change', provider, apiKey),
})

// ── 自定义供应商模型拉取（拆分至 useCustomModelFetch） ──
const { fetchedModels, fetchingModels, fetchError, canFetchModels, onFetchModels } = useCustomModelFetch({
  customApiKey,
})

// 当前展开的子面板
const settingsSubPanel = ref('')

/** 子面板纵向分组导航（模型与推理 / 能力与工具 / 边界与个性） */
const NAV_GROUPS = [
  {
    label: '模型与推理',
    items: [
      { key: 'model', label: '核心', icon: 'settings' },
      { key: 'provider', label: '供应商', icon: 'link' },
      { key: 'usage', label: '用量', icon: 'dashboard' },
    ],
  },
  {
    label: '能力与工具',
    items: [
      { key: 'skills', label: 'Skills', icon: 'star' },
      { key: 'mcp', label: 'MCP', icon: 'link' },
      { key: 'search', label: '搜索', icon: 'globe' },
      { key: 'vision', label: '多模态', icon: 'eye' },
      { key: 'terminal', label: '终端', icon: 'keyboard' },
    ],
  },
  {
    label: '边界与个性',
    items: [
      { key: 'safety', label: '安全', icon: 'shield' },
      { key: 'persona', label: '人格预设', icon: 'person' },
      { key: 'thinking', label: '思考级别', icon: 'sparkles' },
    ],
  },
]

// ── 面板拖拽（仅非 embedded 模式） ──
const posX = computed({
  get: () => props.position.x,
  set: () => {},
})
const posY = computed({
  get: () => props.position.y,
  set: () => {},
})

const { onDragStart } = usePanelDrag({
  x: posX,
  y: posY,
  excludeSelector: '.settings-body, .menu-close-btn',
})

const panelStyle = computed(() => {
  if (props.dragged) {
    return { left: `${props.position.x}px`, top: `${props.position.y}px` }
  }
  return { left: `${props.position.x}px`, bottom: `${props.position.y}px` }
})

// ── 搜索面板事件转发（短子面板内联） ──
function onSearchEngineChange(e: Event): void {
  emit('search-engine-change', (e.target as HTMLSelectElement).value)
}

function onSearchApiKeyChange(e: Event): void {
  emit('search-apikey-change', (e.target as HTMLInputElement).value)
}

// ── 人格预设/思考级别面板事件转发（边界与个性组） ──
function onPersonaPresetChange(e: Event): void {
  emit('update:personaPreset', (e.target as HTMLSelectElement).value)
}

function onThinkingLevelChange(e: Event): void {
  emit('thinking-level-change', (e.target as HTMLSelectElement).value)
}

// A7 工具安全级别：加载 settingsStore 持久值，切换时 emit（SpaceAgentSettingsPanel 转发到 useAgentRust.setSecurityLevel）
const securityLevel = ref(settingsStore.agentSecurityLevel || 'dangerous_only')

function onSecurityLevelChange(e: Event): void {
  const level = (e.target as HTMLSelectElement).value
  settingsStore.agentSecurityLevel = level
  emit('security-level-change', level)
}
</script>

<style>
.agent-settings {
  position: fixed;
  width: 280px;
  max-height: 80vh;
  background: var(--agent-bg);
  backdrop-filter: blur(var(--agent-blur));
  border: 1px solid var(--agent-border);
  border-radius: var(--agent-radius);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10001;
  overflow: hidden;
  pointer-events: auto;
}

.agent-settings-embedded {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.agent-settings-embedded .settings-body {
  max-height: none;
  flex: 1;
  /* 设置内嵌：卡片式竖排，整体滚动（无左侧导航） */
  flex-direction: column;
  overflow-y: auto;
  gap: 10px;
}

.agent-settings-embedded .settings-content {
  overflow: visible;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

/* 设置内嵌卡片（与其它设置面板的 set-card 视觉一致） */
.agent-set-card {
  background: var(--content-bg, var(--color-bg-surface));
  border-radius: var(--radius-md, 8px);
  padding: 14px 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--border, var(--color-border));
  flex-shrink: 0;
}
.agent-set-head {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-tertiary, var(--color-text-tertiary));
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.agent-set-sub {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-tertiary, var(--color-text-tertiary));
  margin: 12px 0 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border, var(--color-border));
}
.agent-set-sub:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.settings-drag-handle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border);
  cursor: grab;
  user-select: none;
}

.settings-drag-handle:active { cursor: grabbing }

.menu-title {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
  font-family: var(--agent-font);
}

.menu-close-btn {
  background: none;
  border: none;
  color: var(--agent-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-base);
}

.settings-body {
  display: flex;
  gap: 10px;
  min-height: 0;
  flex: 1;
  padding: 10px;
  overflow: hidden;
}
.settings-section { margin-bottom: 14px }
.settings-section:last-child { margin-bottom: 0 }

/* 纵向分组导航 */
.settings-nav {
  width: 118px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--agent-border);
  padding-right: 8px;
}

.snav-group { margin-bottom: 12px }
.snav-group:last-child { margin-bottom: 0 }

.snav-group-label {
  font-size: var(--font-size-2xs, 11px);
  color: var(--agent-text-tertiary);
  padding: 0 6px 4px;
  letter-spacing: 0.4px;
  font-family: var(--agent-font);
}

.snav-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--agent-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s, color 0.15s;
  font-family: var(--agent-font);
  text-align: left;
}

.snav-item:hover {
  background: var(--agent-hover-bg);
  color: var(--agent-text);
}

.snav-item.on {
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
}

/* 右侧面板内容 */
.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 2px 4px;
}

.settings-label {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  margin-bottom: 6px;
  font-family: var(--agent-font);
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-row-label {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
  white-space: nowrap;
  font-family: var(--agent-font);
}

.sp-row-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary);
  min-width: 52px;
  flex-shrink: 0;
  font-family: var(--agent-font);
}

.settings-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.settings-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.settings-toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--agent-border-color);
  border-radius: var(--radius-pill, 18px);
  transition: background 0.2s;
}

.settings-toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 3px;
  top: 3px;
  background: var(--color-bg-surface);
  border-radius: 50%;
  transition: transform 0.2s;
}

.settings-toggle input:checked + .settings-toggle-slider {
  background: var(--agent-primary);
}

.settings-toggle input:checked + .settings-toggle-slider::before {
  transform: translateX(14px);
}

.settings-slider {
  flex: 1;
  accent-color: var(--agent-primary);
  height: 4px;
}

.settings-value {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  min-width: 48px;
  text-align: right;
  font-family: var(--agent-font);
}

.settings-select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--agent-border-color);
  border-radius: var(--radius-sm);
  background: var(--agent-input-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  outline: none;
  cursor: pointer;
}

.settings-select:focus { border-color: var(--agent-primary) }

.settings-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--agent-border-color);
  border-radius: var(--radius-sm);
  background: var(--agent-input-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  outline: none;
}

.settings-input:focus { border-color: var(--agent-primary) }
.settings-input::placeholder { color: var(--agent-text-tertiary) }

.sub-panel {
  padding: 8px 0;
  border-top: 1px solid var(--agent-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sub-slide-enter-active,
.sub-slide-leave-active {
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease;
  overflow: hidden;
}

.sub-slide-enter-from,
.sub-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.sub-slide-enter-to,
.sub-slide-leave-from {
  opacity: 1;
  max-height: 500px;
}

.settings-hint {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-top: 4px;
  font-family: var(--agent-font);
}

.settings-key {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary);
  min-width: 52px;
  flex-shrink: 0;
  font-family: var(--agent-font);
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-mid);
  background: var(--agent-hover-bg);
  border: 1px solid transparent;
  transition: border-color 0.15s, opacity 0.15s;
}

.skill-item.disabled {
  opacity: 0.5;
}

.skill-item:hover {
  border-color: var(--agent-border);
}

.skill-icon {
  font-size: var(--font-size-lg);
  flex-shrink: 0;
}

.skill-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.skill-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--agent-text);
  font-family: var(--agent-font);
}

.skill-desc {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--agent-font);
}

.skill-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px;
  flex-shrink: 0;
  transition: transform 0.1s;
}

.skill-toggle:hover {
  transform: scale(1.2);
}

.mcp-list { display: flex; flex-direction: column; gap: 6px; }
.mcp-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-mid); background: var(--agent-hover-bg); border: 1px solid transparent; transition: border-color 0.15s, opacity 0.15s; }
.mcp-item.disabled { opacity: 0.5; }
.mcp-item:hover { border-color: var(--agent-border); }
.mcp-status { font-size: var(--font-size-xs); flex-shrink: 0; }
.mcp-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mcp-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--agent-text); font-family: var(--agent-font); }
.mcp-desc { font-size: var(--font-size-xs); color: var(--agent-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--agent-font); }
.mcp-add-form { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; border-top: 1px solid var(--agent-border); }
.mcp-add-actions { display: flex; gap: 6px; justify-content: flex-end; }
.mcp-delete-btn { background: none; border: none; cursor: pointer; font-size: var(--font-size-xs); padding: 2px 4px; opacity: 0.4; transition: opacity 0.15s; }
.mcp-delete-btn:hover { opacity: 1; }
.mcp-presets { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--agent-border); }
.mcp-presets-title { font-size: var(--font-size-xs); color: var(--agent-text-tertiary); margin-bottom: 6px; font-family: var(--agent-font); }
.mcp-presets-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.preset-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 8px; border-radius: var(--radius-sm); border: 1px solid var(--agent-border); background: var(--agent-hover-bg); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; min-width: 90px; }
.preset-btn:hover:not(:disabled) { border-color: var(--agent-accent); background: color-mix(in srgb, var(--agent-primary) 8%, transparent); }
.preset-btn.added { opacity: 0.4; cursor: default; }
.preset-name { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--agent-text); font-family: var(--agent-font); }
.preset-desc { font-size: var(--text-micro-font-size); color: var(--agent-text-tertiary); font-family: var(--agent-font); }

.chat-mode-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}

.chat-mode-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-mid);
  border: 1px solid var(--agent-border);
  background: var(--agent-hover-bg);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
  text-align: left;
  font-family: var(--agent-font);
  color: var(--agent-text);
}

.chat-mode-card:hover:not(.active) {
  border-color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
}

.chat-mode-card.active {
  border-color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  box-shadow: 0 0 0 1px var(--agent-accent) inset;
}

.chat-mode-card.locked {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-mode-card.locked:hover:not(.active) {
  border-color: var(--agent-border);
  background: var(--agent-hover-bg);
}

.chat-mode-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.chat-mode-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.chat-mode-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--agent-text);
}

.chat-mode-card.active .chat-mode-label {
  color: var(--agent-accent);
}

.chat-mode-desc {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  line-height: 1.3;
}

.usage-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.usage-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px;
  border-radius: var(--radius-mid);
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
}

.usage-value {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-primary);
  font-family: var(--agent-font-mono);
}

.usage-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  font-family: var(--agent-font);
  margin-top: 2px;
}

.usage-saved .usage-value {
  color: var(--success, #16a34a);
}

.usage-section-title {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-top: 8px;
  margin-bottom: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--agent-border);
}

.usage-cache-hit .usage-value {
  color: var(--success, #16a34a);
}



.mode-badge {
  display: inline-block;
  font-size: var(--text-micro-font-size);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  margin-left: 4px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.3px;
  vertical-align: middle;
}

.mode-tauri .mode-badge {
  background: var(--success-soft, rgba(46, 204, 113, 0.2));
  color: var(--success, #2ecc71);
  border: 1px solid color-mix(in srgb, var(--success, #2ecc71) 30%, transparent);
}

.mode-web .mode-badge {
  background: var(--info-soft, rgba(52, 152, 219, 0.2));
  color: var(--info, #3498db);
  border: 1px solid color-mix(in srgb, var(--info, #3498db) 30%, transparent);
}

.mode-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-mid);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font);
}

.mode-indicator.mode-tauri {
  background: var(--success-soft, rgba(46, 204, 113, 0.1));
  border: 1px solid color-mix(in srgb, var(--success, #2ecc71) 25%, transparent);
  color: var(--success, #2ecc71);
}

.mode-indicator.mode-web {
  background: var(--info-soft, rgba(52, 152, 219, 0.1));
  border: 1px solid color-mix(in srgb, var(--info, #3498db) 25%, transparent);
  color: var(--info, #3498db);
}

.terminal-mode-display {
  justify-content: center;
  padding: 4px 0;
}

.settings-btn-secondary {
  background: transparent;
  border: 1px solid var(--agent-border);
  color: var(--agent-text-secondary);
}

.settings-btn-secondary:hover {
  background: var(--danger-soft, rgba(231, 76, 60, 0.1));
  border-color: color-mix(in srgb, var(--danger, #dc2626) 30%, transparent);
  color: var(--danger);
}

.cli-capabilities-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.cli-cap-category {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
}

.cli-cap-category-name {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
}

.cli-cap-tool-count {
  font-size: var(--fs-xs);
  color: var(--agent-text-secondary);
  background: var(--info-soft, rgba(52, 152, 219, 0.1));
  padding: 1px 6px;
  border-radius: var(--radius-xs);
}

.settings-btn {
  flex: 1;
  padding: 8px 14px;
  border: 1px solid var(--agent-border);
  border-radius: var(--radius-mid);
  background: var(--agent-hover-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.settings-btn:hover {
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  border-color: var(--agent-primary);
}

.sp-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-bottom: 4px;
  font-family: var(--agent-font);
}

.cp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s;
  font-size: var(--font-size-sm);
  color: var(--agent-text);
}

.cp-item:hover {
  background: var(--agent-hover-bg);
}

.cp-item.active {
  background: var(--agent-accent-bg);
}

.cp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--agent-font);
}

.cp-model {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  flex-shrink: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-delete {
  background: none;
  border: none;
  color: var(--agent-text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  opacity: 0;
  transition: opacity 0.15s;
  padding: 0 2px;
}

.cp-item:hover .cp-delete {
  opacity: 1;
}

.cp-delete:hover {
  color: var(--danger, #e74c3c);
}

.cp-save-btn {
  width: 100%;
  padding: 6px;
  margin-top: 4px;
  border: 1px dashed var(--agent-border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--agent-text);
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: border-color 0.15s;
}

.cp-save-btn:hover:not(:disabled) {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
}

.cp-save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cp-model-field {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.cp-model-field .settings-select,
.cp-model-field .settings-input {
  flex: 1;
  min-width: 0;
}

.cp-fetch-btn {
  background: none;
  border: 1px solid var(--agent-border-color);
  border-radius: var(--radius-sm);
  color: var(--agent-text);
  cursor: pointer;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}

.cp-fetch-btn:hover:not(:disabled) {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
}

.cp-fetch-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cp-fetch-error {
  font-size: var(--font-size-xs);
  color: var(--danger, #e74c3c);
  padding: 2px 0 0 0;
}

.provider-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.provider-list-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 1px solid var(--agent-border);
  border-radius: var(--radius-sm);
  background: var(--agent-hover-bg);
  color: var(--agent-text-secondary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  font-size: var(--font-size-2xs, 11px);
  white-space: nowrap;
}

.provider-list-item:hover {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
  background: var(--agent-accent-bg);
}

.provider-list-item.active {
  border-color: var(--agent-primary);
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  box-shadow: 0 0 0 1px var(--agent-primary) inset;
}

.provider-list-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex-shrink: 0;
}

.provider-list-label {
  line-height: 1;
}
</style>

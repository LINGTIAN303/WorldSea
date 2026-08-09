<template>
  <div class="space-navbar">
    <div class="navbar-left">
      <!-- 单聊模式：PanelToggle + Agent身份 -->
      <template v-if="spaceStore.mode === 'chat'">
        <PanelToggle
          :rotation="panelRotation"
          :session-open="panelSessionOpen"
          :knowledge-open="panelKnowledgeOpen"
          @click="emit('togglePanelClick')"
          @longpress="emit('togglePanelLongPress')"
        />
        <div class="agent-identity" ref="identityRef">
          <AvatarBadge
            class="agent-avatar"
            :avatar="spaceStore.persona.avatar"
            :name="agentName"
            :color="profile.accentColor"
            :font-family="fontFamily"
            :size="32"
            @click.stop="togglePersonaPopover"
          />
          <div class="agent-info">
            <span class="agent-name" :style="{ fontFamily: fontStore.prefs.agent.family || fontFamily || undefined }">{{ agentName }}</span>
            <span class="agent-status"><WsIcon v-if="moodIcon" :name="moodIcon" size="xs" /> {{ moodLabel }}</span>
          </div>
        </div>
      </template>

      <!-- 群聊模式：用户身份 -->
      <template v-else>
        <div class="user-identity" ref="userIdentityRef">
          <div class="user-avatar" @click.stop="toggleUserProfilePopover">
            <AvatarBadge
              :avatar="userProfileStore.profile.avatar"
              :name="userProfileStore.profile.nickname"
              color="linear-gradient(135deg, #10b981, #34d399)"
              :size="32"
            />
            <span class="user-status-dot" :style="{ background: userProfileStore.statusColor }"></span>
          </div>
          <div class="user-info">
            <span class="user-nickname">{{ userProfileStore.profile.nickname }}</span>
            <span class="user-status-text">{{ userProfileStore.statusLabel }}</span>
          </div>
        </div>
      </template>

      <div class="mode-dropdown-wrap" ref="dropdownWrapRef">
        <button v-if="sessionChatMode !== null && spaceStore.mode === 'chat'" class="mode-dropdown-btn locked" disabled>
          <span class="mode-dropdown-icon"><WsIcon :name="currentMode.icon" size="xs" /></span>
          <span class="mode-dropdown-label">{{ currentMode.label }}</span>
          <span class="mode-lock-icon"><WsIcon name="lock" size="xs" /></span>
        </button>
        <button v-else class="mode-dropdown-btn" @click.stop="personaPopoverOpen = false; modeDropdownOpen = !modeDropdownOpen">
          <span class="mode-dropdown-icon"><WsIcon :name="currentMode.icon" size="xs" /></span>
          <span class="mode-dropdown-label">{{ currentMode.label }}</span>
          <span class="mode-dropdown-arrow">▾</span>
        </button>
      </div>
    </div>

    <div class="navbar-center">
      <div class="center-row">
        <!-- 单聊 ⇄ 群聊 模式切换（群聊 UI 骨架 2026-08-09） -->
        <div class="mode-switch" role="button" tabindex="0" :title="spaceStore.mode === 'chat' ? '切换群聊' : '切换单聊'"
          @click="emit('toggleMode')" @keydown.enter.prevent="emit('toggleMode')" @keydown.space.prevent="emit('toggleMode')">
          <span class="mode-switch-label" :class="{ on: spaceStore.mode === 'group' }">
            <WsIcon :name="spaceStore.mode === 'chat' ? 'chat' : 'users'" size="xs" />
            {{ spaceStore.mode === 'chat' ? '单聊' : '群聊' }}
          </span>
        </div>
        <button class="new-session-btn" @click="emit('toggleNewSession')" title="新建会话">+</button>
      </div>
      <div v-if="currentSessionName" class="current-session" :title="currentSessionName">{{ currentSessionName }}</div>
    </div>

    <div class="navbar-right">
      <!-- 群聊模式专属入口（2026-08-09）：Agent 管理 + Provider 池管理 -->
      <template v-if="spaceStore.mode === 'group'">
        <button
          class="nav-btn"
          :class="{ active: showAgentManager }"
          @click="toggleAgentManager"
          title="Agent 管理"
          ref="agentManagerBtnRef"
        ><WsIcon name="bot" size="sm" /></button>
        <button
          class="nav-btn"
          @click="showProviderSlots = true"
          title="Provider 池管理"
        ><WsIcon name="key" size="sm" /></button>
        <span class="nav-divider"></span>
      </template>
      <!-- 对话上下文组：记忆架 -->
      <button
        class="nav-btn"
        :class="{ active: spaceStore.configPanel === 'memory' }"
        @click="spaceStore.toggleConfigPanel('memory')"
        title="记忆架"
      ><WsIcon name="brain" size="sm" /></button>
      <span class="nav-divider"></span>
      <!-- 运行组：执行面板入口（带运行徽标） -->
      <button
        class="nav-btn"
        :class="{ active: spaceStore.execPanelOpen }"
        @click="spaceStore.toggleExecPanel()"
        title="运行面板（轨迹/活动/计划）"
      ><WsIcon name="chart" size="sm" /><span v-if="spaceStore.activityPinned" class="nav-badge"></span></button>
      <span class="nav-divider"></span>
      <!-- 知识墙组：知识墙入口（Agent 设置已迁入主设置，2026-08-09） -->
      <button
        class="nav-btn"
        :class="{ active: spaceStore.leftPanel === 'knowledge' }"
        @click="emit('toggleKnowledge')"
        title="知识墙"
      ><WsIcon name="book" size="sm" /></button>
      <!-- 更多菜单：低频入口 -->
      <div class="more-wrap" ref="moreWrapRef">
        <button
          class="nav-btn"
          :class="{ active: moreMenuOpen }"
          @click="toggleMoreMenu"
          title="更多"
        ><WsIcon name="more-horizontal" size="sm" /></button>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="popover">
        <div v-if="personaPopoverOpen" class="persona-popover-overlay" @click.self="personaPopoverOpen = false">
          <div class="persona-popover" :style="popoverStyle" @click.stop>
            <PersonaMirror @close="personaPopoverOpen = false" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="popover">
        <div v-if="userProfilePopoverOpen" class="persona-popover-overlay" @click.self="userProfilePopoverOpen = false">
          <div class="persona-popover" :style="userProfilePopoverStyle" @click.stop>
            <UserProfilePopover @close="userProfilePopoverOpen = false" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 群聊模式专属浮层（2026-08-09）：Provider 池编辑 + Agent 管理 -->
    <ProviderSlotEditor v-if="showProviderSlots" @close="showProviderSlots = false" />
    <AgentManagerPanel :visible="showAgentManager" :anchor-rect="agentManagerBtnRect" @close="showAgentManager = false" />

    <Teleport to="body">
      <div v-if="modeDropdownOpen" class="mode-dropdown-backdrop" @click="modeDropdownOpen = false"></div>
    </Teleport>

    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="modeDropdownOpen" class="mode-dropdown-menu" :style="dropdownMenuStyle">
          <button
            v-for="m in chatModes"
            :key="m.value"
            class="mode-dropdown-item"
            :class="{ active: (spaceStore.mode === 'group' ? spaceStore.groupChatMode : spaceStore.chatMode) === m.value, disabled: sessionChatMode !== null && spaceStore.mode === 'chat' }"
            @click.stop="onModeSelect(m.value)"
          >
            <span class="mode-item-icon"><WsIcon :name="m.icon" size="sm" /></span>
            <div class="mode-item-text">
              <span class="mode-item-label">{{ m.label }}</span>
              <span class="mode-item-desc">{{ m.desc }}</span>
            </div>
          </button>
        </div>
      </Transition>
    </Teleport>
    <Teleport to="body">
      <div v-if="moreMenuOpen" class="more-backdrop" @click="moreMenuOpen = false"></div>
    </Teleport>

    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="moreMenuOpen" class="more-menu" :style="moreMenuStyle">
          <button class="more-item" @click="onMore('workbench')"><WsIcon name="monitor" size="sm" /><span>工作台（抽屉）</span></button>
          <button class="more-item" @click="onMore('switch')"><WsIcon name="home" size="sm" /><span>切换到工作台主界面</span></button>
          <button class="more-item" @click="onMore('settings')"><WsIcon name="pencil" size="sm" /><span>全局设置</span></button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useSpaceStore, type ChatMode, type GroupChatMode } from './stores/space-store'
import { useUserProfileStore } from './stores/user-profile-store'
import { useAgentPersona } from './composables/useAgentPersona'
import { usePersonaFont } from './composables/usePersonaFont'
import { useFontStore } from '@/stores/fontStore'
import { useAgent } from '@/agent/composables/useAgent'
import { getSession } from '@agent/session/manager'
import PersonaMirror from './panels/PersonaMirror.vue'
import UserProfilePopover from './panels/UserProfilePopover.vue'
import { WsIcon } from '@worldsmith/ui-kit'
import AvatarBadge from '@/ui/AvatarBadge.vue'
import PanelToggle from './PanelToggle.vue'
// 群聊模式专属入口（2026-08-09 群聊 UI 骨架恢复后迁移）
import ProviderSlotEditor from './group-chat/components/ProviderSlotEditor.vue'
import AgentManagerPanel from './group-chat/components/AgentManagerPanel.vue'

const { fontFamily, profile } = usePersonaFont()
const fontStore = useFontStore()
const { currentSessionId } = useAgent()
// 会话锁定模式：Rust 端无此概念（深度模式经 thinkingLevel 控制），恒 null 不锁定
const sessionChatMode = ref<ChatMode | null>(null)

const props = defineProps<{
  panelRotation: 'session' | 'knowledge'
  panelSessionOpen: boolean
  panelKnowledgeOpen: boolean
}>()

const emit = defineEmits<{
  togglePanelClick: []
  togglePanelLongPress: []
  toggleNewSession: []
  toggleKnowledge: []
  toggleMode: []
  openWorkbench: []
  switchToWorkbench: []
  openSettings: []
}>()

const spaceStore = useSpaceStore()
const userProfileStore = useUserProfileStore()
const { agentName, moodIcon, moodLabel } = useAgentPersona()


const personaPopoverOpen = ref(false)
const userProfilePopoverOpen = ref(false)
const modeDropdownOpen = ref(false)
// 群聊模式专属状态（2026-08-09 迁移）
const showProviderSlots = ref(false)
const showAgentManager = ref(false)
const agentManagerBtnRef = ref<HTMLElement>()
const agentManagerBtnRect = ref<DOMRect>()

function toggleAgentManager(): void {
  if (showAgentManager.value) {
    showAgentManager.value = false
  } else {
    if (agentManagerBtnRef.value) {
      agentManagerBtnRect.value = agentManagerBtnRef.value.getBoundingClientRect()
    }
    showAgentManager.value = true
  }
}
const moreMenuOpen = ref(false)
const moreWrapRef = ref<HTMLElement>()
const moreMenuStyle = ref<Record<string, string>>({ top: '56px', right: '16px' })

const identityRef = ref<HTMLElement>()
const userIdentityRef = ref<HTMLElement>()
const dropdownWrapRef = ref<HTMLElement>()

const currentSessionName = ref('')

async function updateSessionInfo() {
  if (currentSessionId.value) {
    const s = await getSession(currentSessionId.value)
    currentSessionName.value = s?.name || ''
  } else {
    currentSessionName.value = ''
  }
}

watch(currentSessionId, () => { updateSessionInfo() })

const chatModes = computed(() => {
  // 群聊模式：会议/闲聊 两个子模式（2026-08-09 迁移）
  if (spaceStore.mode === 'group') {
    return [
      { value: 'meeting' as const, icon: 'clipboard-list', label: '会议模式', desc: '有序讨论，深度发言，适合决策和评审' },
      { value: 'casual' as const, icon: 'coffee', label: '闲聊模式', desc: '自由发言，简短互动，像微信群一样聊天' },
    ]
  }
  return [
    { value: 'normal' as const, icon: 'chat', label: '快问快答', desc: '快答为主，按需调用工具' },
    { value: 'deep' as const, icon: 'brain', label: '深度思考', desc: '深度推理 + 工具验证 + 结构化推理链' },
    { value: 'explore' as const, icon: 'search', label: '知识探索', desc: '知识库 → 联网搜索 → 项目数据 → 模型知识' },
    { value: 'task' as const, icon: 'play', label: '任务执行', desc: '自主规划 + 连续执行 + 验证重试，动手把事做完' },
  ]
})

const currentMode = computed(() => {
  if (spaceStore.mode === 'group') {
    return chatModes.value.find(m => m.value === spaceStore.groupChatMode) || chatModes.value[1]
  }
  return chatModes.value.find(m => m.value === spaceStore.chatMode) || chatModes.value[0]
})

function onModeSelect(mode: string) {
  if (spaceStore.mode === 'group') {
    spaceStore.setGroupChatMode(mode as GroupChatMode)
  } else {
    if (sessionChatMode.value !== null) return
    spaceStore.setChatMode(mode as ChatMode)
  }
  modeDropdownOpen.value = false
}

const dropdownMenuStyle = computed(() => {
  const el = dropdownWrapRef.value
  if (!el) return { top: '56px', left: '200px' }
  const rect = el.getBoundingClientRect()
  return {
    top: `${rect.bottom + 6}px`,
    left: `${rect.left}px`,
  }
})

const popoverStyle = ref<Record<string, string>>({ top: '56px', left: '16px' })

const userProfilePopoverStyle = ref<Record<string, string>>({ top: '56px', left: '16px' })

function updatePopoverPosition() {
  const el = identityRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  popoverStyle.value = {
    top: `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
  }
}

function updateUserProfilePopoverPosition() {
  const el = userIdentityRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  userProfilePopoverStyle.value = {
    top: `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
  }
}

function togglePersonaPopover() {
  personaPopoverOpen.value = !personaPopoverOpen.value
  modeDropdownOpen.value = false
  userProfilePopoverOpen.value = false
  moreMenuOpen.value = false
  if (personaPopoverOpen.value) {
    updatePopoverPosition()
  }
}

function toggleUserProfilePopover() {
  userProfilePopoverOpen.value = !userProfilePopoverOpen.value
  modeDropdownOpen.value = false
  personaPopoverOpen.value = false
  moreMenuOpen.value = false
  if (userProfilePopoverOpen.value) {
    updateUserProfilePopoverPosition()
  }
}

function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value
  modeDropdownOpen.value = false
  personaPopoverOpen.value = false
  userProfilePopoverOpen.value = false
  if (moreMenuOpen.value) {
    const el = moreWrapRef.value
    if (el) {
      const rect = el.getBoundingClientRect()
      moreMenuStyle.value = {
        top: `${rect.bottom + 6}px`,
        right: `${Math.max(8, window.innerWidth - rect.right)}px`,
      }
    }
  }
}

function onMore(action: 'workbench' | 'switch' | 'settings') {
  moreMenuOpen.value = false
  if (action === 'workbench') emit('openWorkbench')
  else if (action === 'switch') emit('switchToWorkbench')
  else emit('openSettings')
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (modeDropdownOpen.value) {
    if (!target.closest('.mode-dropdown-wrap') && !target.closest('.mode-dropdown-backdrop')) {
      modeDropdownOpen.value = false
    }
  }
  if (moreMenuOpen.value) {
    if (!target.closest('.more-wrap') && !target.closest('.more-backdrop')) {
      moreMenuOpen.value = false
    }
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  updateSessionInfo()
  window.addEventListener('ws-session-title-updated', updateSessionInfo)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('ws-session-title-updated', updateSessionInfo)
})
</script>

<style scoped>
.space-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background: var(--color-surface-elevated);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  gap: 12px;
  position: relative;
  z-index: 100;
}

.navbar-left, .navbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.navbar-left {
  justify-content: flex-start;
}

.navbar-right {
  justify-content: flex-end;
}

.navbar-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: none;
  line-height: 1;
}

.center-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 单聊 ⇄ 群聊 模式切换（群聊 UI 骨架 2026-08-09） */
.mode-switch {
  display: flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.mode-switch:hover {
  background: var(--color-bg-active, var(--color-surface));
  border-color: var(--color-border-strong);
}
.mode-switch:focus-visible {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.mode-switch-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--color-text-secondary);
  line-height: 1;
  transition: color 0.15s;
}
.mode-switch-label.on {
  color: var(--color-accent);
  font-weight: 600;
}

.new-session-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  padding: 0;
}
.new-session-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.current-session {
  font-size: 10px;
  color: var(--color-text-tertiary);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
  margin-top: 1px;
}

.mode-switch {
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  padding: 4px 8px;
  border-radius: 8px;
  transition: background 0.15s;
}
.mode-switch:hover {
  background: var(--color-surface);
}

.mode-switch-track {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.mode-switch-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.mode-text-enter-active {
  transition: background 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.mode-text-leave-active {
  transition: background 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1), filter 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.mode-text-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.mode-text-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.agent-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 8px;
}

.user-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.user-identity:hover {
  background: var(--color-surface);
}

.user-avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981, #34d399);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.user-avatar:hover {
  transform: scale(1.08);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

.user-avatar-letter {
  color: white;
  font-weight: 600;
  font-size: var(--font-size-base);
}

.user-status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--color-surface-elevated);
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.user-nickname {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}

.user-status-text {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.agent-avatar {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.agent-avatar:hover {
  transform: scale(1.08);
  box-shadow: 0 0 0 3px var(--color-primary-muted);
}

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.agent-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}

.agent-status {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.mode-dropdown-wrap {
  position: relative;
  margin-left: 4px;
}

.mode-dropdown-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  white-space: nowrap;
}

.mode-dropdown-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.mode-dropdown-icon {
  font-size: var(--font-size-sm);
  line-height: 1;
}

.mode-dropdown-label {
  font-weight: 500;
}

.mode-dropdown-arrow {
  font-size: 10px;
  opacity: 0.5;
  margin-left: 2px;
}

.mode-dropdown-menu {
  position: fixed;
  min-width: 220px;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 4px;
  z-index: 10001;
}

.mode-dropdown-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
  color: var(--color-text-secondary);
}

.mode-dropdown-btn.locked {
  opacity: 0.7;
  cursor: default;
  border-color: var(--color-border);
}

.mode-dropdown-btn.locked:hover {
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}

.mode-lock-icon {
  font-size: 10px;
  margin-left: 2px;
  opacity: 0.6;
}

.mode-dropdown-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.mode-dropdown-item:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.mode-dropdown-item.active {
  background: var(--color-primary-muted);
  color: var(--color-text);
}

.mode-item-icon {
  font-size: var(--font-size-lg);
  line-height: 1;
  margin-top: 2px;
  flex-shrink: 0;
}

.mode-item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mode-item-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.mode-item-desc {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  line-height: 1.3;
}

.mode-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.more-wrap {
  position: relative;
}

.more-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.more-menu {
  position: fixed;
  min-width: 180px;
  background: var(--color-surface-elevated);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 4px;
  z-index: 10001;
}

.more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}

.more-item:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.nav-btn {
  position: relative;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

/* 运行徽标（生成中活动红点） */
.nav-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger, #ef4444);
  animation: nav-badge-pulse 1.6s infinite;
}

@keyframes nav-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.nav-btn:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-muted);
}
.nav-btn:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
}
.nav-btn.active {
  background: var(--color-primary-muted);
  color: var(--color-text-primary);
}

.nav-divider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 4px;
}

.persona-popover-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.persona-popover {
  position: fixed;
  width: 340px;
  max-height: 70vh;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow-y: auto;
  z-index: 10000;
}

.popover-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.popover-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.popover-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.99);
}

.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>

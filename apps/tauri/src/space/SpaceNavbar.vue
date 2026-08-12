<template>
  <div class="space-navbar">
    <div class="navbar-left">
      <!-- 单聊模式：PanelToggle + Agent身份 -->
      <template v-if="spaceStore.mode === 'chat'">
        <PanelToggle
          :open="panelSessionOpen"
          @click="emit('togglePanelClick')"
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

      <!-- 模式选择：分段滑块（2026-08-09 由下拉改滑块；单聊四模式 / 群聊两模式） -->
      <TuiSegmented
        v-model="modeModel"
        :options="modeOptions"
        :disabled="sessionChatMode !== null && spaceStore.mode === 'chat'"
        icon-mode
        class="mode-segmented"
      />
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
      </template>
      <!-- 右侧栏开关（执行/配置 合并，2026-08-12）：图标为与左侧相反的右侧栏图标，带运行徽标 -->
      <button
        class="nav-btn"
        :class="{ active: spaceStore.rightPanelOpen }"
        @click="spaceStore.toggleRightPanel()"
        title="右侧栏（执行/配置）"
      ><WsIcon :name="spaceStore.rightPanelOpen ? 'panel-right-close' : 'panel-right-open'" size="sm" /><span v-if="spaceStore.activityPinned" class="nav-badge"></span></button>
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
      <div v-if="moreMenuOpen" class="more-backdrop" @click="moreMenuOpen = false"></div>
    </Teleport>

    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="moreMenuOpen" class="more-menu" :style="moreMenuStyle">
          <button class="more-item" @click="onMore()"><WsIcon name="pencil" size="sm" /><span>全局设置</span></button>
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
import TuiSegmented from '@/components/ui/TuiSegmented.vue'
// 群聊模式专属入口（2026-08-09 群聊 UI 骨架恢复后迁移）
import ProviderSlotEditor from './group-chat/components/ProviderSlotEditor.vue'
import AgentManagerPanel from './group-chat/components/AgentManagerPanel.vue'

const { fontFamily, profile } = usePersonaFont()
const fontStore = useFontStore()
const { currentSessionId } = useAgent()
// 会话锁定模式：Rust 端无此概念（深度模式经 thinkingLevel 控制），恒 null 不锁定
const sessionChatMode = ref<ChatMode | null>(null)

const props = defineProps<{
  panelSessionOpen: boolean
}>()

const emit = defineEmits<{
  togglePanelClick: []
  toggleNewSession: []
  toggleMode: []
  openSettings: []
}>()

const spaceStore = useSpaceStore()
const userProfileStore = useUserProfileStore()
const { agentName, moodIcon, moodLabel } = useAgentPersona()


const personaPopoverOpen = ref(false)
const userProfilePopoverOpen = ref(false)
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

// ── 模式分段滑块（2026-08-09 由下拉改滑块）──
// 选项源：单聊三模式（快问快答已移除，2026-08-12）/ 群聊两模式（消费 {value,label,icon}）
// iconMode：图标常驻 + 单级文字
const chatModes = computed(() => {
  // 群聊模式：会议/闲聊 两个子模式（2026-08-09 迁移）
  if (spaceStore.mode === 'group') {
    return [
      { value: 'meeting' as const, label: '会议', icon: 'users' },
      { value: 'casual' as const, label: '闲聊', icon: 'chat' },
    ]
  }
  return [
    { value: 'deep' as const, label: '深度思考', icon: 'bulb' },
    { value: 'explore' as const, label: '知识探索', icon: 'book' },
    { value: 'task' as const, label: '任务执行', icon: 'task' },
  ]
})

const modeOptions = computed(() => chatModes.value)

// 双向模型：读当前模式，写时按 mode 分流写 store（群聊写 groupChatMode，单聊写 chatMode）
const modeModel = computed({
  get: () => (spaceStore.mode === 'group' ? spaceStore.groupChatMode : spaceStore.chatMode),
  set: (v: string) => {
    if (spaceStore.mode === 'group') {
      spaceStore.setGroupChatMode(v as GroupChatMode)
    } else {
      if (sessionChatMode.value !== null) return
      spaceStore.setChatMode(v as ChatMode)
    }
  },
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
  userProfilePopoverOpen.value = false
  moreMenuOpen.value = false
  if (personaPopoverOpen.value) {
    updatePopoverPosition()
  }
}

function toggleUserProfilePopover() {
  userProfilePopoverOpen.value = !userProfilePopoverOpen.value
  personaPopoverOpen.value = false
  moreMenuOpen.value = false
  if (userProfilePopoverOpen.value) {
    updateUserProfilePopoverPosition()
  }
}

function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value
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

function onMore() {
  moreMenuOpen.value = false
  emit('openSettings')
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
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
  background: var(--bg-muted);
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

/* 单聊 ⇄ 群聊 模式切换（2026-08-12）：默认填充激活，悬停时填充向外扩散到空心 */
.mode-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  gap: 4px;
  border-radius: 999px;
  background: transparent;
  border: none;
  color: var(--switch-bg);
  cursor: pointer;
  overflow: hidden;
  transition: color 0.5s ease;
}
/* 填充层：默认覆盖整个胶囊（激活填充），悬停时向外扩散并淡出，露出空心。
   border-radius: inherit 让填充匹配胶囊形状，避免水平椭圆 */
.mode-switch::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 118%;
  height: 118%;
  border-radius: inherit;
  background: var(--switch-bg);
  transform: translate(-50%, -50%) scale(1);
  z-index: 1;
  transition: transform 0.5s ease, opacity 0.5s ease;
}
.mode-switch:hover::after {
  transform: translate(-50%, -50%) scale(1.7);
  opacity: 0;
}
.mode-switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.mode-switch-label {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-2xs);
  font-weight: 600;
  color: var(--switch-fg);
  line-height: 1;
  transition: color 0.5s ease;
}
/* 填充散开变空心后，文字随之切换为主文字色，保证在各主题下对比度 */
.mode-switch:hover .mode-switch-label,
.mode-switch:hover .mode-switch-label.on {
  color: var(--text-primary);
}

.new-session-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
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
  font-size: var(--fs-2xs);
  color: var(--color-text-tertiary);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
  margin-top: 1px;
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
  border-radius: var(--radius-mid);
}

.user-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: var(--radius-mid);
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 20%, transparent);
}

.user-avatar-letter {
  color: var(--on-accent);
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

/* 模式分段滑块（2026-08-09 由下拉改滑块）：紧凑适配 48px 顶栏 */
.mode-segmented {
  margin-left: 4px;
}
.mode-segmented :deep(.tui-seg__item) {
  padding: 4px 10px;
  font-size: var(--font-size-xs);
}
/* iconMode 下：图标与文字间距微调，保持顶栏紧凑 */
.mode-segmented :deep(.tui-seg.is-icon-mode .tui-seg__item) {
  gap: 4px;
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
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-mid);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-2xl);
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

/* ── 减弱动态偏好（prefers-reduced-motion）：停用徽标脉冲与头像/文字位移 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
@media (prefers-reduced-motion: reduce) {
  .nav-badge {
    animation: none;
  }
  .user-avatar,
  .user-avatar:hover,
  .agent-avatar,
  .agent-avatar:hover {
    transform: none;
  }
  .mode-text-enter-from,
  .mode-text-leave-to {
    transform: none;
  }
}
</style>

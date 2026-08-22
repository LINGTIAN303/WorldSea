<template>
  <div class="group-topbar">
    <!-- 左：用户身份 -->
    <div class="topbar-left">
      <div class="user-identity" ref="userIdentityRef">
        <div class="user-avatar" @click.stop="toggleUserProfilePopover">
          <AvatarBadge
            :avatar="userProfileStore.profile.avatar"
            :name="userProfileStore.profile.nickname"
            color="var(--user-avatar-grad)"
            :size="32"
          />
          <span class="user-status-dot" :style="{ background: userProfileStore.statusColor }"></span>
        </div>
        <div class="user-info">
          <span class="user-nickname">{{ userProfileStore.profile.nickname }}</span>
          <span class="user-status-text">{{ userProfileStore.statusLabel }}</span>
        </div>
      </div>
    </div>

    <!-- 中：群聊模式分段滑块 + 单群聊切换 -->
    <div class="topbar-center">
      <div class="center-row">
        <TuiSegmented
          v-model="modeModel"
          :options="modeOptions"
          icon-mode
          class="mode-segmented"
        />
        <div class="mode-switch" role="button" tabindex="0" title="切换单聊" @click="emit('toggle-mode')">
          <WsIcon name="users" size="xs" />群聊
        </div>
      </div>
    </div>

    <!-- 右：Agent 管理 / Provider 池 / 右栏 / 更多 -->
    <div class="topbar-right">
      <button class="topbar-btn" :class="{ active: showAgentManager }" @click="toggleAgentManager" title="Agent 管理" ref="agentManagerBtnRef"><WsIcon name="bot" size="sm" /></button>
      <button class="topbar-btn" @click="showProviderSlots = true" title="Provider 池管理"><WsIcon name="key" size="sm" /></button>
      <button class="topbar-btn" :class="{ active: spaceStore.rightPanelOpen }" @click="emit('toggle-right-panel')" title="右侧栏（执行/配置/创作/预览）"><WsIcon :name="spaceStore.rightPanelOpen ? 'panel-right-close' : 'panel-right-open'" size="sm" /><span v-if="spaceStore.activityPinned" class="nav-badge"></span></button>
      <div class="more-wrap" ref="moreWrapRef">
        <button class="topbar-btn" :class="{ active: moreMenuOpen }" @click.stop="toggleMoreMenu" title="更多"><WsIcon name="more-horizontal" size="sm" /></button>
      </div>
    </div>

    <!-- 用户资料浮窗 -->
    <Teleport to="body">
      <Transition name="popover">
        <div v-if="userProfilePopoverOpen" class="popover-overlay" @click.self="userProfilePopoverOpen = false">
          <div class="popover" :style="userProfilePopoverStyle" @click.stop>
            <UserProfilePopover @close="userProfilePopoverOpen = false" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 群聊浮层：Provider 池编辑 + Agent 管理 -->
    <ProviderSlotEditor v-if="showProviderSlots" @close="showProviderSlots = false" />
    <AgentManagerPanel :visible="showAgentManager" :anchor-rect="agentManagerBtnRect" @close="showAgentManager = false" />

    <Teleport to="body">
      <div v-if="moreMenuOpen" class="more-backdrop" @click="moreMenuOpen = false"></div>
    </Teleport>
    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="moreMenuOpen" class="more-menu" :style="moreMenuStyle">
          <button class="more-item" @click="onMore()"><WsIcon name="settings" size="sm" /><span>全局设置</span></button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSpaceStore, type GroupChatMode } from '../../stores/space-store'
import { useUserProfileStore } from '../../stores/user-profile-store'
import { WsIcon } from '@worldsmith/ui-kit'
import AvatarBadge from '@/ui/AvatarBadge.vue'
import TuiSegmented from '@/components/ui/TuiSegmented.vue'
import UserProfilePopover from '../../panels/UserProfilePopover.vue'
import ProviderSlotEditor from './ProviderSlotEditor.vue'
import AgentManagerPanel from './AgentManagerPanel.vue'

const emit = defineEmits<{ 'toggle-mode': []; 'toggle-right-panel': []; 'open-settings': [] }>()

const spaceStore = useSpaceStore()
const userProfileStore = useUserProfileStore()

// ── 群聊模式分段滑块（会议 / 闲聊）──
const modeOptions = [
  { value: 'meeting' as const, label: '会议', icon: 'users' },
  { value: 'casual' as const, label: '闲聊', icon: 'chat' },
]
const modeModel = computed({
  get: () => spaceStore.groupChatMode,
  set: (v: string) => spaceStore.setGroupChatMode(v as GroupChatMode),
})

// ── 用户资料浮窗 ──
const userProfilePopoverOpen = ref(false)
const userIdentityRef = ref<HTMLElement>()
const userProfilePopoverStyle = ref<Record<string, string>>({ top: '56px', left: '16px' })
function toggleUserProfilePopover() {
  userProfilePopoverOpen.value = !userProfilePopoverOpen.value
  moreMenuOpen.value = false
  if (userProfilePopoverOpen.value) {
    const el = userIdentityRef.value
    if (el) {
      const rect = el.getBoundingClientRect()
      userProfilePopoverStyle.value = { top: `${rect.bottom + 8}px`, left: `${rect.left}px` }
    }
  }
}

// ── Agent 管理 / Provider 池 ──
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

// ── 更多菜单 ──
const moreMenuOpen = ref(false)
const moreWrapRef = ref<HTMLElement>()
const moreMenuStyle = ref<Record<string, string>>({ top: '56px', right: '16px' })
function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value
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
  emit('open-settings')
}
</script>

<style scoped>
.group-topbar {
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
.topbar-left, .topbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.topbar-left { justify-content: flex-start; }
.topbar-right { justify-content: flex-end; }
.topbar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.center-row { display: flex; align-items: center; gap: 10px; }

.user-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: var(--radius-mid);
}
.user-avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--user-avatar-grad);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
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
.user-info { display: flex; flex-direction: column; gap: 1px; }
.user-nickname { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); }
.user-status-text { font-size: var(--font-size-xs); color: var(--color-text-secondary); }

/* 单聊⇄群聊 标（当前在群聊，显示群聊填充态） */
.mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--switch-bg);
  border: none;
  color: var(--switch-fg);
  cursor: pointer;
  font-size: var(--fs-2xs);
  font-weight: 600;
}
.mode-switch:hover { filter: brightness(1.1); }

.topbar-btn {
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
}
.topbar-btn:hover { background: var(--color-surface); color: var(--color-text-primary); }
.topbar-btn.active { background: var(--color-primary-muted); color: var(--color-text-primary); }

.nav-badge {
  position: absolute;
  top: 5px; right: 5px;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--danger, #ef4444);
  animation: pulse 1.6s infinite;
}
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }

.popover-overlay { position: fixed; inset: 0; z-index: 9999; }
.popover {
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
.more-wrap { position: relative; }
.more-backdrop { position: fixed; inset: 0; z-index: 10000; }
.more-menu {
  position: fixed;
  min-width: 160px;
  background: var(--color-surface-elevated);
  backdrop-filter: blur(16px);
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
.more-item:hover { background: var(--color-surface); color: var(--color-text); }

.popover-enter-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.popover-leave-active { transition: opacity 0.1s ease, transform 0.1s ease; }
.popover-enter-from { opacity: 0; transform: translateY(-8px) scale(0.97); }
.popover-leave-to { opacity: 0; transform: translateY(-4px) scale(0.99); }
.dropdown-enter-active { transition: opacity 0.12s ease, transform 0.12s ease; }
.dropdown-leave-active { transition: opacity 0.08s ease, transform 0.08s ease; }
.dropdown-enter-from { opacity: 0; transform: translateY(-4px); }
.dropdown-leave-to { opacity: 0; transform: translateY(-2px); }

@media (prefers-reduced-motion: reduce) {
  .nav-badge { animation: none; }
}
</style>
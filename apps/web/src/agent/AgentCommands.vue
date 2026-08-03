<template>
  <Transition name="ws-menu">
    <div v-if="menuOpen" class="agent-menu agent-panel">
      <div class="menu-header">
        <span>功能菜单</span>
        <button @click="closeMenu">✕</button>
      </div>
      <div class="menu-body">
        <div class="menu-section">
          <div class="menu-section-label">会话</div>
          <button class="menu-item" @click="onNewSession">
            <span class="mi-icon"><WsIcon name="edit" size="sm" /></span>
            <span class="mi-label">新建会话</span>
          </button>
          <button class="menu-item" @click="onToggleSessions">
            <span class="mi-icon"><WsIcon name="manuscript" size="sm" /></span>
            <span class="mi-label">会话管理</span>
          </button>
        </div>
        <div class="menu-section">
          <div class="menu-section-label">WorldSmith</div>
          <button class="menu-item" @click="onSkill('overview')">
            <span class="mi-icon"><WsIcon name="outline" size="sm" /></span>
            <span class="mi-label">数据概览</span>
          </button>
          <button class="menu-item" @click="onSkill('check')">
            <span class="mi-icon"><WsIcon name="check" size="sm" /></span>
            <span class="mi-label">一致性检查</span>
          </button>
          <button class="menu-item" @click="onSkill('report')">
            <span class="mi-icon"><WsIcon name="dashboard" size="sm" /></span>
            <span class="mi-label">每日报告</span>
          </button>
        </div>
        <div class="menu-section">
          <div class="menu-section-label">设置</div>
          <button class="menu-item" @click="onOpenSettings">
            <span class="mi-icon"><WsIcon name="settings" size="sm" /></span>
            <span class="mi-label">AI 助手设置</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useAgentCommands } from './composables/useAgentCommands'
import { useAgent } from './composables/useAgent'
import { WsIcon } from '@worldsmith/ui-kit'

const { menuOpen, closeMenu, toggleSessions, openSettings, commands } = useAgentCommands()
const { newSession } = useAgent()

function onNewSession(): void {
  closeMenu()
  newSession()
}

function onToggleSessions(): void {
  toggleSessions()
  closeMenu()
}

function onOpenSettings(): void {
  openSettings()
  closeMenu()
}

function onSkill(id: string): void {
  closeMenu()
  const cmd = commands.value.find(c => c.id === id)
  if (cmd) cmd.handler()
}
</script>

<style scoped>
.agent-menu {
  position: fixed;
  bottom: 64px;
  right: 24px;
  width: 220px;
  background: var(--agent-bg, rgba(26, 26, 46, 0.92));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  border-radius: var(--agent-radius, 14px);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10001;
  overflow: hidden;
  pointer-events: auto;
}

.menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  font-family: var(--agent-font, sans-serif);
}

.menu-header button {
  background: none;
  border: none;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
}

.menu-body { padding: 6px }
.menu-section { margin-bottom: 4px }

.menu-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  padding: 4px 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--agent-font, sans-serif);
}

.menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px;
  border: none; border-radius: var(--agent-radius-sm, 8px);
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  cursor: pointer; font-size: var(--font-size-sm); text-align: left;
  transition: background 0.1s;
  font-family: var(--agent-font, sans-serif);
}

.menu-item:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)) }

.mi-icon { font-size: var(--font-size-base) }
.mi-label { font-weight: var(--font-weight-medium) }


</style>

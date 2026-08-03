<template>
  <div class="sub-panel">
    <!-- CLI Agent 连接配置 -->
    <div class="settings-section">
      <div class="settings-label">CLI Agent 连接</div>
      <div class="settings-row terminal-mode-display">
        <span class="mode-indicator" :class="cliAgent.connected ? 'mode-tauri' : 'mode-web'">
          <WsIcon :name="cliAgent.connected ? 'check-circle' : 'circle'" size="sm" />
          {{ cliAgent.connected ? '已连接' : '未连接' }}
        </span>
        <span v-if="cliAgent.connected && cliAgent.capabilities" class="settings-hint" style="margin-left: 8px">
          {{ cliAgent.capabilities.toolCount }} 工具可用
        </span>
      </div>
      <div class="settings-hint">
        {{ cliAgent.connected
          ? `已连接到 CLI Agent (${cliAgent.status.url})，本地能力已激活`
          : '连接 CLI Agent 以启用本地能力（Shell、Git、文件操作、Lint/Test/Build 等）'
        }}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">服务地址</div>
      <div class="settings-row">
        <input
          type="text"
          class="settings-input"
          :value="cliAgent.cliUrl"
          @change="onCliUrlChange"
          placeholder="http://localhost:3100"
          aria-label="CLI Agent 服务地址"
        />
      </div>
      <div class="settings-hint">CLI Agent Server 地址（worldsmith serve 启动）</div>
    </div>

    <div class="settings-section">
      <div class="settings-row" style="gap: 8px">
        <button class="settings-btn" :disabled="cliAgent.connecting" @click="onCliAgentConnect">
          {{ cliAgent.connecting ? '连接中...' : (cliAgent.connected ? '重新连接' : '连接') }}
        </button>
        <button v-if="cliAgent.connected" class="settings-btn settings-btn-secondary" @click="cliAgent.disconnect()">
          断开
        </button>
      </div>
      <div v-if="cliAgent.error" class="settings-hint" style="color: #e74c3c">{{ cliAgent.error }}</div>
    </div>

    <!-- 连接成功后显示能力分类 -->
    <div v-if="cliAgent.connected && cliAgent.capabilities" class="settings-section">
      <div class="settings-label">可用能力</div>
      <div class="cli-capabilities-grid">
        <div v-for="(tools, category) in cliAgent.capabilities.categories" :key="category" class="cli-cap-category">
          <div class="cli-cap-category-name">{{ getCategoryLabel(category as string) }}</div>
          <div class="cli-cap-tool-count">{{ (tools as string[]).length }} 工具</div>
        </div>
      </div>
    </div>

    <!-- 原有终端配置（兼容） -->
    <div class="settings-section">
      <div class="settings-label">运行模式</div>
      <div class="settings-row terminal-mode-display">
        <span class="mode-indicator" :class="isTauriMode ? 'mode-tauri' : 'mode-web'">
          <WsIcon :name="isTauriMode ? 'keyboard' : 'globe'" size="sm" /> {{ isTauriMode ? 'Tauri 桌面模式' : 'Web 应用模式' }}
        </span>
      </div>
      <div class="settings-hint">
        {{ isTauriMode
          ? '当前通过 Tauri 原生 PTY 调用本地终端，无需额外服务'
          : '当前通过 WebSocket 连接 worldsmith-server 调用终端，需启动后端服务'
        }}
      </div>
    </div>
    <div v-if="!isTauriMode" class="settings-section">
      <div class="settings-label">WebSocket 服务地址</div>
      <div class="settings-row">
        <input
          type="text"
          class="settings-input"
          :value="wsServerUrl"
          @change="onWsUrlChange"
          placeholder="ws://localhost:3100"
          aria-label="WebSocket 服务地址"
        />
      </div>
      <div class="settings-hint">修改后需重新打开终端生效</div>
    </div>
    <div class="settings-section">
      <div class="settings-row">
        <button class="settings-btn" :disabled="terminalConnecting" @click="onOpenTerminal">
          {{ terminalConnecting ? '连接中...' : (isTauriMode ? '打开本地终端' : '打开远程终端') }}
        </button>
      </div>
      <div v-if="terminalConnectError" class="settings-hint" style="color: #e74c3c">{{ terminalConnectError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { isTauri as detectTauri, getWsUrl, resetExecutionAdapter, createExecutionAdapter } from '@agent/execution'
import { useCliAgent } from '../composables/useCliAgent'

const emit = defineEmits<{
  'open-terminal': []
}>()

const isTauriMode = computed(() => detectTauri())
const wsServerUrl = ref(getWsUrl())
const terminalConnecting = ref(false)
const terminalConnectError = ref('')

// CLI Agent 连接（全局单例）
const cliAgent = reactive(useCliAgent())

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    shell: 'Shell 终端',
    git: 'Git 版本控制',
    file: '文件操作',
    project: '项目命令',
    system: '系统信息',
  }
  return labels[category] || category
}

async function onCliAgentConnect() {
  await cliAgent.connect()
}

function onCliUrlChange(e: Event) {
  const input = e.target as HTMLInputElement
  cliAgent.updateUrl(input.value)
}

async function checkTerminalConnection(): Promise<boolean> {
  const adapter = await createExecutionAdapter()
  if (adapter.isAvailable()) return true
  terminalConnecting.value = true
  terminalConnectError.value = ''
  try {
    const connected = await adapter.tryConnect()
    if (connected) return true

    if (!detectTauri()) {
      try {
        const resp = await fetch('/api/launch-server', { method: 'POST' })
        const data = await resp.json()
        if (data.ok) {
          await new Promise(r => setTimeout(r, 1000))
          resetExecutionAdapter()
          const newAdapter = await createExecutionAdapter()
          const reconnected = await newAdapter.tryConnect()
          if (reconnected) return true
        }
      } catch {}
    }

    terminalConnectError.value = '连接失败，请确认 worldsmith-server 已启动'
    return false
  } catch (err) {
    terminalConnectError.value = err instanceof Error ? err.message : '连接出错'
    return false
  } finally {
    terminalConnecting.value = false
  }
}

async function onOpenTerminal(): Promise<void> {
  const connected = await checkTerminalConnection()
  if (connected) {
    emit('open-terminal')
  }
}

function onWsUrlChange(e: Event): void {
  const input = e.target as HTMLInputElement
  const url = input.value.trim()
  wsServerUrl.value = url
  try {
    localStorage.setItem('ws_server_url', url)
  } catch {}
  resetExecutionAdapter()
  terminalConnectError.value = ''
}
</script>

<template>
  <div class="sub-panel">
    <div class="mcp-list">
      <div v-for="conn in mcpConnections" :key="conn.id" class="mcp-item" :class="{ disabled: !conn.config.enabled }">
        <span class="mcp-status"><WsIcon :name="conn.status === 'connected' ? 'check' : conn.status === 'connecting' ? 'timeline' : conn.status === 'error' ? 'close' : 'grip'" size="xs" /></span>
        <div class="mcp-info">
          <span class="mcp-name">{{ conn.config.name }}</span>
          <span class="mcp-desc">{{ conn.config.transport === 'stdio' ? conn.config.command : conn.config.url }}</span>
        </div>
        <button class="mcp-delete-btn" @click="emit('remove-mcp', conn.id)" title="删除"><WsIcon name="delete" size="xs" /></button>
        <button class="skill-toggle" @click="emit('toggle-mcp', conn.id)" :title="conn.config.enabled ? '点击禁用' : '点击启用'">
          <WsIcon :name="conn.config.enabled ? 'check' : 'close'" size="xs" />
        </button>
      </div>
    </div>
    <div v-if="mcpAdding" class="mcp-add-form">
      <div class="settings-row">
        <span class="sp-row-label">名称</span>
        <input type="text" class="settings-input" v-model="mcpForm.name" placeholder="My MCP Server" aria-label="名称" />
      </div>
      <div class="settings-row">
        <span class="sp-row-label">传输</span>
        <select class="settings-select" v-model="mcpForm.transport">
          <option value="streamable-http">HTTP/SSE</option>
          <option value="stdio">stdio</option>
        </select>
      </div>
      <div v-if="mcpForm.transport !== 'stdio'" class="settings-row">
        <span class="sp-row-label">URL</span>
        <input type="text" class="settings-input" v-model="mcpForm.url" placeholder="http://localhost:3000/mcp" />
      </div>
      <template v-else>
        <div class="settings-row">
          <span class="sp-row-label">Command</span>
          <input type="text" class="settings-input" v-model="mcpForm.command" placeholder="npx" />
        </div>
        <div class="settings-row">
          <span class="sp-row-label">Args</span>
          <input type="text" class="settings-input" v-model="mcpForm.argsStr" placeholder="-y @mcp/server-filesystem /tmp" />
        </div>
      </template>
      <div class="mcp-add-actions">
        <button class="sub-panel-btn" @click="emit('add-mcp', mcpFormData)">确认</button>
        <button class="sub-panel-btn" @click="mcpAdding = false">取消</button>
      </div>
    </div>
    <button v-else class="sub-panel-btn" @click="mcpAdding = true" style="width:100%">+ 手动添加</button>
    <div class="mcp-presets">
      <div class="mcp-presets-title">官方预设</div>
      <div class="mcp-presets-grid">
        <button v-for="(preset, idx) in MCP_PRESETS" :key="preset.name"
          class="preset-btn" :class="{ added: mcpPresetAdded[idx] }"
          @click="addPreset(preset)" :disabled="mcpPresetAdded[idx]">
          <span class="preset-name">{{ preset.name }}</span>
          <span class="preset-desc">{{ preset.desc }}</span>
        </button>
      </div>
    </div>
    <div class="settings-hint">MCP 服务扩展 AI 助手的外部工具能力</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { MCPConnectionConfig } from '@agent/index'

const props = defineProps<{
  mcpConnections: Array<{ id: string; config: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[]; enabled: boolean }; status: string; tools: unknown[]; error?: string }>
}>()

const emit = defineEmits<{
  'toggle-mcp': [serverId: string]
  'add-mcp': [config: any]
  'remove-mcp': [serverId: string]
}>()

const mcpAdding = ref(false)
const mcpForm = ref({
  name: '',
  transport: 'streamable-http' as 'streamable-http' | 'stdio',
  url: '',
  command: '',
  argsStr: '',
})

// MCP 官方预设列表
const MCP_PRESETS = [
  { id: 'firecrawl-keyless', name: 'Firecrawl Keyless', transport: 'streamable-http' as const, url: 'https://mcp.firecrawl.dev/v2/mcp', argsStr: '', desc: '免 Key 网页搜索/抓取/爬取（每月 1000 credits）' },
  { name: 'Filesystem', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-filesystem C:\\Users', desc: '安全文件操作' },
  { name: 'Git', transport: 'stdio' as const, command: 'uvx', argsStr: 'mcp-server-git', desc: 'Git 仓库操作' },
  { name: 'Fetch', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-fetch', desc: '网页内容抓取' },
  { name: 'Memory', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-memory', desc: '知识图谱持久记忆' },
  { name: 'Sequential Thinking', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-sequentialthinking', desc: '动态反思推理' },
  { name: 'Time', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-time', desc: '时间与时区转换' },
  { name: 'Brave Search', transport: 'stdio' as const, command: 'npx', argsStr: '-y @brave/brave-search-mcp-server', desc: 'Brave 搜索引擎' },
  { name: 'SQLite', transport: 'stdio' as const, command: 'uvx', argsStr: 'mcp-server-sqlite', desc: 'SQLite 数据库' },
  { name: 'Puppeteer', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-puppeteer', desc: '浏览器自动化' },
]

const mcpPresetAdded = computed(() => {
  const ids = new Set(props.mcpConnections.map(c => c.config.id))
  const names = new Set(props.mcpConnections.map(c => c.config.name))
  return MCP_PRESETS.map(p => (p.id ? ids.has(p.id) : names.has(p.name)))
})

function addPreset(preset: typeof MCP_PRESETS[number]): void {
  const id = preset.id || `mcp-preset-${preset.name.toLowerCase().replace(/\s+/g, '-')}`
  const config: MCPConnectionConfig = {
    id,
    name: preset.name,
    transport: preset.transport,
    enabled: true,
  }
  if (preset.transport === 'stdio') {
    config.command = preset.command
    config.args = preset.argsStr.split(/\s+/).filter(Boolean)
  } else {
    config.url = preset.url
  }
  emit('add-mcp', config)
}

const mcpFormData = computed(() => ({
  id: `mcp-${Date.now()}`,
  name: mcpForm.value.name,
  transport: mcpForm.value.transport,
  url: mcpForm.value.transport !== 'stdio' ? mcpForm.value.url : undefined,
  command: mcpForm.value.transport === 'stdio' ? mcpForm.value.command : undefined,
  args: mcpForm.value.transport === 'stdio' ? mcpForm.value.argsStr.split(/\s+/).filter(Boolean) : undefined,
  enabled: true,
}))
</script>

<template>
  <div class="sub-panel">
    <div class="ms-cat-bar" role="tablist" aria-label="MCP 分类">
      <button
        v-for="c in MCP_CATS"
        :key="c.value"
        class="ms-cat" :class="{ on: activeMcpCat === c.value }"
        role="tab" :aria-selected="activeMcpCat === c.value"
        @click="activeMcpCat = c.value as McpCat"
      >{{ c.label }}<span class="ms-cat-count">{{ catMcpCount(c.value) }}</span></button>
    </div>
    <div class="mcp-list">
      <div v-for="conn in filteredConns" :key="conn.id" class="mcp-item" :class="{ disabled: !conn.config.enabled }">
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
        <TuiSelect :model-value="mcpForm.transport" :options="transportOptions" aria-label="传输" @update:model-value="mcpForm.transport = $event" />
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
      <div v-if="mcpForm.transport !== 'stdio'" class="settings-row">
        <span class="sp-row-label">Headers</span>
        <input type="text" class="settings-input" v-model="mcpForm.headersStr" placeholder="每行一个，如 Authorization: Bearer xxx 或 X-API-Key: abc" />
      </div>
      <div class="mcp-add-actions">
        <button class="sub-panel-btn" @click="emit('add-mcp', mcpFormData)">确认</button>
        <button class="sub-panel-btn" @click="mcpAdding = false">取消</button>
      </div>
    </div>
    <button v-else class="sub-panel-btn" @click="mcpAdding = true" style="width:100%">+ 手动添加</button>
    <div class="settings-hint">
      MCP 服务扩展 AI 助手的外部工具能力
      <template v-if="configPath">
        <br />配置文件（用户与 Agent 均可直接编辑，改动保存后需重连生效）：<br />
        <code class="mcp-config-path" :title="configPath">{{ configPath }}</code>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import TuiSelect from '../../components/ui/TuiSelect.vue'
import { invokeRpc } from '../composables/transport'

const props = defineProps<{
  mcpConnections: Array<{ id: string; config: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[]; enabled: boolean }; status: string; tools: unknown[]; error?: string }>
}>()

const emit = defineEmits<{
  'toggle-mcp': [serverId: string]
  'add-mcp': [config: any]
  'remove-mcp': [serverId: string]
}>()

// D 批：MCP 分类栏（按状态/启用）
type McpCat = 'all' | 'connected' | 'connecting' | 'error' | 'disabled'
const MCP_CATS = [
  { value: 'all', label: '全部' },
  { value: 'connected', label: '已连接' },
  { value: 'connecting', label: '连接中' },
  { value: 'error', label: '异常' },
  { value: 'disabled', label: '已禁用' },
]
const activeMcpCat = ref<McpCat>('all')
function mcpCategory(c: { config: { enabled: boolean }; status: string }): string {
  if (!c.config.enabled) return 'disabled'
  if (c.status === 'connected') return 'connected'
  if (c.status === 'connecting') return 'connecting'
  return 'error'
}
const filteredConns = computed(() => {
  if (activeMcpCat.value === 'all') return props.mcpConnections
  return props.mcpConnections.filter((c) => mcpCategory(c) === activeMcpCat.value)
})
function catMcpCount(cat: string): number {
  if (cat === 'all') return props.mcpConnections.length
  return props.mcpConnections.filter((c) => mcpCategory(c) === cat).length
}

const mcpAdding = ref(false)
const transportOptions = [
  { value: 'streamable-http', label: 'HTTP/SSE' },
  { value: 'stdio', label: 'stdio' },
]
const mcpForm = ref({
  name: '',
  transport: 'streamable-http',
  url: '',
  command: '',
  argsStr: '',
  headersStr: '',
})

// H6-③ 配置化拍板（2026-08-30）：官方预设已全部移除，MCP 不再拥有官方预设——
// 配置唯一事实源 = 全局单份 mcp.json（用户与 Agent 均可直接编辑）。
// 本面板仅展示配置文件路径（改动保存后需重连生效）；增删改经 cmd_mcp_* 命令写同一文件。
const configPath = ref('')
onMounted(async () => {
  try {
    const dataDir = await invokeRpc<string>('cmd_get_app_data_dir')
    if (dataDir) configPath.value = `${dataDir.replace(/[\\/]+$/, '')}/worldsea/mcp.json`
  } catch { /* 路径不可得时隐藏提示 */ }
})

const mcpFormData = computed(() => {
  // Headers 输入解析：每行 `Key: Value` → [键, 值] 数组（对齐 Rust Vec<(String,String)>）
  const headers: Array<[string, string]> = []
  for (const line of mcpForm.value.headersStr.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key) headers.push([key, val])
  }
  return {
    id: `mcp-${Date.now()}`,
    name: mcpForm.value.name,
    transport: mcpForm.value.transport,
    url: mcpForm.value.transport !== 'stdio' ? mcpForm.value.url : undefined,
    command: mcpForm.value.transport === 'stdio' ? mcpForm.value.command : undefined,
    args: mcpForm.value.transport === 'stdio' ? mcpForm.value.argsStr.split(/\s+/).filter(Boolean) : undefined,
    headers: mcpForm.value.transport !== 'stdio' && headers.length > 0 ? headers : undefined,
    enabled: true,
  }
})
</script>

<style scoped>
.ms-cat-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.mcp-config-path { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; padding: 1px 6px; border-radius: var(--radius-sm, 4px); border: 1px solid var(--agent-border); background: var(--agent-hover-bg); font-size: var(--font-size-2xs, 10px); color: var(--agent-text-secondary); }
.ms-cat {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: var(--radius-pill, 999px);
  border: 1px solid var(--color-border, var(--agent-border));
  background: var(--color-surface, var(--agent-hover-bg));
  color: var(--color-text-secondary, var(--agent-text-secondary));
  font-size: var(--font-size-xs);
  cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.ms-cat:hover { color: var(--color-text, var(--agent-text)); }
.ms-cat.on { border-color: var(--color-primary, var(--agent-primary)); color: var(--color-primary, var(--agent-primary)); background: color-mix(in srgb, var(--color-primary, var(--agent-primary)) 12%, transparent); }
.ms-cat-count { font-size: var(--font-size-2xs, 10px); opacity: 0.7; }
</style>

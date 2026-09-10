<template>
  <div class="mcp-panel">
    <!-- 状态分组列表（2026-09-10 结构调整）：按 已连接/连接中/异常/已禁用 分组，
         各组带小标题与计数，空组隐藏。取代原「分类 tab 筛选」形态。 -->
    <div v-if="props.mcpConnections.length" class="mcp-groups">
      <div v-for="g in groupedConns" :key="g.key" class="mcp-group">
        <div class="mcp-group-head">
          <span class="mcp-group-label" :class="'mcp-group-label--' + g.key">{{ g.label }}</span>
          <span class="mcp-group-count">{{ g.items.length }}</span>
        </div>
        <div class="mcp-list">
          <div v-for="conn in g.items" :key="conn.id" class="mcp-item" :class="{ disabled: !conn.config.enabled }">
            <span class="mcp-status" :class="'mcp-status--' + groupOf(conn)"><WsIcon :name="statusIcon(conn)" size="xs" /></span>
            <div class="mcp-info">
              <span class="mcp-name">{{ conn.config.name }}</span>
              <span class="mcp-desc" :title="conn.config.transport === 'stdio' ? conn.config.command : conn.config.url">{{ conn.config.transport === 'stdio' ? conn.config.command : conn.config.url }}</span>
              <!-- 错误详情：异常组内直接展开，免去额外点击 -->
              <span v-if="conn.error" class="mcp-error" :title="conn.error">{{ conn.error }}</span>
            </div>
            <button class="mcp-delete-btn" @click="emit('remove-mcp', conn.id)" title="删除"><WsIcon name="delete" size="xs" /></button>
            <button class="skill-toggle" @click="emit('toggle-mcp', conn.id)" :title="conn.config.enabled ? '点击禁用' : '点击启用'">
              <WsIcon :name="conn.config.enabled ? 'check' : 'close'" size="xs" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- 无服务器时的空状态 -->
    <WsEmpty v-else preset="no-connection" title="暂无 MCP 服务器" description="点击下方「手动添加」接入外部工具源，或直接编辑配置文件。" />

    <div v-if="mcpAdding" class="mcp-add-form">
      <div class="set-row">
        <span class="sp-row-label">名称</span>
        <input type="text" class="set-input" v-model="mcpForm.name" placeholder="My MCP Server" aria-label="名称" />
      </div>
      <div class="set-row">
        <span class="sp-row-label">传输</span>
        <TuiSelect :model-value="mcpForm.transport" :options="transportOptions" aria-label="传输" @update:model-value="mcpForm.transport = $event" />
      </div>
      <div v-if="mcpForm.transport !== 'stdio'" class="set-row">
        <span class="sp-row-label">URL</span>
        <input type="text" class="set-input" v-model="mcpForm.url" placeholder="http://localhost:3000/mcp" />
      </div>
      <template v-else>
        <div class="set-row">
          <span class="sp-row-label">Command</span>
          <input type="text" class="set-input" v-model="mcpForm.command" placeholder="npx" />
        </div>
        <div class="set-row">
          <span class="sp-row-label">Args</span>
          <input type="text" class="set-input" v-model="mcpForm.argsStr" placeholder="-y @mcp/server-filesystem /tmp" />
        </div>
      </template>
      <div v-if="mcpForm.transport !== 'stdio'" class="set-row">
        <span class="sp-row-label">Headers</span>
        <input type="text" class="set-input" v-model="mcpForm.headersStr" placeholder="每行一个，如 Authorization: Bearer xxx 或 X-API-Key: abc" />
      </div>
      <div class="mcp-add-actions">
        <button class="set-btn" @click="emit('add-mcp', mcpFormData)">确认</button>
        <button class="set-btn" @click="mcpAdding = false">取消</button>
      </div>
    </div>
    <button v-else class="set-btn set-btn--block" @click="mcpAdding = true">+ 手动添加</button>
    <div class="set-hint">
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
import { WsIcon, WsEmpty } from '@worldsea/ui-kit'
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

// 状态判定（分类唯一口径：未启用优先归「已禁用」）
type McpGroupKey = 'connected' | 'connecting' | 'error' | 'disabled'
function groupOf(c: { config: { enabled: boolean }; status: string }): McpGroupKey {
  if (!c.config.enabled) return 'disabled'
  if (c.status === 'connected') return 'connected'
  if (c.status === 'connecting') return 'connecting'
  return 'error'
}

const GROUP_DEFS: Array<{ key: McpGroupKey; label: string }> = [
  { key: 'connected', label: '已连接' },
  { key: 'connecting', label: '连接中' },
  { key: 'error', label: '异常' },
  { key: 'disabled', label: '已禁用' },
]

/** 按状态分组；空组直接过滤掉，避免出现「已连接 0」这类噪声行 */
const groupedConns = computed(() =>
  GROUP_DEFS
    .map(g => ({ ...g, items: props.mcpConnections.filter(c => groupOf(c) === g.key) }))
    .filter(g => g.items.length > 0)
)

/** 状态图标（组内各行沿用同一状态图标） */
function statusIcon(conn: { config: { enabled: boolean }; status: string }): string {
  switch (groupOf(conn)) {
    case 'connected': return 'check'
    case 'connecting': return 'timeline'
    case 'error': return 'close'
    default: return 'grip'
  }
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
/* 注：.set-row/.set-input/.set-btn/.set-hint 来自 settings-panels.css 基座（勿在此复制） */

.mcp-groups { display: flex; flex-direction: column; gap: 10px; }

/* 分组小标题：左标签 + 右计数 */
.mcp-group-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.mcp-group-label { font-size: var(--font-size-2xs, 10px); font-weight: var(--font-weight-semibold); text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary, var(--color-text-tertiary)); }
/* 组标签按状态着色（与状态图标同色系） */
.mcp-group-label--connected { color: var(--color-success, #4ade80); }
.mcp-group-label--connecting { color: var(--color-info, #60a5fa); }
.mcp-group-label--error { color: var(--color-error, #f87171); }
.mcp-group-count { font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }

.mcp-list { display: flex; flex-direction: column; gap: 4px; }
.mcp-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm, 4px); background: var(--bg-muted, var(--agent-hover-bg)); }
.mcp-item.disabled { opacity: 0.55; }
.mcp-status { display: inline-flex; flex-shrink: 0; }
.mcp-status--connected { color: var(--color-success, #4ade80); }
.mcp-status--connecting { color: var(--color-info, #60a5fa); }
.mcp-status--error { color: var(--color-error, #f87171); }
.mcp-status--disabled { color: var(--text-tertiary, var(--color-text-tertiary)); }
.mcp-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.mcp-name { font-size: var(--font-size-sm); color: var(--text-primary, var(--color-text)); }
.mcp-desc { font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 错误详情（异常组内展开显示） */
.mcp-error { font-size: var(--font-size-2xs, 10px); color: var(--color-error, #f87171); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcp-delete-btn { background: none; border: none; color: var(--text-tertiary, var(--color-text-tertiary)); cursor: pointer; padding: 2px; flex-shrink: 0; }
.mcp-delete-btn:hover { color: var(--color-error, #f87171); }

.mcp-add-form { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.sp-row-label { font-size: var(--font-size-xs); color: var(--text-secondary, var(--color-text-secondary)); min-width: 52px; flex-shrink: 0; }
.mcp-add-actions { display: flex; gap: 6px; margin-top: 6px; }

/* 配置文件路径（等宽小字，可悬停查看全路径） */
.mcp-config-path { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; padding: 1px 6px; border-radius: var(--radius-sm, 4px); border: 1px solid var(--border, var(--color-border)); background: var(--bg-muted, var(--agent-hover-bg)); font-size: var(--font-size-2xs, 10px); color: var(--text-secondary, var(--color-text-secondary)); }
</style>

<script setup lang="ts">
/**
 * McpPanel：MCP 服务器管理卡（全局设置 Agent 叠卡 idx=2；独立悬浮 Agent 面板同用）
 *
 * 分层约束（docs/details/注释/packages/ui-kit/settings-panels-convention.md）：
 * - 本组件是卡内内容，不写 .sc-head（标题由宿主 AgentSettingsPanel 提供）
 * - 控件只用基座类（.set-input/.set-btn/.set-row/.set-hint），业务行样式 scoped 自包含
 * - 纯展示 + emit 上抛；分组/校验/构建等纯逻辑抽到 mcpForm.ts（可单测）
 * 状态来源：Rust M6 链路状态机（connected / reconnecting[连接中] / failed[连接失败]），
 * 经 mcp:status 事件实时刷新；工具明细展开时按需走 cmd_mcp_list_tools 懒加载。
 * 设计方案见 docs/plans/2026-09-17-MCP卡UI优化.md
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { WsEmpty, WsIcon } from '@worldsea/ui-kit'
import TuiButton from '@/components/ui/TuiButton.vue'
import TuiSelect from '@/components/ui/TuiSelect.vue'
import { toastError, toastSuccess, toastWarn } from '@/composables/useToast'
// 统一 invoke：Tauri 走原生 IPC，浏览器 preview 走 HTTP 桥（原 invokeRpc 在桌面端必抛错，路径永不显示）
import { invoke } from '../composables/transport'
import type { MCPConnectionConfig, MCPConnectionState, MCPToolInfo } from '@worldsea/agent-runtime'
import {
  MCP_TRANSPORT_OPTIONS,
  MCP_GROUPS,
  emptyMcpForm,
  validateMcpForm,
  isMcpFormValid,
  buildMcpConfig,
  configToForm,
  parseServerJson,
  slugifyId,
  stringifyFormAsJson,
  describeConfig,
  transportLabel,
  groupConnections,
  type McpFormState,
  type McpGroupKey,
} from './mcpForm'

const props = defineProps<{
  mcpConnections: MCPConnectionState[]
}>()

const emit = defineEmits<{
  'toggle-mcp': [serverId: string]
  'add-mcp': [config: MCPConnectionConfig]
  'save-mcp': [config: MCPConnectionConfig]
  'retry-mcp': [serverId: string]
  'remove-mcp': [serverId: string]
}>()

// ── 分组（已连接 / 连接中 / 连接失败 / 已禁用；空组不渲染标题） ──
const groups = computed(() => {
  const grouped = groupConnections(props.mcpConnections)
  return MCP_GROUPS.map((g) => ({ ...g, conns: grouped[g.key as McpGroupKey] })).filter(
    (g) => g.conns.length > 0,
  )
})

// ── 行展开 ──
const expandedIds = ref<Set<string>>(new Set())
function isExpanded(id: string): boolean {
  return expandedIds.value.has(id)
}
function toggleExpand(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
    // 展开已连接行时懒加载工具明细（loadTools 内部有缓存与并发保护）
    const conn = props.mcpConnections.find((c) => c.id === id)
    if (conn?.status === 'connected') void loadTools(id)
  }
  expandedIds.value = next
}

// ── 行级 pending（手动启停/重试的进行中态；后端 reconnecting 由状态机直接呈现） ──
const pendingIds = ref<Set<string>>(new Set())
const pendingSince = new Map<string, number>()
/** pending 最小展示时长，避免状态快速返回时 spinner 闪烁 */
const PENDING_MIN_MS = 600
function markPending(id: string): void {
  pendingSince.set(id, Date.now())
  pendingIds.value = new Set(pendingIds.value).add(id)
  // 兜底：20s 强制清除，防事件丢失导致 spinner 卡死
  setTimeout(() => {
    if (pendingIds.value.has(id)) clearPending(id)
  }, 20000)
}
function clearPending(id: string): void {
  const next = new Set(pendingIds.value)
  next.delete(id)
  pendingIds.value = next
  pendingSince.delete(id)
}
watch(
  () => props.mcpConnections,
  (list) => {
    if (!pendingIds.value.size) return
    for (const id of pendingIds.value) {
      const conn = list.find((c) => c.id === id)
      const since = pendingSince.get(id) ?? 0
      // 条目消失，或进入稳定态（非连接中）且超过最小展示时长 → 清除
      if (!conn) {
        clearPending(id)
      } else if (conn.status !== 'connecting' && Date.now() - since > PENDING_MIN_MS) {
        clearPending(id)
      }
    }
  },
  { deep: true },
)

/** 行是否处于忙碌态：本地手动操作进行中，或后端状态机处于 reconnecting */
function isBusy(conn: MCPConnectionState): boolean {
  return pendingIds.value.has(conn.id) || conn.status === 'connecting'
}
function onToggle(id: string): void {
  markPending(id)
  emit('toggle-mcp', id)
}
function onRetry(id: string): void {
  markPending(id)
  emit('retry-mcp', id)
}

/** 行首状态点配色（忙碌态统一显示连接中蓝色，模板中忙碌时改用旋转 spinner） */
function dotClass(conn: MCPConnectionState): string {
  if (!conn.config.enabled) return 'is-disabled'
  if (isBusy(conn)) return 'is-connecting'
  if (conn.status === 'connected') return 'is-connected'
  return 'is-error'
}

// ── 工具明细懒加载（展开已连接行时拉取，带缓存与手动刷新） ──
interface ToolsCacheEntry {
  state: 'loading' | 'ok' | 'error'
  tools?: MCPToolInfo[]
  message?: string
}
const toolsCache = ref<Record<string, ToolsCacheEntry>>({})
function toolsState(id: string): ToolsCacheEntry | undefined {
  return toolsCache.value[id]
}
async function loadTools(id: string, force = false): Promise<void> {
  if (!force && toolsCache.value[id]) return
  toolsCache.value = { ...toolsCache.value, [id]: { state: 'loading' } }
  try {
    const tools = await invoke<MCPToolInfo[]>('cmd_mcp_list_tools', { id })
    toolsCache.value = { ...toolsCache.value, [id]: { state: 'ok', tools } }
  } catch (e) {
    toolsCache.value = {
      ...toolsCache.value,
      [id]: { state: 'error', message: e instanceof Error ? e.message : String(e) },
    }
  }
}
/** 工具数：已加载明细以明细为准，否则用状态视图的 toolCount */
function toolCountOf(conn: MCPConnectionState): number {
  const cached = toolsCache.value[conn.id]
  if (cached?.state === 'ok') return cached.tools?.length ?? 0
  return conn.toolCount ?? 0
}

// 连接状态变化时维护展开态与工具缓存：
// - 条目被删除 → 收起展开行、清缓存
// - 从非 connected 恢复为 connected（重连成功）→ 失效旧工具缓存，展开中则自动重载
watch(
  () => props.mcpConnections,
  (list, oldList) => {
    const liveIds = new Set(list.map((c) => c.id))
    let cacheDirty = false
    const nextCache = { ...toolsCache.value }
    for (const id of Object.keys(nextCache)) {
      if (!liveIds.has(id)) {
        delete nextCache[id]
        cacheDirty = true
      }
    }
    if (cacheDirty) toolsCache.value = nextCache

    const keptExpanded = [...expandedIds.value].filter((id) => liveIds.has(id))
    if (keptExpanded.length !== expandedIds.value.size) {
      expandedIds.value = new Set(keptExpanded)
    }

    // 正在编辑的条目被删除（如从展开区删除）→ 关闭表单，避免保存时把已删除配置"复活"
    if (editingId.value && !liveIds.has(editingId.value)) {
      closeForm()
    }

    if (oldList) {
      for (const conn of list) {
        const prev = oldList.find((c) => c.id === conn.id)
        if (conn.status === 'connected' && prev && prev.status !== 'connected') {
          toolsCache.value = { ...toolsCache.value, [conn.id]: { state: 'loading' } }
          if (expandedIds.value.has(conn.id)) void loadTools(conn.id, true)
        }
      }
    }
  },
  { deep: true },
)

// ── 添加 / 编辑表单（卡内内联；表单 / 单条 JSON 双模式） ──
const mcpAdding = ref(false)
/** 编辑中的服务器 id；null 表示添加态 */
const editingId = ref<string | null>(null)
/** 编辑前的启用态（决定保存走 connect 重连还是仅 save 落盘） */
const editingEnabled = ref(true)
const form = reactive<McpFormState>(emptyMcpForm())
const touched = reactive<Record<keyof McpFormState, boolean>>({
  name: false, transport: false, url: false, command: false, args: false, headers: false,
})
const formErrors = computed(() => validateMcpForm(form))
function fieldError(key: keyof McpFormState): string {
  return touched[key] ? (formErrors.value[key] ?? '') : ''
}
function touchAll(): void {
  ;(Object.keys(touched) as Array<keyof McpFormState>).forEach((k) => { touched[k] = true })
}
function resetForm(): void {
  Object.assign(form, emptyMcpForm())
  ;(Object.keys(touched) as Array<keyof McpFormState>).forEach((k) => { touched[k] = false })
}

// 双模式（form / json）
type FormMode = 'form' | 'json'
const formMode = ref<FormMode>('form')
const jsonText = ref('')
const jsonError = ref('')
const formAreaRef = ref<HTMLElement | null>(null)

/** 把配置回填到表单（编辑预填 / JSON 切回表单共用） */
function applyConfigToForm(cfg: MCPConnectionConfig): void {
  Object.assign(form, configToForm(cfg))
  ;(Object.keys(touched) as Array<keyof McpFormState>).forEach((k) => { touched[k] = false })
}

function openAdd(): void {
  editingId.value = null
  editingEnabled.value = true
  resetForm()
  jsonText.value = ''
  jsonError.value = ''
  formMode.value = 'form'
  mcpAdding.value = true
}

/** 展开区「编辑」：预填原值（含 headers 原值），id 固定不可改 */
async function openEdit(conn: MCPConnectionState): Promise<void> {
  editingId.value = conn.id
  editingEnabled.value = conn.config.enabled
  applyConfigToForm(conn.config)
  jsonText.value = ''
  jsonError.value = ''
  formMode.value = 'form'
  mcpAdding.value = true
  await nextTick()
  // 表单在卡片底部，自动滚动到可视区（block:nearest 避免不必要的页面跳动）
  formAreaRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function closeForm(): void {
  resetForm()
  jsonText.value = ''
  jsonError.value = ''
  formMode.value = 'form'
  editingId.value = null
  mcpAdding.value = false
}

/** 模式切换：表单→JSON 序列化当前内容；JSON→表单解析回填（失败留在 JSON 模式显错） */
function switchMode(mode: FormMode): void {
  if (formMode.value === mode) return
  if (mode === 'json') {
    jsonError.value = ''
    jsonText.value = stringifyFormAsJson(form, {
      id: editingId.value ?? slugifyId(form.name),
      enabled: editingId.value ? editingEnabled.value : true,
    })
    formMode.value = 'json'
  } else {
    const r = parseServerJson(jsonText.value)
    if (r.errors.length || !r.config) {
      jsonError.value = r.errors.join('；')
      return
    }
    applyConfigToForm(r.config)
    jsonError.value = ''
    formMode.value = 'form'
  }
}

/** 确认（表单 / JSON 两模式统一入口；编辑态按启用状态分派 add 重连或 save 仅落盘） */
function confirmForm(): void {
  let cfg: MCPConnectionConfig | null = null
  if (formMode.value === 'form') {
    if (!isMcpFormValid(form)) { touchAll(); return }
    cfg = buildMcpConfig(
      form,
      editingId.value ? { id: editingId.value, enabled: editingEnabled.value } : {},
    )
  } else {
    const r = parseServerJson(jsonText.value)
    if (r.errors.length || !r.config) {
      jsonError.value = r.errors.join('；')
      return
    }
    cfg = r.config
    if (r.warnings.length) toastWarn(r.warnings.join('；'))
    if (editingId.value) {
      // 编辑态 id 不可改、启用态沿用原值
      cfg = { ...cfg, id: editingId.value, enabled: editingEnabled.value }
    }
  }
  if (editingId.value) {
    if (editingEnabled.value) emit('add-mcp', cfg)
    else emit('save-mcp', cfg)
  } else {
    emit('add-mcp', cfg)
  }
  closeForm()
}

/** TuiSelect 载荷是 string，桥接到联合类型字段 */
const formTransport = computed<string>({
  get: () => form.transport,
  set: (v) => { form.transport = v as MCPConnectionConfig['transport'] },
})

// ── 配置文件路径（只读提示 + 复制） ──
const configPath = ref('')
onMounted(async () => {
  try {
    const dir = await invoke<string>('cmd_get_app_data_dir')
    configPath.value = `${dir.replace(/[\\/]+$/, '')}/worldsea/mcp.json`
  } catch {
    // 取不到路径时静默隐藏（不阻塞卡片）
    configPath.value = ''
  }
})
async function copyPath(): Promise<void> {
  if (!configPath.value) return
  await copyText(configPath.value, true)
  toastSuccess('配置路径已复制')
}
/** 通用复制（项目统一走 navigator.clipboard，Tauri WebView 原生支持） */
async function copyText(text: string, silent = false): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    if (!silent) toastSuccess('已复制')
  } catch {
    toastError('复制失败，请手动选择文本复制')
  }
}
</script>

<template>
  <div class="mcp-panel">
    <!-- 分组列表 -->
    <div class="mcp-groups">
      <div v-for="g in groups" :key="g.key" class="mcp-group">
        <div class="mcp-group-head">
          <span class="mcp-group-label" :class="`is-${g.key}`">{{ g.label }}</span>
          <span class="mcp-group-count">{{ g.conns.length }}</span>
        </div>
        <div class="mcp-list">
          <div v-for="conn in g.conns" :key="conn.id" class="mcp-row-wrap">
            <!-- 行本体（整行点击展开；内部按钮 stop 阻止冒泡） -->
            <div
              class="mcp-item"
              :class="{ 'is-disabled': !conn.config.enabled, 'is-expanded': isExpanded(conn.id) }"
              @click="toggleExpand(conn.id)"
            >
              <!-- 忙碌态旋转 spinner，否则状态色点 -->
              <WsIcon
                v-if="isBusy(conn)"
                name="loading"
                :size="13"
                class="mcp-status-icon is-connecting mcp-spin"
              />
              <span v-else class="mcp-dot" :class="dotClass(conn)" />
              <div class="mcp-info">
                <div class="mcp-name-row">
                  <span class="mcp-name" :title="conn.config.name">{{ conn.config.name }}</span>
                  <span class="mcp-tag">{{ transportLabel(conn.config.transport) }}</span>
                </div>
                <div class="mcp-desc" :title="describeConfig(conn.config)">
                  {{ describeConfig(conn.config) }}
                </div>
              </div>
              <!-- 工具数徽标（仅已连接） -->
              <span
                v-if="conn.status === 'connected' && toolCountOf(conn) > 0"
                class="mcp-tool-badge"
              >
                {{ toolCountOf(conn) }} 工具
              </span>
              <!-- 连接失败行内快捷重试 -->
              <button
                v-if="g.key === 'error' && !isBusy(conn)"
                class="mcp-row-retry"
                title="重试连接"
                @click.stop="onRetry(conn.id)"
              >
                <WsIcon name="refresh" :size="12" :stroke-width="2" />
              </button>
              <button
                class="skill-toggle"
                :class="{ enabled: conn.config.enabled }"
                :title="conn.config.enabled ? '点击停用' : '点击启用'"
                @click.stop="onToggle(conn.id)"
              >
                <WsIcon :name="conn.config.enabled ? 'check' : 'close'" :size="12" :stroke-width="2.5" />
              </button>
              <WsIcon
                :name="isExpanded(conn.id) ? 'chevron-down' : 'chevron-right'"
                :size="13"
                class="mcp-chevron"
              />
            </div>

            <!-- 展开详情 -->
            <div v-if="isExpanded(conn.id)" class="mcp-detail" @click.stop>
              <!-- 连接中 -->
              <div v-if="isBusy(conn)" class="mcp-busy-bar">
                <WsIcon name="loading" :size="12" class="mcp-spin" />
                <span>{{ conn.status === 'connecting' ? '连接中，正在自动重试…' : '正在连接…' }}</span>
              </div>
              <!-- 连接失败：错误原因 + 重试 -->
              <div v-else-if="g.key === 'error'" class="mcp-error-bar">
                <WsIcon name="alert" :size="13" class="mcp-error-icon" />
                <span class="mcp-error-text" :title="conn.error">
                  {{ conn.error || '配置已启用但尚未连接，可重试连接' }}
                </span>
                <TuiButton size="sm" variant="danger-ghost" icon="refresh" @click="onRetry(conn.id)">
                  重试连接
                </TuiButton>
              </div>

              <!-- 参数明细 -->
              <dl class="mcp-meta">
                <div class="mcp-meta-row">
                  <dt>传输</dt>
                  <dd>{{ transportLabel(conn.config.transport) }}</dd>
                </div>
                <div v-if="conn.config.url" class="mcp-meta-row">
                  <dt>URL</dt>
                  <dd class="mcp-mono">
                    <span class="mcp-meta-text" :title="conn.config.url">{{ conn.config.url }}</span>
                    <button class="mcp-mini-btn" title="复制 URL" @click="copyText(conn.config.url ?? '')">
                      <WsIcon name="copy" :size="11" :stroke-width="1.8" />
                    </button>
                  </dd>
                </div>
                <div v-if="conn.config.command" class="mcp-meta-row">
                  <dt>命令</dt>
                  <dd class="mcp-mono">
                    <span class="mcp-cmd">{{ conn.config.command }}</span>
                    <span v-for="(a, i) in conn.config.args ?? []" :key="i" class="mcp-arg-tag">{{ a }}</span>
                  </dd>
                </div>
                <div v-if="(conn.config.headers ?? []).length" class="mcp-meta-row">
                  <dt>请求头</dt>
                  <dd>
                    <span v-for="([k], i) in conn.config.headers" :key="i" class="mcp-header-tag">{{ k }}</span>
                    <span class="mcp-header-note">值已隐藏</span>
                  </dd>
                </div>
              </dl>

              <!-- 工具清单（仅已连接；懒加载） -->
              <div v-if="conn.status === 'connected'" class="mcp-tools">
                <div class="mcp-tools-head">
                  <span class="mcp-tools-title">可用工具（{{ toolCountOf(conn) }}）</span>
                  <button class="mcp-mini-btn" title="重新加载工具列表" @click="loadTools(conn.id, true)">
                    <WsIcon name="refresh" :size="11" :stroke-width="1.8" />
                  </button>
                </div>
                <div v-if="!toolsState(conn.id) || toolsState(conn.id)?.state === 'loading'" class="mcp-tools-msg">
                  <WsIcon name="loading" :size="12" class="mcp-spin" />
                  <span>加载中…</span>
                </div>
                <div v-else-if="toolsState(conn.id)?.state === 'error'" class="mcp-tools-msg is-error">
                  <span>工具列表加载失败：{{ toolsState(conn.id)?.message }}</span>
                  <button class="mcp-link-btn" @click="loadTools(conn.id, true)">重试</button>
                </div>
                <template v-else>
                  <ul v-if="(toolsState(conn.id)?.tools ?? []).length" class="mcp-tool-list">
                    <li v-for="t in toolsState(conn.id)?.tools" :key="t.name" class="mcp-tool">
                      <code class="mcp-tool-name" :title="t.name">{{ t.name }}</code>
                      <span class="mcp-tool-desc" :title="t.description">{{ t.description || '无描述' }}</span>
                    </li>
                  </ul>
                  <div v-else class="mcp-tools-msg">未发现工具</div>
                </template>
              </div>

              <!-- 操作行（删除确认在编排层；编辑复用卡内表单） -->
              <div class="mcp-detail-actions">
                <TuiButton
                  size="sm"
                  variant="ghost"
                  icon="pencil"
                  @click="openEdit(conn)"
                >
                  编辑
                </TuiButton>
                <TuiButton
                  size="sm"
                  variant="danger-ghost"
                  icon="trash"
                  @click="emit('remove-mcp', conn.id)"
                >
                  删除
                </TuiButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空态：中性图标 + 主 CTA（空态时不再显示底部 block 按钮，避免重复） -->
    <WsEmpty
      v-if="!mcpConnections.length && !mcpAdding"
      preset="custom"
      title="暂无 MCP 服务器"
      description="添加 MCP 服务器以扩展工具能力，配置保存在 mcp.json，与 Claude Code 等工具兼容"
    >
      <template #icon>
        <WsIcon name="link" :size="32" :stroke-width="1.5" />
      </template>
      <template #action>
        <TuiButton size="sm" variant="secondary" icon="plus" @click="openAdd">手动添加</TuiButton>
      </template>
    </WsEmpty>

    <!-- 添加入口（非空时） -->
    <div v-if="mcpConnections.length" class="mcp-add-toggle">
      <button class="set-btn set-btn--block" @click="openAdd">+ 手动添加</button>
    </div>

    <!-- 添加 / 编辑表单（卡内内联；表单 / 单条 JSON 双模式） -->
    <div v-if="mcpAdding" ref="formAreaRef" class="mcp-form">
      <div class="mcp-form-head">
        <div class="mcp-form-title">{{ editingId ? '编辑 MCP 服务器' : '添加 MCP 服务器' }}</div>
        <div class="set-cats mcp-mode-cats">
          <button
            type="button"
            class="set-cat"
            :class="{ on: formMode === 'form' }"
            @click="switchMode('form')"
          >
            表单
          </button>
          <button
            type="button"
            class="set-cat"
            :class="{ on: formMode === 'json' }"
            @click="switchMode('json')"
          >
            JSON
          </button>
        </div>
      </div>

      <!-- 编辑态：id 固定不可改 -->
      <div v-if="editingId" class="set-row">
        <label class="sp-row-label">ID</label>
        <input class="set-input" :value="editingId" disabled title="ID 不可修改">
      </div>

      <!-- 表单模式 -->
      <template v-if="formMode === 'form'">
        <div class="set-row">
          <label class="sp-row-label">名称</label>
          <input
            v-model="form.name"
            class="set-input"
            placeholder="My MCP Server"
            @blur="touched.name = true"
          >
        </div>
        <div v-if="fieldError('name')" class="mcp-field-error mcp-field-error--row">
          {{ fieldError('name') }}
        </div>

        <div class="set-row">
          <label class="sp-row-label">传输</label>
          <TuiSelect v-model="formTransport" :options="MCP_TRANSPORT_OPTIONS" size="md" />
        </div>

        <template v-if="form.transport === 'stdio'">
          <div class="set-row">
            <label class="sp-row-label">Command</label>
            <input
              v-model="form.command"
              class="set-input"
              placeholder="npx"
              @blur="touched.command = true"
            >
          </div>
          <div v-if="fieldError('command')" class="mcp-field-error mcp-field-error--row">
            {{ fieldError('command') }}
          </div>
          <div class="set-row">
            <label class="sp-row-label">Args</label>
            <input
              v-model="form.args"
              class="set-input"
              placeholder="-y @xxx/mcp-server（空格分隔；含空格参数请用 JSON 模式）"
              @blur="touched.args = true"
            >
          </div>
        </template>

        <template v-else>
          <div class="set-row">
            <label class="sp-row-label">URL</label>
            <input
              v-model="form.url"
              class="set-input"
              placeholder="http://localhost:3000/mcp"
              @blur="touched.url = true"
            >
          </div>
          <div v-if="fieldError('url')" class="mcp-field-error mcp-field-error--row">
            {{ fieldError('url') }}
          </div>
          <div class="mcp-field-block">
            <label class="sp-row-label">Headers</label>
            <textarea
              v-model="form.headers"
              class="set-input mcp-textarea"
              rows="3"
              placeholder="每行一个，如 Authorization: Bearer xxx"
              @blur="touched.headers = true"
            />
          </div>
          <div v-if="fieldError('headers')" class="mcp-field-error">
            {{ fieldError('headers') }}
          </div>
        </template>
      </template>

      <!-- JSON 模式（单条服务器对象） -->
      <div v-else class="mcp-json-edit">
        <textarea
          v-model="jsonText"
          class="set-input mcp-textarea mcp-json-textarea"
          rows="11"
          spellcheck="false"
          placeholder='单条服务器对象，如&#10;{&#10;  "name": "my-server",&#10;  "transport": "streamable-http",&#10;  "url": "http://localhost:3000/mcp"&#10;}'
        ></textarea>
        <div v-if="jsonError" class="mcp-field-error">{{ jsonError }}</div>
        <div class="set-hint">
          单条服务器对象；也可粘贴含 mcpServers 包裹的配置（仅取第一条）；headers 支持对象或 [键, 值] 数组
        </div>
      </div>

      <div class="mcp-form-actions">
        <TuiButton size="sm" variant="ghost" @click="closeForm">取消</TuiButton>
        <TuiButton
          size="sm"
          variant="primary"
          :disabled="formMode === 'form' && !isMcpFormValid(form)"
          @click="confirmForm"
        >
          {{ editingId ? '保存修改' : '确认添加' }}
        </TuiButton>
      </div>
    </div>

    <!-- 底部说明 + 配置路径 -->
    <div class="set-hint">
      支持 Streamable HTTP、SSE、stdio 三种传输；配置也可直接编辑：
      <code v-if="configPath" class="mcp-path" :title="configPath">{{ configPath }}</code>
      <button v-if="configPath" class="mcp-copy-btn" title="复制路径" @click="copyPath">
        <WsIcon name="copy" :size="11" :stroke-width="1.8" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 注：.set-row/.set-input/.set-btn/.set-hint 来自 settings-panels.css 基座（勿在此复制） */

.mcp-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

/* ── 分组与列表 ── */
.mcp-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mcp-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.mcp-group-label {
  font-size: 11px;
  font-weight: var(--font-weight-medium, 500);
  color: var(--text-secondary);
}
.mcp-group-label.is-connected { color: var(--success); }
.mcp-group-label.is-connecting { color: var(--info); }
.mcp-group-label.is-error { color: var(--danger); }
.mcp-group-label.is-disabled { color: var(--text-muted); }
.mcp-group-count {
  font-size: 10px;
  color: var(--text-muted);
}
.mcp-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcp-row-wrap {
  display: flex;
  flex-direction: column;
}
.mcp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-mid);
  background: var(--bg-muted);
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s, opacity 0.15s;
}
.mcp-item:hover {
  border-color: var(--border);
}
.mcp-item.is-expanded {
  border-color: var(--border);
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.mcp-item.is-disabled {
  opacity: 0.55;
}

/* 行首状态色点（只表达状态；启停动作由右侧 skill-toggle 承担，语义不重复） */
.mcp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.mcp-dot.is-connected { background: var(--success); }
.mcp-dot.is-connecting { background: var(--info); }
.mcp-dot.is-error { background: var(--danger); }
.mcp-dot.is-disabled { background: var(--text-muted); }
.mcp-status-icon.is-connecting {
  color: var(--info);
  flex-shrink: 0;
}
.mcp-spin {
  animation: mcp-spin 1s linear infinite;
}
@keyframes mcp-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.mcp-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mcp-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mcp-name {
  font-size: var(--font-size-sm, 13px);
  font-weight: var(--font-weight-medium, 500);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mcp-tag {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.mcp-desc {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* .skill-toggle 启停按钮样式由 AgentSettingsPanel 全局提供（与 Skills 行共用，不在此重复定义） */
.mcp-chevron {
  color: var(--text-muted);
  flex-shrink: 0;
}
.mcp-tool-badge {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 10px;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}
.mcp-row-retry {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.mcp-row-retry:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

/* ── 展开详情 ── */
.mcp-detail {
  padding: 8px 10px 8px 28px;
  border: 1px solid var(--border);
  border-top: none;
  border-bottom-left-radius: var(--radius-mid);
  border-bottom-right-radius: var(--radius-mid);
  background: color-mix(in srgb, var(--bg-muted) 55%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mcp-busy-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--info);
}
.mcp-error-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.mcp-error-icon {
  color: var(--danger);
  flex-shrink: 0;
}
.mcp-error-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--danger);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 参数明细（dl 两列） */
.mcp-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}
.mcp-meta-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
}
.mcp-meta-row dt {
  flex-shrink: 0;
  width: 44px;
  color: var(--text-muted);
  font-weight: var(--font-weight-medium, 500);
}
.mcp-meta-row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--text-secondary);
}
.mcp-mono {
  font-family: var(--font-mono);
}
.mcp-meta-text {
  word-break: break-all;
}
.mcp-cmd {
  font-weight: var(--font-weight-medium, 500);
  color: var(--text-primary);
}
.mcp-arg-tag,
.mcp-header-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  background: var(--bg-muted);
}
.mcp-header-note {
  font-size: 10px;
  color: var(--text-muted);
}
.mcp-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.mcp-mini-btn:hover {
  color: var(--text-primary);
}
.mcp-link-btn {
  background: none;
  border: none;
  padding: 0 2px;
  font-size: 11px;
  color: var(--info);
  cursor: pointer;
  text-decoration: underline;
}

/* 工具清单 */
.mcp-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcp-tools-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mcp-tools-title {
  font-size: 11px;
  font-weight: var(--font-weight-medium, 500);
  color: var(--text-secondary);
}
.mcp-tools-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.mcp-tools-msg.is-error {
  color: var(--danger);
}
.mcp-tool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mcp-tool {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
}
.mcp-tool-name {
  flex-shrink: 0;
  font-family: var(--font-mono);
  color: var(--info);
  background: color-mix(in srgb, var(--info) 10%, transparent);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
}
.mcp-tool-desc {
  min-width: 0;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mcp-detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}

/* ── 添加表单 ── */
.mcp-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.mcp-form-title {
  font-size: 12px;
  font-weight: var(--font-weight-medium, 500);
  color: var(--text-secondary);
}
.mcp-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mcp-mode-cats {
  flex-shrink: 0;
}
/* 药丸在窄卡里更紧凑 */
.mcp-mode-cats .set-cat {
  padding: 2px 10px;
}
.mcp-json-edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mcp-json-textarea {
  min-height: 220px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  tab-size: 2;
}
/* 编辑态只读 ID 输入框 */
.set-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.mcp-field-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcp-textarea {
  height: auto;
  min-height: 62px;
  padding: 6px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  resize: vertical;
}
.mcp-field-error {
  font-size: 11px;
  color: var(--danger);
}
/* 左右布局字段的错误提示与输入框对齐（label 52px + 间距 8px） */
.mcp-field-error--row {
  margin: -4px 0 0 60px;
}
.mcp-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

/* ── 底部路径 ── */
.mcp-path {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  word-break: break-all;
}
.mcp-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  margin-left: 2px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  vertical-align: middle;
}
.mcp-copy-btn:hover {
  color: var(--text-primary);
}
</style>

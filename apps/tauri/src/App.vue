<script setup lang="ts">
// Phase 5.2：注入 Tauri 端 Agent Backend（Rust 命令层），验证「前端 → IPC → Rust → 响应」链路
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { A2UIRenderer } from '@worldsmith/shared-ui'
import { provideAgentBackend, useAgentRust } from './agent/composables/useAgentRust'
import { useLoopControlRust } from './agent/composables/useLoopControlRust'
import TerminalView from './terminal/components/TerminalView.vue'
import SubAgentView from './subagent/components/SubAgentView.vue'
import SubAgentSection from './agent/components/SubAgentSection.vue'
import PhaseSection from './agent/components/PhaseSection.vue'
import ModelSettingsDialog from './agent/components/ModelSettingsDialog.vue'
import LoopControlStatus from './agent/components/LoopControlStatus.vue'
import MemoryPanel from './agent/memory/MemoryPanel.vue'
import SessionList from './agent/components/SessionList.vue'
import MessageContent from './agent/components/MessageContent.vue'
// Tauri 端统一基础组件
import TuiIcon from './components/ui/TuiIcon.vue'
import TuiButton from './components/ui/TuiButton.vue'
import TuiSelect from './components/ui/TuiSelect.vue'
import TuiConfirm from './components/ui/TuiConfirm.vue'
import TuiToast from './components/ui/TuiToast.vue'
import TuiEmpty from './components/ui/TuiEmpty.vue'
import { useTuiToast } from './components/ui/useTuiToast'
import { useTheme } from './components/ui/useTheme'

// 在 setup 上下文注入（useAgent 使用 inject 模式，须在组件内 provide）
const backend = useAgentRust()
provideAgentBackend(backend)

// 解构出顶层 ref：模板中 `backend.xxx` 是嵌套 ref 不会被解包。
// 直接传 prop / v-for 会得到 Ref 对象而非原始值（memory_* 命令报 invalid type: map；
// v-for 得到空对象导致会话侧边栏不渲染）。见 MemoryPanel 接线
const {
  currentSessionId,
  sessionList,
  switchSession,
  messages,
  isStreaming,
  thinkingLevel,
  a2uiSurfaces,
  resolveDataBinding,
  streamingAssistant,
  deepSegments,
} = backend

/** Loop Engineering：命令层 composable（模块级单例） */
const loopControl = useLoopControlRust()

/** 全局 toast（弱提示） */
const toast = useTuiToast()

/** 主题管理（浅色/深色）：解构为顶层 ref 使模板自动解包 */
const { theme: themeMode, toggle: toggleTheme, apply: applyTheme } = useTheme()

/**
 * 会话创建后绑定 loop_control：
 * 复用该会话 AgentLoop 内建 LoopController（共享单实例），
 * 使手动命令（recordTurn/getStatus/check）与自动驱动读取同一份状态，消除双轨。
 * taskId 固定为 `lc_{sessionId}`，与会话一一对应。
 */
async function bindSessionLoopControl(sessionId: string): Promise<void> {
  try {
    await loopControl.create(`lc_${sessionId}`, null, sessionId)
  } catch (err) {
    // 弱提示：绑定失败不阻塞会话（已存在等错误可忽略）
    console.warn(`[App] 绑定会话 loop_control 失败 session=${sessionId}:`, err)
  }
}

/** A2UI 动作回调：收到组件 action 时转发到后端 prompt（暂以文本形式透传） */
function onA2UIAction(_surfaceId: string, action: { name: string; data?: any }) {
  const text = `[A2UI] ${action.name}${action.data ? ' ' + JSON.stringify(action.data) : ''}`
  backend.prompt(text)
}

const input = ref('')
const sending = ref(false)
const error = ref('')

/** 消息区容器（用于自动滚动跟随） */
const messagesEl = ref<HTMLElement | null>(null)
/** 是否自动跟随底部（用户上翻历史时置 false，避免被打断） */
const followBottom = ref(true)

/** 用户滚动时更新跟随状态：接近底部则恢复跟随 */
function onMessagesScroll() {
  const el = messagesEl.value
  if (!el) return
  followBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

/** 滚动到消息区底部（nextTick 保证 DOM 已更新） */
function scrollMessagesToBottom() {
  const el = messagesEl.value
  if (!el) return
  nextTick(() => {
    el.scrollTop = el.scrollHeight
  })
}

/** 一键回到最新：恢复跟随并滚动到底（长对话上翻后使用） */
function jumpToBottom() {
  followBottom.value = true
  scrollMessagesToBottom()
}

/** 复制整条消息文本（助手消息 hover 操作，弱提示反馈；与 TerminalView 复制同一语言：成功 success / 失败 error） */
async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('消息已复制')
  } catch {
    toast.error('复制失败')
  }
}

/**
 * 消息时间格式化：今天仅显示 HH:mm，非今天附月日（弱信息，克制呈现）。
 * 无时间戳（旧数据）返回空串，不显示时间。
 * timestamp 兼容 string | number（AgentMessage 契约类型）。
 */
function formatMsgTime(ts?: number | string): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

/** 两个时间戳是否同一天（用于日期分隔线判断） */
function sameDay(a?: number | string, b?: number | string): boolean {
  if (!a || !b) return false
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/** 日期分隔线标签：今天 / 昨天 / 同年 M月D日 / 跨年加年份 */
function dateLabel(ts: number | string): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfDay) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * 是否在消息 i 处显示日期分隔线：跨天且非首条（首条跟随空状态，不重复标记）。
 * i 兼容 number | string（vue-tsc 对 v-for index 的联合推断），内部统一转 number。
 */
function showDateDivider(m: { timestamp?: number | string }, i: number | string): boolean {
  const idx = Number(i)
  if (idx === 0 || !m.timestamp) return false
  const prev = messages.value[idx - 1]
  if (!prev || !prev.timestamp) return false
  return !sameDay(prev.timestamp, m.timestamp)
}

// 流式输出（打字机）与新消息落地时，若处于跟随状态则自动滚动到底部
// 信号：最后一条消息 id + 内容长度 + 总条数（O(1) 信号，替代全量 map+join，长对话性能批次93）
watch(
  () =>
    messages.value.length > 0
      ? `${messages.value.length}:${messages.value[messages.value.length - 1].id}:${messages.value[messages.value.length - 1].content.length}`
      : 'empty',
  () => {
    if (followBottom.value) scrollMessagesToBottom()
  },
)

// 当前视图：chat（对话） / terminal（终端） / subagent（子 Agent 管理） / memory（记忆库）
const view = ref<'chat' | 'terminal' | 'subagent' | 'memory'>('chat')

/** 对话滚动位置暂存：chat 视图 v-if 销毁重建会归零滚动，切换前保存、切回恢复 */
const savedChatScrollTop = ref(0)
watch(view, async (nv, ov) => {
  if (ov === 'chat') {
    savedChatScrollTop.value = messagesEl.value?.scrollTop ?? 0
  } else if (nv === 'chat') {
    await nextTick()
    if (messagesEl.value) {
      messagesEl.value.scrollTop = savedChatScrollTop.value
      onMessagesScroll()
    }
  }
})

/** 全局导航项（左侧轨道）：线性 SVG 图标 + 标签 */
const navItems = [
  { key: 'chat', label: '对话', icon: 'chat' },
  { key: 'terminal', label: '终端', icon: 'terminal' },
  { key: 'subagent', label: '子Agent', icon: 'subagent' },
  { key: 'memory', label: '记忆', icon: 'memory' },
] as const

/** 视图切换方向（导航轨道上的前进/后退），驱动 Transition name 实现方向感滑入 */
const viewDir = ref<'fwd' | 'back'>('fwd')

/**
 * 切换视图：按导航顺序决定滑入方向（前进 = 视图索引增大，从右滑入；后退反之）。
 * rail 点击与 Ctrl+1..4 快捷键统一走本函数，保证方向一致。
 */
function switchView(target: (typeof navItems)[number]['key']) {
  const from = navItems.findIndex((i) => i.key === view.value)
  const to = navItems.findIndex((i) => i.key === target)
  viewDir.value = to >= from ? 'fwd' : 'back'
  view.value = target
  // 视图切换后焦点转移到新视图（等待 out-in 过渡完成；避免焦点落回 body，批次90 5.5）
  nextTick(() => {
    setTimeout(() => {
      const firstFocusable = document
        .querySelector('.content .view, .content .chat')
        ?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
      firstFocusable?.focus({ preventScroll: true })
    }, 240) // 略长于 --dur-lg 0.32s 的进入过渡一半，落在过渡完成后
  })
}

/** 当前流式中的助手消息 id（富渲染据此在流式期间退化为纯文本防未闭合围栏） */
const streamingId = computed(() => streamingAssistant?.value?.id ?? null)

/** 发送消息：走 useAgentRust.prompt → invoke('send_message') → Rust ReAct 循环 */
async function send() {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  error.value = ''
  sending.value = true
  try {
    await backend.prompt(text)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    sending.value = false
  }
}

/** 思考级别选项（与 useAgentRust ThinkingLevel 对齐） */
const thinkingOptions = [
  { value: 'off', label: '关闭' },
  { value: 'minimal', label: '极简' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]

/** 思考级别变化：调用 Rust update_thinking_level（深度模式开关） */
async function onThinkingLevelChange(level: string) {
  try {
    await backend.updateThinkingLevel(level as never)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

/** 停止生成：调用 Rust abort（发送按钮在生成中切换为「停止」） */
async function onStop() {
  try {
    await backend.abort()
  } catch (err) {
    error.value = `停止失败: ${err}`
  }
}

/** 中途引导：把输入文本写入 steer_buffer（下轮 prompt 时附加为前置 user 消息） */
async function onSteer() {
  const text = input.value.trim()
  if (!text || (!sending.value && !isStreaming.value)) return
  input.value = ''
  try {
    await backend.steer(text)
    toast.info('引导已记录，本轮结束后生效')
  } catch (err) {
    error.value = `引导失败: ${err}`
  }
}

/** 对话运行轮次：生成中轮询 getState 取 current_iteration（ReAct 循环当前第几轮） */
const currentIteration = ref(0)
let iterationTimer: ReturnType<typeof setInterval> | null = null
function startIterationPolling() {
  if (iterationTimer) return
  iterationTimer = setInterval(async () => {
    const state = await backend.getState()
    if (state) currentIteration.value = state.current_iteration
  }, 2000)
}
function stopIterationPolling() {
  if (iterationTimer) {
    clearInterval(iterationTimer)
    iterationTimer = null
    currentIteration.value = 0
  }
}

// 生成中（sending / isStreaming）启动轮询，结束停止
watch([sending, () => isStreaming.value], ([newSending, newStreaming]) => {
  if (newSending || newStreaming) {
    startIterationPolling()
  } else {
    stopIterationPolling()
  }
})

// 组件卸载时清理轮询计时器
onBeforeUnmount(stopIterationPolling)

/** 清空当前会话历史：调用 Rust clear_history（会话保留，仅清消息） */
async function onClear() {
  try {
    await backend.clearHistory()
    toast.info('对话已清空')
  } catch (err) {
    error.value = `清空对话失败: ${err}`
  }
}

/** 压缩上下文：保留最近 8 条消息，移除更早的历史（同步 backend 与 state） */
const TRIM_KEEP_COUNT = 8
async function onTrimContext() {
  const total = messages.value.length
  if (total <= TRIM_KEEP_COUNT) return
  // trim_context 从头部移除 up_to_index 条；保留最近 KEEP 条
  const upToIndex = total - TRIM_KEEP_COUNT
  try {
    await backend.trimContext(upToIndex)
    toast.info(`上下文已压缩，保留最近 ${TRIM_KEEP_COUNT} 条消息`)
  } catch (err) {
    error.value = `压缩上下文失败: ${err}`
  }
}

/** 模型配置弹窗开关 */
const showModelSettings = ref(false)

/** 当前模型显示文本（provider/model），打开弹窗时经 getProviderConfig 刷新 */
const currentModel = ref('')

/** 刷新当前模型显示：调用 Rust get_provider_config 回填 */
async function refreshCurrentModel() {
  try {
    const cfg = await backend.getProviderConfig()
    currentModel.value = cfg ? `${cfg.provider}/${cfg.model}` : ''
  } catch {
    currentModel.value = ''
  }
}

/** 保存模型配置：调用 Rust set_provider_config（三模式热切换，不清历史） */
async function onSaveModelConfig(config: any) {
  await backend.setProviderConfig(config)
  await refreshCurrentModel()
}

/** 新建会话：调用 Rust new_session，并设为当前会话 */
async function onNewSession() {
  try {
    const info = await backend.newSession('WorldSmith 桌面端测试助手')
    if (info?.id) await bindSessionLoopControl(info.id)
  } catch (err) {
    error.value = `新建会话失败: ${err}`
  }
}

/** 删除会话确认框状态（替代原生 confirm，弱化危险提示） */
const deleteConfirm = ref<{ show: boolean; id: string | null }>({ show: false, id: null })
/** 删除进行中：防快速双击重复触发（批次89 8.6） */
const deleting = ref(false)

/** TuiConfirm update:show 回调（模板内联箭头函数不允许 TS 注解，收敛为方法） */
function onDeleteConfirmShow(v: boolean) {
  deleteConfirm.value.show = v
}

/** 请求删除会话：先弹确认框 */
function requestDeleteSession(id: string) {
  deleteConfirm.value = { show: true, id }
}

/** 确认删除会话：调用 Rust delete_session（若删除当前会话则清空本地状态） */
async function onDeleteSession() {
  const id = deleteConfirm.value.id
  if (!id || deleting.value) return
  deleting.value = true
  try {
    await backend.deleteSession(id)
    toast.info('会话已删除')
  } catch (err) {
    error.value = `删除会话失败: ${err}`
  } finally {
    deleteConfirm.value = { show: false, id: null }
    deleting.value = false
  }
}

/**
 * 输入框轮转提示（用户偏好：非交互旋转提示，一次 2 条，输入文本时隐藏）。
 * 文案池循环展示，每 4s 切到下一组 2 条。
 */
const hintPool = [
  '描述一个世界观，生成实体卡片与关系',
  '让 Agent 写一段 Rust 代码并解释',
  '让 Agent 梳理 docs 目录的文档结构',
  '委派子 Agent 处理独立的研究任务',
  '让 Agent 检索记忆库中的历史结论',
  '让 Agent 分析当前目录的代码依赖',
]
const hintPair = ref<[string, string]>([hintPool[0], hintPool[1]])
let hintTimer: ReturnType<typeof setInterval> | null = null
const hintIdx = ref(0)
function startHintRotation() {
  if (hintTimer) return
  hintTimer = setInterval(() => {
    hintIdx.value = (hintIdx.value + 2) % hintPool.length
    hintPair.value = [
      hintPool[hintIdx.value],
      hintPool[(hintIdx.value + 1) % hintPool.length],
    ]
  }, 4000)
}
onMounted(startHintRotation)
onBeforeUnmount(() => {
  if (hintTimer) clearInterval(hintTimer)
})

/** 输入区 textarea 引用与自适应高度 */
const inputEl = ref<HTMLTextAreaElement | null>(null)
function autoResizeInput() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

/** 空状态建议 chips：点击填充输入框并聚焦 */
function fillInput(text: string) {
  input.value = text
  nextTick(() => inputEl.value?.focus())
}

/** 键盘发送：生成中回车=引导，空闲回车=发送（Shift+Enter 换行由 textarea 默认行为承担） */
function onInputKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  if (sending.value || isStreaming.value) {
    onSteer()
  } else {
    send()
  }
}

// 启动时自动新建会话（验证 new_session 链路）
onMounted(async () => {
  // 应用初始主题（html data-theme 由此建立）
  applyTheme(themeMode.value)
  try {
    const info = await backend.newSession('WorldSmith 桌面端测试助手')
    if (info?.id) await bindSessionLoopControl(info.id)
  } catch (err) {
    error.value = `会话初始化失败: ${err}`
  }
  await refreshCurrentModel()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

/**
 * 全局快捷键（成熟桌面软件体验）：
 * - Ctrl/Cmd+N 新建会话
 * - Ctrl/Cmd+1..4 切换视图
 * - Ctrl/Cmd+K 聚焦输入框
 * 任何弹窗打开时忽略（检测 body 上 open 的 aria-modal dialog，覆盖所有视图内弹窗，批次90 5.2）。
 */
function onGlobalKeydown(e: KeyboardEvent) {
  // 弹窗打开时忽略（覆盖模型配置/删除确认/子Agent 导入导出等所有弹窗）
  const openDialog = document.querySelector('[aria-modal="true"]')
  if (openDialog) return
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  const k = e.key.toLowerCase()
  if (k === 'n') {
    e.preventDefault()
    onNewSession()
  } else if (k === '1') {
    e.preventDefault()
    switchView('chat')
  } else if (k === '2') {
    e.preventDefault()
    switchView('terminal')
  } else if (k === '3') {
    e.preventDefault()
    switchView('subagent')
  } else if (k === '4') {
    e.preventDefault()
    switchView('memory')
  } else if (k === 'k') {
    e.preventDefault()
    inputEl.value?.focus()
  }
}
</script>

<template>
  <div class="app">
    <!-- 左侧全局导航轨道 -->
    <nav class="rail">
      <div class="rail-logo" title="WorldSmith Agent">
        <TuiIcon name="sparkle" :size="18" :stroke-width="2" />
      </div>
      <div class="rail-nav">
        <button
          v-for="(item, i) in navItems"
          :key="item.key"
          class="rail-item"
          :class="{ active: view === item.key }"
          :title="`${item.label}（Ctrl+${i + 1}）`"
          :aria-current="view === item.key ? 'page' : undefined"
          @click="switchView(item.key)"
        >
          <TuiIcon :name="item.icon" :size="20" />
          <span class="rail-label">{{ item.label }}</span>
        </button>
      </div>
      <div class="rail-foot">
        <button
          class="rail-item rail-setting"
          :title="themeMode === 'dark' ? '切换浅色模式' : '切换深色模式'"
          :aria-label="themeMode === 'dark' ? '切换浅色模式' : '切换深色模式'"
          @click="toggleTheme()"
        >
          <!-- 图标随主题切换旋转淡入（视觉事件反馈：模式切换时刻被感知） -->
          <Transition name="theme-icon" mode="out-in">
            <TuiIcon :key="themeMode" :name="themeMode === 'dark' ? 'sun' : 'moon'" :size="19" />
          </Transition>
        </button>
        <button
          class="rail-item rail-setting"
          title="模型配置"
          aria-label="模型配置"
          @click="showModelSettings = true; refreshCurrentModel()"
        >
          <TuiIcon name="bulb" :size="20" />
        </button>
      </div>
    </nav>

    <!-- 会话列表面板：仅对话视图展示 -->
    <SessionList
      v-if="view === 'chat'"
      :sessions="sessionList"
      :current-session-id="currentSessionId"
      @select="switchSession"
      @create="onNewSession"
      @remove="requestDeleteSession"
    />

    <!-- 内容区 -->
    <main class="content">
      <!-- 视图切换过渡：前进（右侧导航）向右滑入 / 后退（左侧导航）向左滑入，方向感强化空间位置 -->
      <Transition :name="viewDir === 'fwd' ? 'view-fwd' : 'view-back'" mode="out-in">
        <!-- 记忆库视图 -->
        <div v-if="view === 'memory'" key="memory" class="view">
          <MemoryPanel :session-id="currentSessionId" />
        </div>

        <!-- 终端视图 -->
        <div v-else-if="view === 'terminal'" key="terminal" class="view">
          <TerminalView />
        </div>

        <!-- 子 Agent 管理视图 -->
        <div v-else-if="view === 'subagent'" key="subagent" class="view">
          <SubAgentView />
        </div>

        <!-- 对话视图 -->
        <div v-else key="chat" class="chat">
          <header class="chat-header">
            <div class="chat-title" :title="backend.sessionTitle(currentSessionId)">
              {{ backend.sessionTitle(currentSessionId) }}
            </div>
            <div class="header-actions">
              <TuiButton
                variant="secondary"
                size="sm"
                icon="bulb"
                class="act-model"
                title="切换模型"
                @click="showModelSettings = true; refreshCurrentModel()"
              >
                {{ currentModel || '模型' }}
              </TuiButton>
              <div class="think-field" title="思考深度（深度模式开关）">
                <TuiIcon name="sparkle" :size="13" class="think-icon" />
                <TuiSelect
                  :model-value="thinkingLevel"
                  size="sm"
                  :options="thinkingOptions"
                  :disabled="sending || isStreaming"
                  @update:model-value="onThinkingLevelChange"
                />
              </div>
              <TuiButton variant="secondary" size="sm" title="清空对话" :disabled="messages.length === 0" @click="onClear">
                清空
              </TuiButton>
              <TuiButton
                variant="secondary"
                size="sm"
                title="压缩上下文（保留最近 8 条消息）"
                :disabled="messages.length <= TRIM_KEEP_COUNT"
                @click="onTrimContext"
              >
                压缩
              </TuiButton>
            </div>
          </header>

          <!-- Loop Engineering 实时状态条 -->
          <LoopControlStatus />

          <!-- 消息区 -->
          <div class="messages" ref="messagesEl" @scroll.passive="onMessagesScroll">
            <!-- 空状态：建议引导（统一 TuiEmpty 基座 + chips 插槽，批次60 收敛手写副本） -->
            <TuiEmpty
              v-if="messages.length === 0"
              icon="chat"
              title="开始对话"
              hint="输入消息，Agent 将调用工具完成任务"
              fill
            >
              <div class="empty-chips">
                <button v-for="s in hintPool.slice(0, 4)" :key="s" class="chip" @click="fillInput(s)">
                  {{ s }}
                </button>
              </div>
            </TuiEmpty>
            <!-- 消息流：TransitionGroup 提供增删/重排平滑过渡（会话切换、新消息落地） -->
            <TransitionGroup name="msg" tag="div" class="msg-stream">
            <template v-for="(m, i) in messages" :key="m.id">
            <!-- 日期分隔线：跨天处弱色标记（今天/昨天/月日），与时间戳构成时间叙事 -->
            <div v-if="showDateDivider(m, i)" :key="`d-${m.id}`" class="date-divider">
              <span>{{ dateLabel(m.timestamp) }}</span>
            </div>
            <div
              class="msg"
              :class="m.role"
            >
              <!-- 用户消息：右侧气泡 + 右侧中性头像 -->
              <template v-if="m.role === 'user'">
                <div class="msg-body">
                  <div class="bubble user">
                    <button
                      v-if="m.content"
                      class="msg-copy"
                      title="复制全文"
                      aria-label="复制全文"
                      @click.stop="copyMessage(m.content)"
                    >
                      <TuiIcon name="copy" :size="12" />
                    </button>
                    <MessageContent :content="m.content" />
                  </div>
                  <div v-if="formatMsgTime(m.timestamp)" class="msg-time">
                    {{ formatMsgTime(m.timestamp) }}
                  </div>
                </div>
                <div class="avatar user" title="你">
                  <TuiIcon name="chat" :size="13" :stroke-width="2" />
                </div>
              </template>
              <!-- 工具结果：全宽中性虚线框，不带角色头像 -->
              <template v-else-if="m.role === 'toolResult'">
                <div class="tool-result">
                  <span class="tool-tag"><TuiIcon name="wrench" :size="11" /> 工具结果</span>
                  <MessageContent :content="m.content" />
                </div>
              </template>
              <!-- 助手消息：左侧头像 + 名称行 + 气泡 -->
              <template v-else>
                <div class="avatar assistant" title="WorldSmith">
                  <TuiIcon name="sparkle" :size="13" :stroke-width="2" />
                </div>
                <div class="msg-body">
                  <div class="msg-meta">
                    WorldSmith
                    <span v-if="formatMsgTime(m.timestamp)" class="meta-time">
                      · {{ formatMsgTime(m.timestamp) }}
                    </span>
                  </div>
                  <div class="bubble assistant">
                    <button
                      v-if="m.content && m.id !== streamingId"
                      class="msg-copy"
                      title="复制全文"
                      aria-label="复制全文"
                      @click.stop="copyMessage(m.content)"
                    >
                      <TuiIcon name="copy" :size="12" />
                    </button>
                    <MessageContent
                      v-if="m.content"
                      :content="m.content"
                      :streaming="m.id === streamingId"
                    />
                    <span v-else class="empty-content">（消息内容为空）</span>
                  </div>
                </div>
              </template>
            </div>
            </template>
            </TransitionGroup>

            <!-- 思考中指示：安静的提示行（弱提示，不打断）；role=status 让屏幕阅读器播报进行态状态消息（WCAG 4.1.3，与 TuiToast 先例一致） -->
            <div v-if="isStreaming && messages.length > 0" class="thinking-hint" role="status">
              <span class="thinking-dot" />
              <span>思考中 · 第 {{ currentIteration }} 轮</span>
            </div>

            <!-- 回到最新：用户上翻历史时右下角悬浮出现 -->
            <Transition name="fade">
              <button
                v-if="!followBottom && messages.length > 0"
                class="scroll-bottom"
                title="回到最新"
                aria-label="回到最新"
                @click="jumpToBottom"
              >
                <TuiIcon name="chevronDown" :size="16" />
              </button>
            </Transition>
          </div>

          <!-- A2UI（Agent-to-UI）渲染区：出现/收起时淡入淡出 -->
          <Transition name="fade">
            <div v-if="Object.keys(a2uiSurfaces).length > 0" class="a2ui-zone">
              <A2UIRenderer
                :surfaces="a2uiSurfaces"
                :resolve-binding="resolveDataBinding"
                @action="onA2UIAction"
              />
            </div>
          </Transition>

          <!-- 主 Agent 执行过程（ReAct 阶段轨迹，生成中实时更新） -->
          <PhaseSection :segments="deepSegments" />

          <!-- 子 Agent 委派过程展示 -->
          <SubAgentSection />

          <!-- 错误提示：淡入轻微下滑，关闭时淡出（弱提示不打断）；role=alert 播报键盘触发的失败（批次90 7.2） -->
          <Transition name="err-bar">
            <div v-if="error" class="error-bar" role="alert">
              <TuiIcon name="warning" :size="14" />
              <span>{{ error }}</span>
              <button class="error-dismiss" title="关闭" aria-label="关闭" @click="error = ''">
                <TuiIcon name="close" :size="12" />
              </button>
            </div>
          </Transition>

          <!-- 输入栏：自适应 textarea + 轮转提示 + 发送/停止 -->
          <footer class="input-bar">
            <div class="input-shell">
              <textarea
                ref="inputEl"
                v-model="input"
                rows="1"
                aria-label="输入消息"
                :placeholder="(sending || isStreaming) ? '输入引导词，本轮结束后生效…' : ''"
                spellcheck="false"
                @input="autoResizeInput"
                @keydown="onInputKeydown"
              />
              <!-- 清空输入：有文本时出现（弱化圆形按钮，右上角） -->
              <Transition name="fade">
                <button
                  v-if="input && !sending && !isStreaming"
                  class="input-clear"
                  title="清空输入"
                  aria-label="清空输入"
                  @click="input = ''; autoResizeInput()"
                >
                  <TuiIcon name="close" :size="12" />
                </button>
              </Transition>
              <!-- 轮转提示：非交互，输入文本时隐藏；切换时淡入淡出 -->
              <Transition name="hint-fade" mode="out-in">
                <div
                  v-if="!input && !sending && !isStreaming"
                  :key="hintIdx"
                  class="rotating-hints"
                  aria-hidden="true"
                >
                  <span class="hint-line">{{ hintPair[0] }}</span>
                  <span class="hint-line">{{ hintPair[1] }}</span>
                </div>
              </Transition>
              <div class="input-actions">
                <span class="kbd-hint">Enter 发送 · Shift+Enter 换行</span>
                <div class="send-area">
                  <TuiButton
                    v-if="sending || isStreaming"
                    variant="ghost"
                    size="sm"
                    title="中途引导：本轮结束后生效"
                    :disabled="!input.trim()"
                    @click="onSteer"
                  >
                    引导
                  </TuiButton>
                  <button
                    v-if="sending || isStreaming"
                    class="stop-btn"
                    title="停止生成"
                    aria-label="停止生成"
                    @click="onStop"
                  >
                    <TuiIcon name="stop" :size="13" />
                  </button>
                  <button
                    v-else
                    class="send-btn"
                    :disabled="!input.trim()"
                    title="发送"
                    aria-label="发送"
                    @click="send"
                  >
                    <TuiIcon name="send" :size="14" :stroke-width="2" />
                  </button>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </Transition>
    </main>
  </div>

  <!-- 模型配置弹窗 -->
  <ModelSettingsDialog
    :show="showModelSettings"
    :on-save-config="onSaveModelConfig"
    @close="showModelSettings = false"
  />

  <!-- 删除会话确认框 -->
  <TuiConfirm
    :show="deleteConfirm.show"
    title="删除会话"
    message="删除后该会话的消息与记忆记录将一并清除，确定继续？"
    :danger="true"
    confirm-text="删除"
    :loading="deleting"
    @confirm="onDeleteSession"
    @cancel="deleteConfirm.show = false"
    @update:show="onDeleteConfirmShow"
  />

  <!-- 全局 Toast -->
  <TuiToast />
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── 左侧导航轨道 ── */
.rail {
  width: var(--rail-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
}
.rail-logo {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-grad-to) 100%);
  color: var(--on-accent);
  margin-bottom: 20px;
  box-shadow: var(--shadow-sm);
}
.rail-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 0 8px;
}
.rail-foot {
  margin-top: auto;
  width: 100%;
  padding: 0 8px;
}
.rail-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 2px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.rail-item:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}
/* 按压反馈：icon-only 导航统一下沉（批次89 反馈语言收敛） */
.rail-item:active:not(:disabled) {
  transform: scale(var(--press-scale));
}
.rail-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}
/* 左侧指示条：仅 active 显示，强化当前视图位置感 */
.rail-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: var(--accent);
}
.rail-label {
  font-size: var(--fs-xs);
  line-height: 1;
}

/* 主题切换图标过渡：旋转 + 缩放淡入（克制，不抢焦点） */
.theme-icon-enter-active,
.theme-icon-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease-spring);
}
.theme-icon-enter-from {
  opacity: 0;
  transform: rotate(-90deg) scale(0.6);
}
.theme-icon-leave-to {
  opacity: 0;
  transform: rotate(90deg) scale(0.6);
}

/* ── 内容区 ── */
.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}
.view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 视图切换过渡（前进方向）：新视图从右滑入，旧视图向左滑出——沿导航轨道向右的位移感（大动效用 --dur-lg，批次90 4.2） */
.view-fwd-enter-active,
.view-fwd-leave-active {
  transition: opacity var(--dur-lg) var(--ease), transform var(--dur-lg) var(--ease-out);
}
.view-fwd-enter-from {
  opacity: 0;
  transform: translateX(14px);
}
.view-fwd-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

/* 视图切换过渡（后退方向）：新视图从左滑入，旧视图向右滑出——沿导航轨道向左的位移感（大动效用 --dur-lg，批次90 4.2） */
.view-back-enter-active,
.view-back-leave-active {
  transition: opacity var(--dur-lg) var(--ease), transform var(--dur-lg) var(--ease-out);
}
.view-back-enter-from {
  opacity: 0;
  transform: translateX(-14px);
}
.view-back-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

/* ── 对话视图 ── */
.chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px var(--chat-gutter);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}
.chat-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
/* 模型按钮：TuiButton secondary-sm 基础上仅保留 max-width 截断（模型名可能很长） */
.act-model {
  max-width: 200px;
}
.act-model :deep(.tui-btn__label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.think-field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.think-icon {
  color: var(--text-muted);
}

/* ── 消息区 ── */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px var(--chat-gutter) 12px;
  position: relative;
}
/* 回到最新悬浮按钮：上翻时右下角出现 */
.scroll-bottom {
  position: sticky;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-md);
  margin: 0 auto;
  transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease-spring);
}
.scroll-bottom:hover {
  border-color: var(--accent);
  color: var(--accent);
  transform: translateX(-50%) translateY(-1px);
}
/* 按压反馈：保留水平居中位移，仅纵向回弹（批次89） */
.scroll-bottom:active {
  transform: translateX(-50%) translateY(0px) scale(var(--press-scale));
}
/* 日期分隔线：跨天处弱色标记，两侧细线（克制的时间叙事分隔） */
.date-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  max-width: 860px;
  margin: 0 auto 20px;
  padding-top: 2px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  letter-spacing: 0.4px;
  user-select: none;
}
.date-divider::before,
.date-divider::after {
  content: '';
  flex: 1;
  max-width: 120px;
  height: 1px;
  background: var(--border);
}
/* 消息流容器（TransitionGroup 渲染容器，占满滚动区宽度；position:relative 使 leave 定位元素按消息流宽度，批次90 6.1） */
.msg-stream {
  position: relative;
  display: flex;
  flex-direction: column;
}
/* 消息流过渡（TransitionGroup）：进入上滑淡入 / 离开快速淡出 / 重排平滑 */
.msg-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.msg-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
  position: absolute;
  left: 0;
  right: 0;
}
.msg-move {
  transition: transform var(--dur-base) var(--ease-out);
}
.msg-enter-from,
.msg-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 auto 16px;
  max-width: 860px;
}
.msg.user {
  justify-content: flex-end;
}
/* 角色头像：助手 accent 渐变（呼应 rail-logo），用户中性弱底 */
.avatar {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}
.avatar.assistant {
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-grad-to) 100%);
  color: var(--on-accent);
  box-shadow: var(--shadow-sm);
}
.avatar.user {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
/* 消息主体：气泡 + 元信息（名称行）的纵向容器 */
.msg-body {
  max-width: 78%;
  min-width: 0;
}
/* 助手名称行：弱色小字，确立发言者身份 */
.msg-meta {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin: 1px 0 4px 2px;
  letter-spacing: 0.3px;
  user-select: none;
}
/* 助手名称行内的时间：更弱的次级弱化 */
.meta-time {
  opacity: 0.72;
  margin-left: 1px;
}
/* 用户消息时间：气泡下方右对齐弱色小字（弱信息，克制呈现） */
.msg-time {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: right;
  margin: 3px 2px 0 0;
  user-select: none;
}
.bubble {
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
}
.bubble.assistant {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
  box-shadow: var(--shadow-sm);
}
/* 助手消息 hover 复制按钮（右上角渐显） */
.msg-copy {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  border: none;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  box-shadow: var(--shadow-sm);
  transition: opacity var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.bubble.assistant:hover .msg-copy,
.bubble.user:hover .msg-copy {
  opacity: 1;
}
/* 键盘聚焦时也显形：Tab 可聚焦到 opacity:0 按钮，焦点环需可见 */
.msg-copy:focus-visible {
  opacity: 1;
}
/* 用户气泡靠右，复制按钮放左上角（避免超出视口右侧） */
.bubble.user .msg-copy {
  left: 6px;
  right: auto;
}
.msg-copy:hover {
  color: var(--accent);
}
/* 按压反馈：与 TuiButton 同一 scale（批次89） */
.msg-copy:active:not(:disabled) {
  transform: scale(var(--press-scale));
}
.bubble.user {
  position: relative;
  background: var(--accent-soft);
  border: 1px solid var(--accent-soft-border);
  border-top-right-radius: 4px;
  color: var(--text-primary);
}
/* 用户气泡内文本选中高亮：全局 ::selection 用 accent-soft 底，与气泡底色同色导致选中不可见——覆盖为 accent 底 + on-accent 字 */
.bubble.user ::selection {
  background: var(--accent);
  color: var(--on-accent);
}
/* 空内容消息占位（历史数据缺失防御，避免空白气泡塌缩） */
.empty-content {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  font-style: italic;
}
.tool-result {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  background: var(--bg-muted);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.tool-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  letter-spacing: 0.4px;
}

/* 思考中提示：安静的小圆点 + 弱色文字 */
.thinking-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 860px;
  margin: 0 auto;
  padding: 4px 2px 8px;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.thinking-dot {
  width: var(--dot-md);
  height: var(--dot-md);
  border-radius: 50%;
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}

/* 空状态（基座由 TuiEmpty 提供，chips 为插槽内容，批次60 收敛手写副本） */
.empty-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 480px;
  margin-top: 18px;
}
.chip {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
/* 按压反馈：chips 微缩（批次89） */
.chip:active {
  transform: scale(var(--press-scale));
}

/* A2UI / 子 Agent 区：与消息/输入栏同宽（860px 居中），宽窗下不被拉长 */
.a2ui-zone {
  max-width: 860px;
  margin: 0 auto;
  padding: 0 var(--chat-gutter) 16px;
  border-top: 1px solid var(--border);
}
/* 错误提示：柔和弱化（非强警报条），可关闭；同宽居中 */
.error-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 860px;
  margin: 0 auto 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: var(--fs-md);
  background: var(--danger-soft);
  border: 1px solid var(--danger-soft);
}
/* 错误条过渡：淡入 + 轻微下滑（与提示轮转同一运动语言，弱提示不抢焦点） */
.err-bar-enter-active,
.err-bar-leave-active {
  transition: opacity var(--dur-base) var(--ease), transform var(--dur-base) var(--ease-out);
}
.err-bar-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.err-bar-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
.error-bar .error-dismiss {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  opacity: 0.6;
}
.error-bar .error-dismiss:hover {
  opacity: 1;
  background: var(--danger-soft);
}
/* 按压反馈（批次89） */
.error-bar .error-dismiss:active {
  transform: scale(var(--press-scale));
}

/* ── 输入栏（自适应 textarea + 轮转提示）── */
.input-bar {
  padding: 10px var(--chat-gutter) 14px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
}
.input-shell {
  position: relative;
  max-width: 860px;
  margin: 0 auto;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  transition: border-color var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease);
}
.input-shell:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.input-shell textarea {
  display: block;
  width: 100%;
  min-height: 64px; /* 容纳两行轮转提示（top 12 + 2×lh-base + gap），避免溢出压到 kbd-hint */
  padding: 12px 42px 4px 14px;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--text-primary);
  resize: none;
  font-family: inherit;
  max-height: 160px;
}
/* 输入栏焦点由容器 .input-shell:focus-within 统一呈现，textarea 豁免全局 focus 兜底（避免双环） */
.input-shell textarea:focus {
  border-color: transparent;
  box-shadow: none;
}
/* 清空输入按钮：右上角弱化圆形，hover 渐显强调 */
.input-clear {
  position: absolute;
  top: 8px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--bg-active);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.input-clear:hover {
  background: var(--border-strong);
  color: var(--text-primary);
}
/* 按压反馈（批次89） */
.input-clear:active {
  transform: scale(var(--press-scale));
}
.input-shell textarea::placeholder {
  color: var(--text-muted);
}
/* 轮转提示层：非交互，覆盖在 textarea 上方（textarea 透明背景可见其下） */
.rotating-hints {
  position: absolute;
  top: 12px;
  left: 14px;
  right: 14px;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-muted);
}
.hint-line {
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 轮转提示切换：整体淡入淡出（key 变化触发） */
.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity var(--dur-base) var(--ease), transform var(--dur-base) var(--ease);
}
.hint-fade-enter-from {
  opacity: 0;
  transform: translateY(3px);
}
.hint-fade-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
.input-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 8px 14px;
}
.kbd-hint {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  user-select: none;
}
.send-area {
  display: flex;
  align-items: center;
  gap: 6px;
}
.send-btn,
.stop-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--dur-base) var(--ease), transform var(--dur-fast) var(--ease-spring), opacity var(--dur-fast) var(--ease);
}
.send-btn {
  background: var(--accent);
  color: var(--on-accent);
}
.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send-btn:disabled {
  opacity: var(--disabled-opacity);
  cursor: not-allowed;
}
.send-btn:active:not(:disabled),
.stop-btn:active {
  transform: scale(var(--press-scale));
}
.stop-btn {
  background: var(--bg-muted);
  color: var(--danger);
  border: 1px solid var(--border-strong);
}
.stop-btn:hover {
  background: var(--danger-soft);
  border-color: var(--danger);
}
</style>

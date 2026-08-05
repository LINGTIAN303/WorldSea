<script setup lang="ts">
// Phase 5.2：注入 Tauri 端 Agent Backend（Rust 命令层），验证「前端 → IPC → Rust → 响应」链路
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { A2UIRenderer } from '@worldsmith/shared-ui'
import { provideAgentBackend, useAgentRust } from './agent/composables/useAgentRust'
import { useLoopControlRust } from './agent/composables/useLoopControlRust'
import TerminalView from './terminal/components/TerminalView.vue'
import SubAgentView from './subagent/components/SubAgentView.vue'
import SubAgentSection from './agent/components/SubAgentSection.vue'
import ModelSettingsDialog from './agent/components/ModelSettingsDialog.vue'

// 在 setup 上下文注入（useAgent 使用 inject 模式，须在组件内 provide）
const backend = useAgentRust()
provideAgentBackend(backend)

/** Loop Engineering：命令层 composable（模块级单例） */
const loopControl = useLoopControlRust()

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

// 流式输出（打字机）与新消息落地时，若处于跟随状态则自动滚动到底部
watch(
  () => backend.messages.value.map((m: { id: string; content: string }) => m.id + m.content.length).join('|'),
  () => {
    if (followBottom.value) scrollMessagesToBottom()
  },
)

// 当前视图：chat（对话） / terminal（终端） / subagent（子 Agent 管理）
const view = ref<'chat' | 'terminal' | 'subagent'>('chat')

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

/** 思考级别变化：调用 Rust update_thinking_level（深度模式开关） */
async function onThinkingLevelChange(e: Event) {
  const level = (e.target as HTMLSelectElement).value
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
const steered = ref('')
let steeredTimer: ReturnType<typeof setTimeout> | null = null
async function onSteer() {
  const text = input.value.trim()
  if (!text || (!sending.value && !backend.isStreaming)) return
  input.value = ''
  try {
    await backend.steer(text)
    // 弱提示：引导已记录，本轮结束后生效（steer 为缓冲语义，非即时中断）
    steered.value = '引导已记录，本轮结束后生效'
    if (steeredTimer) clearTimeout(steeredTimer)
    steeredTimer = setTimeout(() => {
      steered.value = ''
    }, 2500)
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
watch([sending, () => backend.isStreaming], ([newSending, newStreaming]) => {
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
  } catch (err) {
    error.value = `清空对话失败: ${err}`
  }
}

/** 压缩上下文：保留最近 8 条消息，移除更早的历史（同步 backend 与 state） */
const TRIM_KEEP_COUNT = 8
const trimmed = ref('')
let trimmedTimer: ReturnType<typeof setTimeout> | null = null
async function onTrimContext() {
  const total = backend.messages.length
  if (total <= TRIM_KEEP_COUNT) return
  // trim_context 从头部移除 up_to_index 条；保留最近 KEEP 条
  const upToIndex = total - TRIM_KEEP_COUNT
  try {
    await backend.trimContext(upToIndex)
    trimmed.value = `上下文已压缩，保留最近 ${TRIM_KEEP_COUNT} 条消息`
    if (trimmedTimer) clearTimeout(trimmedTimer)
    trimmedTimer = setTimeout(() => {
      trimmed.value = ''
    }, 2500)
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

/** 删除会话：调用 Rust delete_session（若删除当前会话则清空本地状态） */
async function onDeleteSession(id: string) {
  try {
    await backend.deleteSession(id)
  } catch (err) {
    error.value = `删除会话失败: ${err}`
  }
}

// 启动时自动新建会话（验证 new_session 链路）
onMounted(async () => {
  try {
    const info = await backend.newSession('WorldSmith 桌面端测试助手')
    if (info?.id) await bindSessionLoopControl(info.id)
  } catch (err) {
    error.value = `会话初始化失败: ${err}`
  }
  await refreshCurrentModel()
})
</script>

<template>
  <div class="app">
    <!-- 顶部视图切换 -->
    <nav class="tabs">
      <button :class="{ active: view === 'chat' }" @click="view = 'chat'">对话</button>
      <button :class="{ active: view === 'terminal' }" @click="view = 'terminal'">终端</button>
      <button :class="{ active: view === 'subagent' }" @click="view = 'subagent'">子 Agent</button>
    </nav>

    <!-- 终端视图（全宽） -->
    <div v-if="view === 'terminal'" class="terminal-holder">
      <TerminalView />
    </div>

    <!-- 子 Agent 管理视图 -->
    <div v-else-if="view === 'subagent'" class="subagent-holder">
      <SubAgentView />
    </div>

    <!-- 对话视图 -->
    <div v-else class="chat-wrap">
    <aside class="sidebar">
      <div class="sidebar-head">
        <h2>会话</h2>
        <button class="new-session" title="新建会话" @click="onNewSession">＋ 新建</button>
      </div>
      <div v-if="backend.sessionList.length === 0" class="empty">暂无会话</div>
      <ul class="sessions">
        <li
          v-for="s in backend.sessionList"
          :key="s.id"
          :class="{ active: s.id === backend.currentSessionId }"
        >
          <button class="session-switch" @click="backend.switchSession(s.id)">
            {{ (s.id ?? '').slice(0, 8) }}
            <span class="count">{{ s.message_count }}</span>
          </button>
          <button class="session-del" title="删除会话" @click="onDeleteSession(s.id)">×</button>
        </li>
      </ul>
    </aside>

    <main class="chat">
      <header class="chat-header">
        <h1>WorldSmith Agent</h1>
        <div class="header-actions">
          <button
            class="model-btn"
            title="切换模型"
            @click="showModelSettings = true; refreshCurrentModel()"
          >模型 {{ currentModel }}</button>
          <button
            class="clear"
            :disabled="backend.messages.length === 0"
            title="清空对话"
            @click="onClear"
          >清空</button>
          <button
            class="trim"
            :disabled="backend.messages.length <= TRIM_KEEP_COUNT"
            title="压缩上下文（保留最近8条消息）"
            @click="onTrimContext"
          >压缩</button>
          <label class="think-field">
            <span class="think-label">思考级别</span>
            <select
              :value="backend.thinkingLevel"
              :disabled="sending || backend.isStreaming"
              @change="onThinkingLevelChange"
            >
              <option value="off">关闭</option>
              <option value="minimal">极简</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="xhigh">极高</option>
            </select>
          </label>
          <span class="status">{{ steered || trimmed || (backend.isStreaming ? `思考中… 第 ${currentIteration} 轮` : '就绪') }}</span>
        </div>
      </header>

      <div class="messages" ref="messagesEl" @scroll.passive="onMessagesScroll">
        <div v-if="backend.messages.length === 0" class="empty">
          输入消息开始对话（走 Rust 命令层，当前为 Mock 后端）
        </div>
        <div
          v-for="m in backend.messages"
          :key="m.id"
          class="msg"
          :class="m.role"
        >
          <div class="role">{{ m.role === 'user' ? '你' : 'Agent' }}</div>
          <div class="content">{{ m.content }}</div>
        </div>
      </div>

      <!-- A2UI（Agent-to-UI）渲染区：Agent 下发画布时在此展示 -->
      <div v-if="Object.keys(backend.a2uiSurfaces).length > 0" class="a2ui-zone">
        <A2UIRenderer
          :surfaces="backend.a2uiSurfaces"
          :resolve-binding="backend.resolveDataBinding"
          @action="onA2UIAction"
        />
      </div>

      <!-- 子 Agent 委派过程展示 -->
      <SubAgentSection />

      <div v-if="error" class="error">{{ error }}</div>

      <footer class="input-bar">
        <input
          v-model="input"
          type="text"
          :placeholder="(sending || backend.isStreaming) ? '输入引导词，本轮结束后生效' : '输入消息，回车发送'"
          @keydown.enter="(sending || backend.isStreaming) ? onSteer() : send()"
        />
        <template v-if="sending || backend.isStreaming">
          <button
            class="steer"
            :disabled="!input.trim()"
            title="中途引导：本轮结束后生效"
            @click="onSteer"
          >引导</button>
          <button
            class="stop"
            @click="onStop"
          >停止</button>
        </template>
        <button
          v-else
          :disabled="!input.trim()"
          @click="send"
        >发送</button>
      </footer>
    </main>
    </div>
  </div>

  <!-- 模型配置弹窗 -->
  <ModelSettingsDialog
    :show="showModelSettings"
    :on-save-config="onSaveModelConfig"
    @close="showModelSettings = false"
  />
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid #e5e5e5;
  background: #fafafa;
}
.tabs button {
  padding: 5px 16px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: #666;
  cursor: pointer;
}
.tabs button.active {
  background: #1a73e8;
  color: #fff;
}
.terminal-holder {
  flex: 1;
  min-height: 0;
}
.subagent-holder {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.chat-wrap {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 220px;
  border-right: 1px solid #e5e5e5;
  padding: 16px;
  overflow-y: auto;
}
.sidebar h2 {
  font-size: 14px;
  color: #666;
  margin: 0;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.new-session {
  padding: 3px 10px;
  border: 1px solid #1a73e8;
  border-radius: 6px;
  background: transparent;
  color: #1a73e8;
  font-size: 12px;
  cursor: pointer;
}
.new-session:hover {
  background: #e8f0fe;
}
.sessions {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sessions li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 6px;
  font-size: 13px;
  color: #333;
}
.sessions li:hover {
  background: #f5f5f5;
}
.sessions li.active {
  background: #e8f0fe;
}
.session-switch {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 6px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.sessions li.active .session-switch {
  color: #1a73e8;
}
.session-del {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #999;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.sessions li:hover .session-del {
  opacity: 1;
}
.session-del:hover {
  background: #fce8e6;
  color: #d93025;
}
.count {
  font-size: 11px;
  color: #999;
}
.empty {
  color: #999;
  font-size: 13px;
  text-align: center;
  padding: 24px 8px;
}
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid #e5e5e5;
}
.chat-header h1 {
  font-size: 16px;
  margin: 0;
}
.status {
  font-size: 12px;
  color: #1a73e8;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.model-btn {
  padding: 4px 10px;
  border: 1px solid #1a73e8;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: #1a73e8;
  cursor: pointer;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-btn:hover {
  background: #e8f0fe;
}
.clear {
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: #666;
  cursor: pointer;
}
.clear:hover:not(:disabled) {
  border-color: #d93025;
  color: #d93025;
}
.clear:disabled {
  background: #f5f5f5;
  color: #bbb;
  cursor: not-allowed;
}
.trim {
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: #666;
  cursor: pointer;
}
.trim:hover:not(:disabled) {
  border-color: #1a73e8;
  color: #1a73e8;
}
.trim:disabled {
  background: #f5f5f5;
  color: #bbb;
  cursor: not-allowed;
}
.think-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.think-label {
  font-size: 12px;
  color: #999;
}
.think-field select {
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 12px;
  color: #333;
  background: #fff;
  outline: none;
  cursor: pointer;
}
.think-field select:disabled {
  background: #f5f5f5;
  color: #bbb;
  cursor: not-allowed;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.msg {
  margin-bottom: 16px;
}
.msg .role {
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}
.msg .content {
  background: #f5f5f5;
  padding: 10px 14px;
  border-radius: 8px;
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.6;
}
.msg.user .content {
  background: #e8f0fe;
}
.a2ui-zone {
  padding: 0 20px 16px;
  border-top: 1px solid #eee;
}
.error {
  padding: 8px 20px;
  color: #d93025;
  font-size: 13px;
  background: #fce8e6;
}
.input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #e5e5e5;
}
.input-bar input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.input-bar input:focus {
  border-color: #1a73e8;
}
.input-bar button {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
}
.input-bar button:disabled {
  background: #ccc;
  cursor: not-allowed;
}
.input-bar button.stop {
  background: #d93025;
}
.input-bar button.stop:hover {
  background: #c5221f;
}
.input-bar button.steer {
  background: #5f6368;
}
.input-bar button.steer:hover:not(:disabled) {
  background: #3c4043;
}
</style>
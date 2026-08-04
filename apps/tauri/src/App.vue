<script setup lang="ts">
// Phase 5.2：注入 Tauri 端 Agent Backend（Rust 命令层），验证「前端 → IPC → Rust → 响应」链路
import { ref, onMounted } from 'vue'
import { A2UIRenderer } from '@worldsmith/shared-ui'
import { provideAgentBackend, useAgentRust } from './agent/composables/useAgentRust'

// 在 setup 上下文注入（useAgent 使用 inject 模式，须在组件内 provide）
const backend = useAgentRust()
provideAgentBackend(backend)

/** A2UI 动作回调：收到组件 action 时转发到后端 prompt（暂以文本形式透传） */
function onA2UIAction(_surfaceId: string, action: { name: string; data?: any }) {
  const text = `[A2UI] ${action.name}${action.data ? ' ' + JSON.stringify(action.data) : ''}`
  backend.prompt(text)
}

const input = ref('')
const sending = ref(false)
const error = ref('')

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

// 启动时自动新建会话（验证 new_session 链路）
onMounted(async () => {
  try {
    await backend.newSession('WorldSmith 桌面端测试助手')
  } catch (err) {
    error.value = `会话初始化失败: ${err}`
  }
})
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <h2>会话</h2>
      <div v-if="backend.sessionList.length === 0" class="empty">暂无会话</div>
      <ul class="sessions">
        <li
          v-for="s in backend.sessionList"
          :key="s.id"
          :class="{ active: s.id === backend.currentSessionId }"
          @click="backend.switchSession(s.id)"
        >
          {{ s.id.slice(0, 8) }}
          <span class="count">{{ s.message_count }}</span>
        </li>
      </ul>
    </aside>

    <main class="chat">
      <header class="chat-header">
        <h1>WorldSmith Agent</h1>
        <span class="status">{{ backend.isStreaming ? '思考中…' : '就绪' }}</span>
      </header>

      <div class="messages">
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

      <div v-if="error" class="error">{{ error }}</div>

      <footer class="input-bar">
        <input
          v-model="input"
          type="text"
          placeholder="输入消息，回车发送"
          :disabled="sending"
          @keydown.enter="send"
        />
        <button :disabled="sending || !input.trim()" @click="send">
          {{ sending ? '发送中…' : '发送' }}
        </button>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
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
  margin: 0 0 12px;
}
.sessions {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sessions li {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  color: #333;
}
.sessions li:hover {
  background: #f5f5f5;
}
.sessions li.active {
  background: #e8f0fe;
  color: #1a73e8;
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
</style>
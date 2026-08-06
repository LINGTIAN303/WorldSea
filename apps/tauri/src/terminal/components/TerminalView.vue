<script setup lang="ts">
/** TerminalView：终端界面（单次命令 + 持久化会话 + Shell 检测），详细见 docs/details/注释/tauri/TerminalView.md */
import { ref, computed, onMounted, nextTick } from 'vue'
import { useTerminalRust, type CommandOutput } from '../composables/useTerminalRust'

const term = useTerminalRust()

// 解构 ref 使其成为顶层 setup 绑定，模板中自动解包
const { shells, sessions, busy: termBusy } = term

/** 单条输出记录 */
interface OutputEntry {
  id: number
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  /** 归属作用域：'' 表示单次命令，否则为 session_id */
  scope: string
  sessionId?: string
  ts: number
}

const entries = ref<OutputEntry[]>([])
const input = ref('')
const running = ref(false)
const error = ref('')

/** 查看全部输出（true）或仅当前作用域（false） */
const showAll = ref(false)

// 命令历史（↑/↓ 切换）
const history = ref<string[]>([])
const historyIndex = ref(-1)

// 会话执行模式：选中会话时命令在会话中执行
const activeSessionId = ref('')
const newShell = ref('')
const newCwd = ref('')

let idSeq = 0

const outputEl = ref<HTMLElement | null>(null)

/** 追加一条接口输出到输出区 */
function pushOutput(o: Omit<OutputEntry, 'id' | 'ts' | 'scope'> & { scope?: string }) {
  entries.value.push({
    ...o,
    scope: o.scope ?? '',
    id: ++idSeq,
    ts: Date.now(),
  })
  nextTick(() => {
    outputEl.value?.scrollTo({ top: outputEl.value.scrollHeight, behavior: 'smooth' })
  })
}

/** 当前应展示的输出（按作用域过滤） */
const displayEntries = computed(() =>
  showAll.value ? entries.value : entries.value.filter((e) => e.scope === activeSessionId.value),
)

/** 执行当前输入命令（会话模式 / 单次模式） */
async function run() {
  const cmd = input.value.trim()
  if (!cmd || running.value) return
  input.value = ''
  error.value = ''
  running.value = true
  history.value.push(cmd)
  historyIndex.value = -1

  try {
    let res: CommandOutput
    let sessionId: string | undefined
    if (activeSessionId.value) {
      sessionId = activeSessionId.value
      res = await term.execSession(sessionId, cmd)
    } else {
      res = await term.executeCommand(cmd)
    }
    pushOutput({
      command: cmd,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exit_code,
      sessionId,
      scope: sessionId ?? '',
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    pushOutput({
      command: cmd,
      stdout: '',
      stderr: error.value,
      exitCode: null,
      sessionId: activeSessionId.value,
      scope: activeSessionId.value ?? '',
    })
  } finally {
    running.value = false
  }
}

/** 历史导航 */
function onHistory(dir: -1 | 1) {
  if (history.value.length === 0) return
  historyIndex.value += dir
  if (historyIndex.value < -1) historyIndex.value = -1
  if (historyIndex.value >= history.value.length) historyIndex.value = history.value.length - 1
  input.value = historyIndex.value >= 0 ? history.value[history.value.length - 1 - historyIndex.value] : ''
}

/** 创建持久化会话 */
async function createSession() {
  error.value = ''
  try {
    const res = await term.createSession({
      shell: newShell.value || undefined,
      cwd: newCwd.value || undefined,
    })
    activeSessionId.value = res.session_id
    newCwd.value = ''
    // 新建会话后只看该会话自己的输出，避免旧内容混入
    showAll.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

/** 销毁会话 */
async function destroySession(sessionId: string) {
  error.value = ''
  try {
    await term.destroySession(sessionId)
    if (activeSessionId.value === sessionId) activeSessionId.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(async () => {
  // 加载可用 Shell 与已有会话
  try {
    await Promise.all([term.detectShells(), term.refreshSessions()])
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})
</script>

<template>
  <div class="terminal">
    <div class="terminal-main">
      <header class="bar">
        <span class="title">终端</span>
        <span class="hint">
          {{ activeSessionId ? `会话内执行：${activeSessionId.slice(0, 8)}…` : '单次命令执行' }}
        </span>
        <label class="toggle" :title="showAll ? '显示全部输出' : '仅显示当前会话 / 单次命令输出'">
          <input v-model="showAll" type="checkbox" />
          <span>全部输出</span>
        </label>
        <button class="link" :disabled="running" @click="term.refreshSessions()">刷新会话</button>
      </header>

      <!-- 可用 Shell 展示 -->
      <div v-if="shells.length" class="shells">
        <span
          v-for="s in shells"
          :key="s.id"
          class="shell-chip"
          :class="{ default: s.is_default }"
          :title="s.path"
        >
          {{ s.name }}{{ s.is_default ? '（默认）' : '' }}
        </span>
      </div>

      <!-- 输出区 -->
      <div ref="outputEl" class="output">
        <div v-if="displayEntries.length === 0" class="empty">
          {{ showAll || !activeSessionId ? '输入命令并回车执行，输出将显示在这里' : '该会话暂无输出，输入命令回车执行' }}
        </div>
        <div v-for="e in displayEntries" :key="e.id" class="entry">
          <div class="entry-cmd">
            <span class="prompt">❯</span>
            <span class="cmd-text">{{ e.command }}</span>
            <span v-if="e.sessionId" class="session-tag">{{ e.sessionId.slice(0, 8) }}…</span>
          </div>
          <div v-if="e.stdout" class="entry-out stdout pre">{{ e.stdout }}</div>
          <div v-if="e.stderr" class="entry-out stderr pre">{{ e.stderr }}</div>
          <div class="entry-exit" :class="e.exitCode === 0 ? 'ok' : 'err'">
            退出码 {{ e.exitCode ?? '-' }}
          </div>
        </div>
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <!-- 输入栏 -->
      <footer class="input-bar">
        <input
          v-model="input"
          type="text"
          placeholder="输入命令，回车执行"
          :disabled="running"
          spellcheck="false"
          @keydown.enter="run"
          @keydown.up.prevent="onHistory(1)"
          @keydown.down.prevent="onHistory(-1)"
        />
        <button :disabled="running || !input.trim()" @click="run">
          {{ running ? '执行中…' : '执行' }}
        </button>
      </footer>
    </div>

    <!-- 会话面板 -->
    <aside class="session-panel">
      <h3>持久化会话</h3>

      <div class="create">
        <input v-model="newShell" type="text" placeholder="Shell 路径（可选）" spellcheck="false" />
        <input v-model="newCwd" type="text" placeholder="工作目录（可选）" spellcheck="false" />
        <button :disabled="termBusy" @click="createSession">新建会话</button>
      </div>

      <div v-if="sessions.length === 0" class="panel-empty">暂无会话</div>
      <ul v-else class="session-list">
        <li
          v-for="s in sessions"
          :key="s.session_id"
          :class="{ active: s.session_id === activeSessionId }"
        >
          <button class="session-select" @click="activeSessionId = s.session_id">
            <span class="s-id">{{ s.session_id.slice(0, 8) }}</span>
            <span class="s-meta">{{ s.shell }} · {{ s.cwd }}</span>
          </button>
          <button class="destroy" title="销毁会话" @click="destroySession(s.session_id)">×</button>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.terminal {
  display: flex;
  height: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}
.terminal-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #e5e5e5;
}
.bar .title {
  font-weight: 600;
  font-size: 14px;
}
.bar .hint {
  color: #888;
  font-size: 12px;
}
.bar .link {
  margin-left: auto;
  border: none;
  background: none;
  color: #1a73e8;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  user-select: none;
}
.toggle input {
  margin: 0;
  cursor: pointer;
}
.shells {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.shell-chip {
  padding: 2px 10px;
  border-radius: 999px;
  background: #f0f4ff;
  color: #1a73e8;
  font-size: 12px;
}
.shell-chip.default {
  background: #1a73e8;
  color: #fff;
}
.output {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.empty {
  color: #999;
  text-align: center;
  padding: 40px 0;
  font-family: system-ui, sans-serif;
}
.entry {
  margin-bottom: 14px;
}
.entry-cmd {
  display: flex;
  align-items: center;
  gap: 8px;
}
.prompt {
  color: #1a73e8;
  font-weight: 700;
}
.cmd-text {
  font-weight: 600;
  color: #222;
}
.session-tag {
  font-size: 11px;
  color: #7b5cff;
  background: #f0ecff;
  padding: 0 6px;
  border-radius: 4px;
}
.entry-out {
  margin: 6px 0 0 18px;
  padding: 8px 10px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
}
.entry-out.stdout {
  background: #f6f8fa;
  color: #333;
}
.entry-out.stderr {
  background: #fdecea;
  color: #b3261e;
}
.entry-exit {
  margin: 4px 0 0 18px;
  font-size: 11px;
}
.entry-exit.ok {
  color: #188038;
}
.entry-exit.err {
  color: #b3261e;
}
.error {
  padding: 6px 16px;
  color: #b3261e;
  font-size: 12px;
  background: #fdecea;
}
.input-bar {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid #e5e5e5;
}
.input-bar input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.input-bar input:focus {
  border-color: #1a73e8;
}
.input-bar button {
  padding: 8px 18px;
  border: none;
  border-radius: 6px;
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
  font-family: inherit;
}
.input-bar button:disabled {
  background: #ccc;
  cursor: not-allowed;
}
.pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* 会话面板 */
.session-panel {
  width: 280px;
  border-left: 1px solid #e5e5e5;
  padding: 12px;
  overflow-y: auto;
  font-family: system-ui, sans-serif;
}
.session-panel h3 {
  font-size: 13px;
  color: #666;
  margin: 0 0 10px;
}
.create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.create input {
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
}
.create input:focus {
  border-color: #1a73e8;
}
.create button {
  padding: 6px;
  border: none;
  border-radius: 6px;
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
.create button:disabled {
  background: #ccc;
}
.panel-empty {
  color: #999;
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}
.session-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.session-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.session-list li.active {
  background: #e8f0fe;
}
.session-list li:hover {
  background: #f5f5f5;
}
.session-list li.active:hover {
  background: #e8f0fe;
}
.session-select {
  flex: 1;
  text-align: left;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.s-id {
  font-weight: 600;
  font-size: 12px;
  color: #333;
  margin-right: 6px;
}
.s-meta {
  font-size: 11px;
  color: #888;
  word-break: break-all;
}
.destroy {
  border: none;
  background: none;
  color: #999;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.destroy:hover {
  color: #b3261e;
}
</style>
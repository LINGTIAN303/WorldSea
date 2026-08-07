<script setup lang="ts">
/** TerminalView：终端界面（单次命令 + 持久化会话 + Shell 检测），详细见 docs/details/注释/tauri/TerminalView.md */
import { ref, computed, onMounted, nextTick } from 'vue'
import { useTerminalRust, type CommandOutput } from '../composables/useTerminalRust'
import TuiButton from '../../components/ui/TuiButton.vue'
import TuiIcon from '../../components/ui/TuiIcon.vue'
import TuiEmpty from '../../components/ui/TuiEmpty.vue'
import { useTuiToast } from '../../components/ui/useTuiToast'

const term = useTerminalRust()
const toast = useTuiToast()

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

/** 追加一条接口输出到输出区（高频输出时降级直接滚动，避免 smooth 积压，批次90 6.2） */
let lastOutputScroll = 0
function pushOutput(o: Omit<OutputEntry, 'id' | 'ts' | 'scope'> & { scope?: string }) {
  entries.value.push({
    ...o,
    scope: o.scope ?? '',
    id: ++idSeq,
    ts: Date.now(),
  })
  nextTick(() => {
    const el = outputEl.value
    if (!el) return
    const now = Date.now()
    // 连续输出（<800ms 间隔）直接赋值跳到底，单次输出用平滑滚动
    if (now - lastOutputScroll < 800) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
    lastOutputScroll = now
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

/** 复制命令到剪贴板（hover 高亮暗示可复制，补真实行为避免误导性 affordance） */
async function copyCommand(cmd: string) {
  try {
    await navigator.clipboard.writeText(cmd)
    toast.success('已复制命令')
  } catch {
    toast.error('复制失败')
  }
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

/** 会话列表方向键导航：↑/↓ 移动焦点到相邻会话（批次90 1.1） */
function onSessionsKeydown(e: KeyboardEvent, el: HTMLElement) {
  const items = Array.from(el.querySelectorAll<HTMLElement>('.session-select'))
  if (items.length === 0) return
  const idx = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    items[Math.min(idx + 1, items.length - 1)]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    items[Math.max(idx - 1, 0)]?.focus()
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
        <span class="title">
          <TuiIcon name="terminal" :size="15" />
          终端
        </span>
        <span class="hint" :title="activeSessionId || undefined">
          {{ activeSessionId ? `会话内执行：${activeSessionId.slice(0, 8)}…` : '单次命令执行' }}
        </span>
        <label class="toggle" :title="showAll ? '显示全部输出' : '仅显示当前会话 / 单次命令输出'">
          <input v-model="showAll" type="checkbox" />
          <span>全部输出</span>
        </label>
        <TuiButton variant="ghost" size="sm" :disabled="running" @click="term.refreshSessions()">
          刷新会话
        </TuiButton>
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
        <TuiEmpty
          v-if="displayEntries.length === 0"
          icon="terminal"
          title="等待命令"
          :hint="showAll || !activeSessionId ? '输入命令并回车执行，输出将显示在这里' : '该会话暂无输出，输入命令回车执行'"
          fill
        />
        <div v-for="e in displayEntries" :key="e.id" class="entry">
          <div
            class="entry-cmd"
            role="button"
            tabindex="0"
            title="复制命令"
            aria-label="复制命令"
            @click="copyCommand(e.command)"
            @keydown.enter.prevent="copyCommand(e.command)"
            @keydown.space.prevent="copyCommand(e.command)"
          >
            <span class="prompt">❯</span>
            <span class="cmd-text">{{ e.command }}</span>
            <span v-if="e.sessionId" class="session-tag" :title="e.sessionId">{{ e.sessionId.slice(0, 8) }}…</span>
          </div>
          <div v-if="e.stdout" class="entry-out stdout pre">{{ e.stdout }}</div>
          <div v-if="e.stderr" class="entry-out stderr pre">{{ e.stderr }}</div>
          <!-- 退出码：有结果才显示（执行中/无结果不打扰），成功 check / 失败 warning 弱提示 -->
          <div v-if="e.exitCode !== null" class="entry-exit" :class="e.exitCode === 0 ? 'ok' : 'err'">
            <TuiIcon :name="e.exitCode === 0 ? 'check' : 'warning'" :size="11" />
            退出码 {{ e.exitCode }}
          </div>
        </div>
      </div>

      <Transition name="fade">
        <div v-if="error" class="error" role="alert">
          <TuiIcon name="warning" :size="14" />
          <span>{{ error }}</span>
          <button class="error-dismiss" title="关闭" aria-label="关闭" @click="error = ''">
            <TuiIcon name="close" :size="12" />
          </button>
        </div>
      </Transition>

      <!-- 输入栏 -->
      <footer class="input-bar">
        <input
          v-model="input"
          type="text"
          aria-label="输入命令"
          placeholder="输入命令，回车执行"
          :disabled="running"
          spellcheck="false"
          @keydown.enter="run"
          @keydown.up.prevent="onHistory(1)"
          @keydown.down.prevent="onHistory(-1)"
        />
        <TuiButton variant="primary" :loading="running" :disabled="!input.trim()" @click="run">
          执行
        </TuiButton>
      </footer>
    </div>

    <!-- 会话面板 -->
    <aside class="session-panel">
      <header class="panel-header">
        <h3>持久化会话</h3>
        <span v-if="sessions.length" class="panel-count">{{ sessions.length }}</span>
      </header>

      <div class="create">
        <input v-model="newShell" name="term-shell" type="text" aria-label="Shell 路径" placeholder="Shell 路径（可选）" spellcheck="false" />
        <input v-model="newCwd" name="term-cwd" type="text" aria-label="工作目录" placeholder="工作目录（可选）" spellcheck="false" />
        <TuiButton variant="primary" class="create-btn" :disabled="termBusy" @click="createSession">新建会话</TuiButton>
      </div>

      <div v-if="sessions.length === 0" class="panel-empty">
        <TuiEmpty icon="chat" title="暂无会话" hint="在上方新建持久化会话" compact />
      </div>
      <ul v-else class="session-list" @keydown="(e) => onSessionsKeydown(e, e.currentTarget as HTMLElement)">
        <li
          v-for="s in sessions"
          :key="s.session_id"
          :class="{ active: s.session_id === activeSessionId }"
        >
          <button class="session-select" @click="activeSessionId = s.session_id">
            <span class="s-id" :title="s.session_id">{{ s.session_id.slice(0, 8) }}</span>
            <span class="s-meta" :title="s.shell + ' · ' + s.cwd">{{ s.shell }} · {{ s.cwd }}</span>
          </button>
          <button class="destroy" title="销毁会话" aria-label="销毁会话" @click="destroySession(s.session_id)">
            <TuiIcon name="trash" :size="13" />
          </button>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.terminal {
  display: flex;
  height: 100%;
  font-family: var(--font-mono);
  font-size: var(--fs-md);
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
  padding: 12px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}
.bar .title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: var(--fs-lg);
  color: var(--text-primary);
}
.bar .hint {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.bar .toggle {
  margin-left: auto;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.toggle input {
  /* 自定义 checkbox：appearance:none 自绘，保证 WebView2 下勾选态稳定可见（批次88 #15 修复原生 accent-color 对勾渲染不可靠） */
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  cursor: pointer;
  width: 14px;
  height: 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
  flex-shrink: 0;
}
.toggle input:hover {
  border-color: var(--accent);
}
.toggle input:checked {
  background: var(--accent);
  border-color: var(--accent);
}
/* 按压反馈：checkbox 按下微沉（批次89） */
.toggle input:active:not(:checked) {
  border-color: var(--accent);
}
/* 对勾：用遮罩构造（无字体依赖），与 --on-accent 呼应 */
.toggle input:checked::after {
  content: '';
  width: 8px;
  height: 4px;
  border-left: 2px solid var(--on-accent);
  border-bottom: 2px solid var(--on-accent);
  transform: rotate(-45deg) translate(0.5px, -0.5px);
}
.shells {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}
.shell-chip {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--fs-sm);
}
.shell-chip.default {
  background: var(--accent);
  color: var(--on-accent);
}
.output {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 12px 16px;
}
.entry {
  margin-bottom: 14px;
}
.entry-cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  /* 命令行 hover 反馈：文本缓变 accent，暗示条目可定位/可复制 */
  transition: background var(--dur-fast) var(--ease);
}
.entry-cmd:hover {
  background: var(--bg-muted);
}
.prompt {
  color: var(--accent);
  font-weight: 600;
}
.cmd-text {
  font-weight: 600;
  color: var(--text-primary);
  transition: color var(--dur-fast) var(--ease);
}
.entry-cmd:hover .cmd-text {
  color: var(--accent);
}
.session-tag {
  font-size: var(--fs-xs);
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.entry-out {
  margin: 6px 0 0 18px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-all;
}
.entry-out.stdout {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.entry-out.stderr {
  background: var(--danger-soft);
  color: var(--danger);
}
.entry-exit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0 18px;
  font-size: var(--fs-xs);
}
.entry-exit.ok {
  color: var(--success);
}
.entry-exit.err {
  color: var(--danger);
}
.error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--danger-soft);
  color: var(--danger);
  font-size: var(--fs-sm);
  background: var(--danger-soft);
}
.error .error-dismiss {
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
.error .error-dismiss:hover {
  opacity: 1;
  background: var(--danger-soft);
}
.input-bar {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
}
.input-bar input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--fs-md);
  outline: none;
  background: var(--bg-surface);
  color: var(--text-primary);
}
.input-bar input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/* 执行中禁用输入：与全局 disabled 语言一致（--disabled-opacity + 弱底弱字） */
.input-bar input:disabled {
  opacity: var(--disabled-opacity);
  background: var(--bg-muted);
  color: var(--text-muted);
  cursor: not-allowed;
}
.pre {
  font-family: var(--font-mono);
}

/* 会话面板：flex 纵向布局——header/create 固定（flex-shrink:0），仅列表区独立滚动，
   消除 sticky header 覆盖滚动首行的问题（批次87 #4） */
.session-panel {
  width: 280px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--border);
  padding: 0 12px 12px;
  overflow: hidden;
  font-family: var(--font-sans);
}
/* 面板 header：固定横条（不再 sticky，面板已 flex 分区），与左侧 .bar / 其他面板 header 同一视觉语言 */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin: 0 -12px 10px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.panel-header h3 {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}
/* 会话计数徽标（与规格列表 count 同款弱化 pill） */
.panel-count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  align-items: stretch;
  flex-shrink: 0;
}
.create input {
  height: var(--input-sm-h);
  padding: 0 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  outline: none;
  background: var(--bg-surface);
  color: var(--text-primary);
}
.create input:focus {
  border-color: var(--accent);
}
/* 新建会话按钮靠右对齐，避免占满窄面板整行 */
.create .create-btn {
  align-self: flex-end;
}
.panel-empty {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  text-align: center;
  padding: 16px 0;
}
.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  padding: 0;
  margin: 0;
}
.session-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease);
}
.session-list li.active {
  background: var(--accent-soft);
}
.session-list li:hover {
  background: var(--bg-muted);
}
.session-list li.active:hover {
  background: var(--accent-soft);
}
.session-list li.active .s-id {
  color: var(--accent);
}
.session-select {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  text-align: left;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.s-id {
  flex-shrink: 0;
  font-weight: 600;
  font-size: var(--fs-sm);
  color: var(--text-primary);
  margin-right: 6px;
}
/* 会话元信息（shell · cwd）：单行省略，完整内容靠 title 呈现（cwd 多为长路径，break-all 会生硬断行） */
.s-meta {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.destroy {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.session-list li:hover .destroy {
  opacity: 1;
}
/* 键盘聚焦时也显形：Tab 可聚焦到 opacity:0 按钮，焦点环需可见 */
.destroy:focus-visible {
  opacity: 1;
}
.destroy:hover {
  color: var(--danger);
  background: var(--danger-soft);
}
/* 按压反馈（批次89） */
.destroy:active {
  transform: scale(var(--press-scale));
}
</style>
<script setup lang="ts">
/**
 * TerminalView：真终端界面（7.1 升级，2026-09-01；观感对齐系统终端第二波）
 *
 * 面板即终端——无按钮/会话选择/输入框：挂载时自动保证一个持久化会话
 * （复用已存在 session-*，否则自动创建），xterm.js 渲染原始 ANSI/VT 字节流，
 * 100ms 轮询 `terminal_poll_output` 增量拉取；键盘/右键菜单操作原始转发
 * （append_return=false）；容器尺寸变化 fit + 下发 resize。
 *
 * 观感对齐 Windows Terminal（用户拍板「对齐系统终端观感」）：
 * - Campbell 系统 16 色 + 深色底 0C0C0C（Windows Terminal 默认方案）
 * - Cascadia Mono → Consolas 等宽字体（Win11 自带优先）
 * - 面板头信息条（终端信息/路径头）：shell 名 + OSC 标题同步（PowerShell/cmd
 *   每次 cd 都会把当前目录写进窗口标题 → onTitleChange 实时显示）
 * - 右键菜单：复制 / 粘贴 / 清屏（对标系统终端交互）
 *
 * 数据流：PTY → out_rx（后台线程）→ SessionOutputBuf（后端）→ poll 增量 →
 * term.write()。Agent 工具链 exec（clean_ansi 文本）与此视图解耦。
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTerminalRust } from '../composables/useTerminalRust'
import { useTuiToast } from '../../components/ui/useTuiToast'
import { WsIcon } from '@worldsmith/ui-kit'
// 当前打开目录（Agent 工作空间）读取：entity-core FileStorageBackend.projectDir
import { getFileStorageBackend } from '@worldsmith/entity-core/core'

const term = useTerminalRust()
const toast = useTuiToast()

/** xterm 容器 */
const termEl = ref<HTMLElement | null>(null)

const termInst = ref<Terminal | null>(null)
const fitAddon = ref<FitAddon | null>(null)

/** 当前会话 id（自动获取/创建） */
const sessionId = ref('')
/** 会话 shell 路径（header 显示） */
const shellPath = ref('')
/** 会话初始 cwd（header 显示兜底） */
const sessionCwd = ref('')
/** OSC 标题（shell 写进窗口标题的实时值，如 PowerShell 当前位置） */
const oscTitle = ref('')
/** 面板头标题：OSC 标题优先；兜底 Windows Terminal tab 风格「路径 — shell」 */
const headerTitle = computed(() =>
  oscTitle.value
    ? oscTitle.value
    : sessionCwd.value && sessionCwd.value !== '.'
      ? `${sessionCwd.value} — ${shellName.value}`
      : shellName.value,
)

/** shell 显示名（cmd / PowerShell / wsl vs bash …） */
const shellName = computed(() => {
  const p = shellPath.value.toLowerCase()
  if (p.includes('powershell')) return 'PowerShell'
  if (p.includes('cmd')) return '命令提示符'
  if (p.includes('wsl')) return 'WSL'
  if (p.includes('bash')) return 'bash'
  if (p.includes('zsh')) return 'zsh'
  if (p.includes('sh')) return 'sh'
  return shellPath.value || '终端'
})

/** 轮询偏移游标（后端 SessionOutputBuf 绝对偏移） */
let pollOffset = 0
/** 轮询句柄 */
let pollTimer: number | null = null
/** 是否已卸载（停止轮询/事件） */
let disposed = false
/** 容器尺寸观察器 */
let resizeObserver: ResizeObserver | null = null

/** 右键菜单状态 */
const ctxMenu = ref<{ x: number; y: number; canCopy: boolean } | null>(null)

/** Campbell 配色（Windows Terminal 默认 16 色 + 深色底），对齐系统终端观感 */
function buildTerminal(): Terminal {
  const t = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
    fontSize: 13,
    lineHeight: 1.1,
    theme: {
      background: '#0C0C0C',
      foreground: '#CCCCCC',
      cursor: '#F2F2F2',
      selectionBackground: 'rgba(113, 113, 113, 0.35)',
      black: '#0C0C0C',
      red: '#C50F1F',
      green: '#13A10E',
      yellow: '#C19C00',
      blue: '#0037DA',
      magenta: '#881798',
      cyan: '#3A96DD',
      white: '#CCCCCC',
      brightBlack: '#767676',
      brightRed: '#E74856',
      brightGreen: '#16C60C',
      brightYellow: '#F9F1A5',
      brightBlue: '#3B78FF',
      brightMagenta: '#B4009E',
      brightCyan: '#61D6D6',
      brightWhite: '#F2F2F2',
    },
    scrollback: 5000,
    convertEol: false,
    allowProposedApi: true,
  })
  return t
}

/** 轮询一次会话输出 → 写 xterm */
async function pollTick(): Promise<void> {
  if (disposed || !sessionId.value) return
  try {
    const r = await term.pollOutput(sessionId.value, pollOffset)
    // 缓冲被裁剪（offset 早于最旧字节）：清屏重置 + 从最旧重读
    if (r.truncated) {
      termInst.value?.reset()
      pollOffset = 0
    }
    if (r.output) {
      termInst.value?.write(r.output)
    }
    pollOffset = r.offset
  } catch (err) {
    // 会话可能已销毁/后端暂不可用：降噪日志，轮询继续（下次可能恢复）
    console.warn('[TerminalView] poll 失败:', err)
  }
}

/** 键盘输入 → 原始转发（append_return=false，回车由键盘自行发出） */
function onTermData(data: string): void {
  if (!sessionId.value) return
  void term.inputSession(sessionId.value, data, false)
}

/** 右键菜单打开（模板 @contextmenu 绑定）：定位 + 是否有选中文本 */
function onContextMenu(e: MouseEvent): void {
  const t = termInst.value
  ctxMenu.value = {
    x: e.clientX,
    y: e.clientY,
    canCopy: !!t?.getSelection(),
  }
}

/** 右键菜单动作 */
async function onMenuAction(action: 'copy' | 'paste' | 'clear'): Promise<void> {
  ctxMenu.value = null
  const t = termInst.value
  if (!t || !sessionId.value) return
  try {
    if (action === 'copy') {
      const sel = t.getSelection()
      if (sel) await navigator.clipboard.writeText(sel)
      t.clearSelection()
    } else if (action === 'paste') {
      const text = await navigator.clipboard.readText()
      if (text) await term.inputSession(sessionId.value, text, false)
    } else {
      t.clear()
    }
  } catch (err) {
    toast.error(`操作失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 保证会话存在：复用已存在会话（持久化语义），否则自动创建 */
async function ensureSession(): Promise<string> {
  try {
    await term.refreshSessions()
    const existing = term.sessions.value
    if (existing && existing.length > 0) {
      const s = existing[0]
      shellPath.value = s.shell
      sessionCwd.value = s.cwd
      return s.session_id
    }
    // 无状态打开：默认 cwd 跟随当前打开的 Agent 工作空间目录；
    // 未打开任何项目目录时前端不传（后端兜底用户目录 USERPROFILE/HOME）。
    const currentProjectDir = getFileStorageBackend()?.projectDir ?? null
    const created = currentProjectDir
      ? await term.createSession({ cwd: currentProjectDir })
      : await term.createSession({})
    shellPath.value = created.shell_path ?? ''
    sessionCwd.value = created.cwd ?? ''
    return created.session_id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toast.error(`终端会话创建失败: ${msg}`)
    throw err
  }
}

onMounted(async () => {
  await nextTick()
  try {
    sessionId.value = await ensureSession()
  } catch {
    // ensureSession 已 toast；仍渲染空终端占位
    return
  }
  if (disposed || !termEl.value) return

  // 初始化 xterm + fit
  const t = buildTerminal()
  const fit = new FitAddon()
  t.loadAddon(fit)
  t.open(termEl.value)
  t.onData(onTermData)
  // OSC 标题同步（PowerShell/cmd 每次 cd 写窗口标题 → header 路径头实时显示）
  t.onTitleChange((title: string) => {
    const clean = title.replace(/[\u0000-\u001f\u007f]/g, '')
    if (clean) oscTitle.value = clean
  })
  termInst.value = t
  fitAddon.value = fit

  // 容器尺寸变化 → fit + 下发 resize（ConPTY ResizePseudoConsole，TUI 布局随窗口自适应）
  const syncSize = (): void => {
    try {
      fit.fit()
      const proposed = fit.proposeDimensions()
      if (proposed && sessionId.value) {
        void term.resizeSession(sessionId.value, proposed.cols, proposed.rows)
      }
    } catch (err) {
      console.warn('[TerminalView] fit/resize 失败:', err)
    }
  }
  resizeObserver = new ResizeObserver(() => {
    // rAF 节流：容器拖动/折叠频繁触发
    requestAnimationFrame(syncSize)
  })
  if (termEl.value) resizeObserver.observe(termEl.value)
  // 初始 fit + 同步尺寸
  syncSize()

  // 启动输出轮询
  pollTimer = window.setInterval(() => { void pollTick() }, 100)
})

onUnmounted(() => {
  disposed = true
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  termInst.value?.dispose()
  termInst.value = null
  fitAddon.value = null
})
</script>

<template>
  <div class="terminal" @click="ctxMenu = null">
    <!-- 面板头信息条（终端信息/路径头）：shell 名 + OSC 标题（当前目录），对标系统终端窗口标题 -->
    <header class="terminal-head">
      <WsIcon name="terminal" :size="13" :stroke-width="1.7" />
      <span class="head-title" :title="headerTitle">{{ headerTitle }}</span>
      <span class="head-shell">{{ shellName }}</span>
    </header>

    <div ref="termEl" class="terminal-term" @contextmenu.prevent="onContextMenu"></div>

    <!-- 右键菜单（复制/粘贴/清屏，对标系统终端交互） -->
    <Transition name="fade">
      <div
        v-if="ctxMenu"
        class="ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <button class="ctx-item" :disabled="!ctxMenu.canCopy" @click="onMenuAction('copy')">复制</button>
        <button class="ctx-item" @click="onMenuAction('paste')">粘贴</button>
        <button class="ctx-item" @click="onMenuAction('clear')">清屏</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.terminal {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #0c0c0c;
  position: relative;
}
/* 面板头：极简信息条（无按钮），风格对齐 Windows Terminal tab 标题 */
.terminal-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 6px 12px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  color: #969696;
  font-size: 12px;
  user-select: none;
}
.head-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono), Consolas, monospace;
}
.head-shell {
  flex-shrink: 0;
  font-size: 11px;
  color: #6f6f6f;
}
.terminal-term {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 6px 4px 8px;
  overflow: hidden;
}
/* xterm 自身填充面板，覆盖其默认 padding */
.terminal-term :deep(.xterm) {
  height: 100%;
}
.terminal-term :deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 148, 158, 0.35) transparent;
}
/* 右键菜单：浮动小菜单，暗色终端风格 */
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 96px;
  padding: 4px;
  border-radius: 6px;
  background: #2d2d2d;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
}
.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #e6e6e6;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.ctx-item:hover:not(:disabled) {
  background: #454545;
}
.ctx-item:disabled {
  color: #6a6a6a;
  cursor: not-allowed;
}
/* 右键菜单淡入淡出（scoped 自给全局同名过渡，避免依赖全局定义） */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
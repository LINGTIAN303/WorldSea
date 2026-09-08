/**
 * LSP 外挂接入（智能提示三期 B1，立项 §五）：
 * codemirror-languageserver 自定义 Transport ↔ Tauri IPC ↔ Rust stdio 桥（lsp_commands.rs）。
 * server 按语言常驻（Rust 侧单例，编辑器卸载不停进程，App 退出统一回收）；
 * 未装 server 时 lspAvailable 返回 null，CodeEditor 回落既有路径（tsAssist/entityAssist）。
 */
import { languageServerWithTransport, type Transport } from 'codemirror-languageserver'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { reactive } from 'vue'
import type { Extension } from '@codemirror/state'

/** 与 Rust server_spec 对应：值得探测的语言集合（json 走 D 期 entityAssist 不在内） */
export const LSP_CANDIDATE_LANGS = new Set(['rust', 'python', 'go', 'c', 'cpp', 'ts', 'tsx', 'js', 'jsx'])

/** LSP languageId（规范标准名） */
function languageIdOf(lang: string): string {
  switch (lang) {
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'typescriptreact'
    case 'js':
      return 'javascript'
    case 'jsx':
      return 'javascriptreact'
    case 'cpp':
      return 'cpp'
    default:
      return lang
  }
}

/** Windows 路径 → file URI（百分号编码段；server 端宽松解码） */
function toFileUri(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const encoded = norm.split('/').map(encodeURIComponent).join('/')
  return 'file://' + (encoded.startsWith('/') ? '' : '/') + encoded
}

// ── 探测缓存：进程内一次 ──
const detectCache = new Map<string, string | null>()

/** 语言是否可用 LSP（返回 server 路径 / null）；探测失败静默 */
export async function lspAvailable(lang: string): Promise<string | null> {
  if (!LSP_CANDIDATE_LANGS.has(lang)) return null
  if (detectCache.has(lang)) return detectCache.get(lang) ?? null
  try {
    const exe = await invoke<string | null>('cmd_lsp_detect', { lang })
    detectCache.set(lang, exe ?? null)
    return exe ?? null
  } catch {
    detectCache.set(lang, null)
    return null
  }
}

// ── 状态跟踪：按语言的 LSP 生命周期（编辑器角标消费；reactive Map 支持响应式读取）──
// starting=启动中 loading=已连接·索引中（大项目首次可达 1 分钟以上）ready=诊断已到达（可用）
// slow=索引超时未出诊断（角标淡化，避免孤儿目录/超慢项目永久转圈）
// failed=启动失败（调用方回落既有提示路径）closed=server 进程退出（重开文件可重建）
export type LspStatus = 'starting' | 'loading' | 'slow' | 'ready' | 'failed' | 'closed'
const statusByLang = reactive(new Map<string, LspStatus>())
/** 无工程上下文：root 沿父链上溯未命中任何工程清单（孤儿目录，server 大概率不产诊断） */
const noProjectByLang = reactive(new Map<string, boolean>())
/** starting/loading → slow 的超时定时器（每语言一个；状态推进时取消） */
const slowTimers = new Map<string, number>()
const SLOW_MS = 15_000

export function lspStatusOf(lang: string): LspStatus | undefined {
  return statusByLang.get(lang)
}

export function lspNoProjectOf(lang: string): boolean {
  return noProjectByLang.get(lang) === true
}

function cancelSlow(lang: string): void {
  const t = slowTimers.get(lang)
  if (t !== undefined) {
    clearTimeout(t)
    slowTimers.delete(lang)
  }
}

/** 起算：starting/loading 超时未出诊断 → slow（仅在状态进入时调度一次，避免消息流持续续期） */
function scheduleSlow(lang: string): void {
  cancelSlow(lang)
  const t = window.setTimeout(() => {
    slowTimers.delete(lang)
    const cur = statusByLang.get(lang)
    if (cur === 'starting' || cur === 'loading') statusByLang.set(lang, 'slow')
  }, SLOW_MS)
  slowTimers.set(lang, t)
}

// ── 全局消息分发：lsp-message {lang, body?, closed?} → 该语言的全部 transport ──
type StrCb = (message: string) => void
const transportsByLang = new Map<string, Set<TransportImpl>>()
let listenStarted = false

async function ensureListen(): Promise<void> {
  if (listenStarted) return
  listenStarted = true
  await listen<{ lang: string; body?: string; closed?: boolean }>('lsp-message', (e) => {
    const set = transportsByLang.get(e.payload.lang)
    if (!set) return
    if (e.payload.closed) {
      for (const t of [...set]) t.handleClose()
    } else if (e.payload.body !== undefined) {
      for (const t of [...set]) t.handleMessage(e.payload.body)
    }
  })
}

/** Transport 实现：字符串直通（Rust 桥已解帧）；close 仅前端摘除（进程常驻语义）。
 *  消息/错误顺带驱动语言级状态：首条消息 → loading，诊断到达 → ready，写失败 → failed */
class TransportImpl implements Transport {
  private msgCbs: StrCb[] = []
  private closeCbs: (() => void)[] = []
  private errCbs: ((e: Error) => void)[] = []
  // erasableSyntaxOnly：禁构造器参数属性，显式字段赋值
  private lang: string
  constructor(lang: string) {
    this.lang = lang
    let set = transportsByLang.get(lang)
    if (!set) {
      set = new Set()
      transportsByLang.set(lang, set)
    }
    set.add(this)
  }
  send(message: string): void {
    void invoke('cmd_lsp_send', { lang: this.lang, body: message }).catch((e) => {
      cancelSlow(this.lang)
      statusByLang.set(this.lang, 'failed')
      for (const cb of this.errCbs) cb(e instanceof Error ? e : new Error(String(e)))
    })
  }
  onMessage(cb: StrCb): void {
    this.msgCbs.push(cb)
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb)
  }
  onError(cb: (e: Error) => void): void {
    this.errCbs.push(cb)
  }
  close(): void {
    transportsByLang.get(this.lang)?.delete(this)
  }
  handleMessage(m: string): void {
    // 状态推进：server 响应到达即已连接；publishDiagnostics = 文件分析完成（补全/悬停可用信号）
    const cur = statusByLang.get(this.lang)
    if (cur === 'starting' || cur === 'loading' || cur === 'slow') {
      if (m.includes('publishDiagnostics')) {
        cancelSlow(this.lang)
        statusByLang.set(this.lang, 'ready')
      } else if (cur !== 'loading') {
        statusByLang.set(this.lang, 'loading')
        scheduleSlow(this.lang) // 进入 loading 起算；已在 loading 时不续期，保证超时能落地
      }
    }
    for (const cb of [...this.msgCbs]) cb(m)
  }
  handleClose(): void {
    cancelSlow(this.lang)
    statusByLang.set(this.lang, 'closed')
    for (const cb of [...this.closeCbs]) cb()
  }
}

/** LSP 三源扩展（补全/悬停/诊断/跳转/重命名由包内置）：CodeEditor 编辑态且已装 server 时挂载。
 *  返回 null = server 启动失败/包内初始化异常（调用方回落既有提示路径，不再静默死管道） */
/** Rust cmd_lsp_start 返回：工程根（沿父链上溯命中的清单目录）+ 是否命中清单 */
interface LspStartInfo {
  root: string
  hasManifest: boolean
}

export async function lspAssistExts(lang: string, filePath: string): Promise<Extension[] | null> {
  await ensureListen()
  statusByLang.set(lang, 'starting')
  const started = await invoke<LspStartInfo>('cmd_lsp_start', {
    lang,
    exe: (await lspAvailable(lang)) ?? '',
    filePath,
  }).then(
    (info) => info,
    (e) => {
      console.warn(`[lspAssist] ${lang} server 启动失败:`, e)
      return null
    },
  )
  if (!started) {
    cancelSlow(lang)
    statusByLang.set(lang, 'failed')
    return null
  }
  noProjectByLang.set(lang, !started.hasManifest)
  scheduleSlow(lang) // 启动即起算：server 无响应也不会永久停在「连接中」
  // rootUri = Rust 侧算出的工程根（同口径，否则 server 找不到 workspace）；workspaceFolders 形参必填传 null
  const norm = filePath.replace(/\\/g, '/')
  const dir = norm.slice(0, norm.lastIndexOf('/')) || '/'
  const transport = new TransportImpl(lang)
  try {
    return languageServerWithTransport({
      transport,
      rootUri: toFileUri(started.root || dir),
      workspaceFolders: null,
      documentUri: toFileUri(filePath),
      languageId: languageIdOf(lang),
      autoClose: true,
    }) as Extension[]
  } catch (e) {
    console.warn(`[lspAssist] ${lang} languageserver 扩展初始化失败:`, e)
    transport.close()
    cancelSlow(lang)
    statusByLang.set(lang, 'failed')
    return null
  }
}

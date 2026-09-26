/**
 * TS 智能提示 CM6 侧映射（智能提示二期 A，立项 §四）：
 * 三源与 entitySchemaAssist 同形态（统一接入层约定）——补全（override 独占）/悬停/诊断。
 * worker 懒创建：本模块静态 import 不拉 typescript（引擎在 tsWorker.ts 独立 chunk，
 * 首次 new Worker 才加载），CodeEditor 仅在 ts/tsx/js/jsx 编辑态调用 tsAssistExts。
 */
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { EditorView, hoverTooltip } from '@codemirror/view'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'

// ── worker 单例 + RPC ──
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker {
  if (worker) return worker
  // new URL 必须内联在 new Worker 调用中（Vite 打包识别模式）；typescript 引擎随此独立 chunk 懒加载
  worker = new Worker(new URL('./tsWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
    const p = pending.get(e.data.id)
    if (p) {
      pending.delete(e.data.id)
      p.resolve(e.data.result)
    }
  }
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new Error('ts worker error'))
    pending.clear()
  }
  return worker
}

function rpc<T>(msg: Record<string, unknown>): Promise<T> {
  const w = ensureWorker()
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage({ id, ...msg })
  })
}

/** TS ScriptElementKind → CM 补全 type（图标/着色分组，未收录留空） */
function kindToCm(kind: string): string {
  if (kind === 'warning' || kind === 'keyword') return 'keyword'
  if (kind === 'class' || kind === 'constructor') return 'class'
  if (kind === 'interface' || kind === 'type' || kind === 'enum') return 'type'
  if (kind === 'function' || kind === 'method') return 'function'
  if (kind === 'member' || kind === 'property' || kind === 'getter' || kind === 'setter') return 'property'
  if (kind === 'var' || kind === 'let' || kind === 'const' || kind === 'local' || kind === 'parameter') return 'variable'
  if (kind === 'module') return 'namespace'
  return 'text'
}

// ── 补全源 ──
async function tsCompletionSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const word = ctx.matchBefore(/[A-Za-z0-9_$]*$/)
  if (word === null) return null
  let entries: { label: string; kind: string; detail: string }[] = []
  try {
    entries = await rpc({ type: 'completions', offset: ctx.pos })
  } catch {
    return null
  }
  if (!entries.length) return null
  return {
    from: word.from,
    options: entries.map((en) => ({ label: en.label, detail: en.detail, type: kindToCm(en.kind) })),
  }
}

// ── 悬停源：类型签名 + 文档 ──
const hover = hoverTooltip(async (_view, pos) => {
  let info: { display: string; doc: string } | null = null
  try {
    info = await rpc({ type: 'hover', offset: pos })
  } catch {
    return null
  }
  if (!info || !info.display) return null
  return {
    pos,
    create: () => {
      const dom = document.createElement('div')
      dom.className = 'ws-schema-tip'
      const sig = document.createElement('code')
      sig.textContent = info.display
      dom.append(sig)
      if (info.doc) {
        const d = document.createElement('div')
        d.textContent = info.doc
        dom.append(d)
      }
      return { dom }
    },
  }
})

// ── 诊断源（linter 自带节流；worker 内按版本缓存） ──
const lint = linter(async (view) => {
  let list: { start: number; length: number; severity: string; message: string }[] = []
  try {
    list = await rpc({ type: 'diagnostics' })
  } catch {
    return [] as Diagnostic[]
  }
  const len = view.state.doc.length
  return list.map<Diagnostic>((d) => ({
    from: Math.min(d.start, len),
    to: Math.min(d.start + d.length, len),
    severity: (d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info') as Diagnostic['severity'],
    message: d.message,
  }))
})

/** 文档同步：编辑变更推送 worker（三源与诊断回填共用） */
function syncUpdateExt(): Extension {
  return EditorView.updateListener.of((u) => {
    if (u.docChanged) void rpc({ type: 'update', text: u.state.doc.toString() })
  })
}

/** 三源集合：CodeEditor 编辑态 ts/tsx/js/jsx 时挂载（传入虚拟文件名定 scriptKind 与初始全文）；
 *  override 独占补全源（2026-09-08 恢复：全局默认已换 wsBasicSetup 去掉 basicSetup 的
 *  autocompletion 实例，本实例唯一不互扰，data.of 方案实测不弹已废弃） */
export function tsAssistExts(fileName: string, initialText: string): Extension[] {
  void rpc({ type: 'open', name: fileName, text: initialText })
  return [autocompletion({ override: [tsCompletionSource] }), hover, lint, lintGutter(), syncUpdateExt()]
}

/** 仅诊断源（A5 遗留回落）：LSP 已接管补全/悬停但诊断缺失（tsls 对无工程上下文的孤儿文件
 *  拒析）时补挂——不挂 autocompletion/hover，避免与 LSP 源并存产生双份补全/悬停 */
export function tsAssistLintExts(fileName: string, initialText: string): Extension[] {
  void rpc({ type: 'open', name: fileName, text: initialText })
  return [lint, lintGutter(), syncUpdateExt()]
}

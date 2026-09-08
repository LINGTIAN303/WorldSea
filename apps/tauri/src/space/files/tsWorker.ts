/**
 * TS 语言服务 Worker（智能提示二期 A，立项 §四）：
 * typescript@6.0.3 传统 API（ts.createLanguageService + 内存 Host，monaco ts worker 同原理）。
 * 单文件模式：仅当前编辑文件自洽推断——项目级跨文件归 B1 LSP（立项分期边界）；
 * lib 文本来自 tsLibBundle.ts（构建期闭包，浏览器无文件系统）。
 * RPC：open/update/completions/hover/diagnostics，id 关联请求-响应。
 */
/// <reference lib="webworker" />
import ts from 'typescript'
import { TS_LIBS } from './tsLibBundle'

let fileName = '/virtual/main.ts'
let content = ''
let version = 0

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [fileName, ...Object.keys(TS_LIBS)],
  getScriptVersion: (f) => (f === fileName ? String(version) : '1'),
  getScriptSnapshot: (f) => {
    if (f === fileName) return ts.ScriptSnapshot.fromString(content)
    const lib = TS_LIBS[f]
    return lib ? ts.ScriptSnapshot.fromString(lib) : undefined
  },
  getCurrentDirectory: () => '/virtual',
  getCompilationSettings: () => ({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowNonTsExtensions: true,
    allowJs: true,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
  }),
  getDefaultLibFileName: () => 'lib.es2020.full.d.ts',
  fileExists: (f) => f === fileName || f in TS_LIBS,
  readFile: (f) => (f === fileName ? content : TS_LIBS[f]),
  readDirectory: () => [],
  directoryExists: () => true,
  getDirectories: () => [],
}

const service = ts.createLanguageService(host, ts.createDocumentRegistry())

// 诊断按版本缓存（补全/悬停高频，诊断可复用同版本结果）
let diagVersion = -1
let diagCache: { start: number; length: number; severity: string; message: string }[] = []

/** 噪音过滤：模块解析失败（单文件模式下 import 必然无解析目标，归 B1 项目级能力） */
const IGNORED_DIAG_CODES = new Set([2307, 2792])

type Req =
  | { id: number; type: 'open'; name: string; text: string }
  | { id: number; type: 'update'; text: string }
  | { id: number; type: 'completions'; offset: number }
  | { id: number; type: 'hover'; offset: number }
  | { id: number; type: 'diagnostics' }

self.onmessage = (e: MessageEvent<Req>): void => {
  const req = e.data
  const respond = (result: unknown): void => postMessage({ id: req.id, result })
  switch (req.type) {
    case 'open':
      fileName = req.name
      content = req.text
      version++
      respond(null)
      break
    case 'update':
      content = req.text
      version++
      respond(null)
      break
    case 'completions': {
      const info = service.getCompletionsAtPosition(fileName, req.offset, {
        includeCompletionsWithInsertText: true,
      })
      respond(
        info
          ? info.entries.slice(0, 300).map((en) => ({
              label: en.name,
              kind: en.kind,
              detail: en.labelDetails?.description ?? en.kind,
            }))
          : [],
      )
      break
    }
    case 'hover': {
      const qi = service.getQuickInfoAtPosition(fileName, req.offset)
      respond(
        qi
          ? {
              display: ts.displayPartsToString(qi.displayParts),
              doc: ts.displayPartsToString(qi.documentation),
            }
          : null,
      )
      break
    }
    case 'diagnostics': {
      if (diagVersion !== version) {
        diagVersion = version
        const all = [...service.getSyntacticDiagnostics(fileName), ...service.getSemanticDiagnostics(fileName)]
        diagCache = all
          .filter((d) => !IGNORED_DIAG_CODES.has(d.code))
          .map((d) => ({
            start: d.start ?? 0,
            length: d.length ?? 0,
            severity:
              d.category === ts.DiagnosticCategory.Error
                ? 'error'
                : d.category === ts.DiagnosticCategory.Warning
                  ? 'warning'
                  : 'info',
            message: `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
          }))
      }
      respond(diagCache)
      break
    }
  }
}

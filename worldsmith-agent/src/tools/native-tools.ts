/**
 * 桌面原生能力工具集
 *
 * 通过 Tauri 插件提供桌面原生能力，Web 模式下降级或提示不可用。
 *
 * 工具:
 * - dialog_open: 打开文件选择对话框
 * - dialog_save: 打开保存文件对话框
 * - dialog_message: 显示消息对话框
 * - dialog_ask: 显示询问对话框（是/否）
 * - clipboard_read: 读取剪贴板内容
 * - clipboard_write: 写入剪贴板
 * - open_url: 打开 URL 或本地文件
 * - notify: 发送系统通知
 * - native_fetch: Tauri 原生 HTTP 请求（绕过 CORS）
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import { isTauri } from '../execution'

async function getTauriInvoke() {
  if (!isTauri()) return null
  try {
    const api = await import('@tauri-apps/api/core')
    return api.invoke
  } catch {
    return null
  }
}

// ── dialog_open ──────────────────────────────────────────

const dialogOpenTool: ToolDefinition = {
  name: 'dialog_open',
  description: '打开文件选择对话框，让用户选择一个或多个文件。返回选中的文件路径列表。',
  parameters: {
    title: { type: 'string', description: '对话框标题' },
    multiple: { type: 'boolean', description: '是否允许多选' },
    directory: { type: 'boolean', description: '是否选择目录而非文件' },
    filters: { type: 'string', description: '文件过滤器，JSON 格式如 [{"name":"Images","extensions":["png","jpg"]}]' },
  },
  meta: {
    permission: 'moderate',
    category: 'native',
    displayName: '打开文件对话框',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '文件对话框仅在 Tauri 桌面模式下可用' })

    try {
      const filterArr = args.filters ? JSON.parse(String(args.filters)) : undefined
      const result = await invoke('plugin:dialog|open', {
        title: args.title || undefined,
        multiple: !!args.multiple,
        directory: !!args.directory,
        filters: filterArr,
      })
      return JSON.stringify({ ok: true, paths: result })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── dialog_save ──────────────────────────────────────────

const dialogSaveTool: ToolDefinition = {
  name: 'dialog_save',
  description: '打开保存文件对话框，让用户选择保存位置和文件名。返回选中的文件路径。',
  parameters: {
    title: { type: 'string', description: '对话框标题' },
    defaultPath: { type: 'string', description: '默认文件路径' },
    filters: { type: 'string', description: '文件过滤器，JSON 格式如 [{"name":"Text","extensions":["txt"]}]' },
  },
  meta: {
    permission: 'moderate',
    category: 'native',
    displayName: '保存文件对话框',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '保存对话框仅在 Tauri 桌面模式下可用' })

    try {
      const filterArr = args.filters ? JSON.parse(String(args.filters)) : undefined
      const result = await invoke('plugin:dialog|save', {
        title: args.title || undefined,
        defaultPath: args.defaultPath || undefined,
        filters: filterArr,
      })
      return JSON.stringify({ ok: true, path: result })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── dialog_message ───────────────────────────────────────

const dialogMessageTool: ToolDefinition = {
  name: 'dialog_message',
  description: '显示原生消息对话框。',
  parameters: {
    title: { type: 'string', description: '对话框标题', required: true },
    message: { type: 'string', description: '消息内容', required: true },
    kind: { type: 'string', description: '消息类型：info / warning / error' },
  },
  meta: {
    permission: 'safe',
    category: 'native',
    alwaysAvailable: true,
    displayName: '消息对话框',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '消息对话框仅在 Tauri 桌面模式下可用' })

    try {
      await invoke('plugin:dialog|message', {
        title: String(args.title),
        message: String(args.message),
        kind: String(args.kind || 'info'),
      })
      return JSON.stringify({ ok: true })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── dialog_ask ───────────────────────────────────────────

const dialogAskTool: ToolDefinition = {
  name: 'dialog_ask',
  description: '显示询问对话框（是/否），返回用户选择。',
  parameters: {
    title: { type: 'string', description: '对话框标题', required: true },
    message: { type: 'string', description: '询问内容', required: true },
    kind: { type: 'string', description: '消息类型：info / warning / error' },
  },
  meta: {
    permission: 'safe',
    category: 'native',
    alwaysAvailable: true,
    displayName: '询问对话框',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '询问对话框仅在 Tauri 桌面模式下可用' })

    try {
      const result = await invoke('plugin:dialog|ask', {
        title: String(args.title),
        message: String(args.message),
        kind: String(args.kind || 'info'),
      })
      return JSON.stringify({ ok: true, confirmed: result })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── clipboard_read ───────────────────────────────────────

const clipboardReadTool: ToolDefinition = {
  name: 'clipboard_read',
  description: '读取系统剪贴板的文本内容。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'native',
    alwaysAvailable: true,
    displayName: '读取剪贴板',
  } satisfies ToolMeta,
  execute: async (_args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '剪贴板读取仅在 Tauri 桌面模式下可用' })

    try {
      const result = await invoke('plugin:clipboard-manager|read_text')
      return JSON.stringify({ ok: true, text: result })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── clipboard_write ──────────────────────────────────────

const clipboardWriteTool: ToolDefinition = {
  name: 'clipboard_write',
  description: '将文本写入系统剪贴板。',
  parameters: {
    text: { type: 'string', description: '要写入剪贴板的文本', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'native',
    alwaysAvailable: true,
    displayName: '写入剪贴板',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '剪贴板写入仅在 Tauri 桌面模式下可用' })

    try {
      await invoke('plugin:clipboard-manager|write_text', { text: String(args.text) })
      return JSON.stringify({ ok: true })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── open_url ─────────────────────────────────────────────

const openUrlTool: ToolDefinition = {
  name: 'open_url',
  description: '在默认浏览器中打开 URL，或用默认应用打开本地文件。',
  parameters: {
    url: { type: 'string', description: '要打开的 URL 或本地文件路径', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'native',
    displayName: '打开 URL',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '打开 URL 仅在 Tauri 桌面模式下可用' })

    try {
      await invoke('plugin:opener|open_url', { url: String(args.url) })
      return JSON.stringify({ ok: true, url: String(args.url) })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── notify ───────────────────────────────────────────────

const notifyTool: ToolDefinition = {
  name: 'notify',
  description: '发送系统原生通知。',
  parameters: {
    title: { type: 'string', description: '通知标题', required: true },
    body: { type: 'string', description: '通知内容', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'native',
    alwaysAvailable: true,
    displayName: '通知',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '系统通知仅在 Tauri 桌面模式下可用' })

    try {
      await invoke('plugin:notification|notify', {
        title: String(args.title),
        body: String(args.body),
      })
      return JSON.stringify({ ok: true })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ── native_fetch ─────────────────────────────────────────

const nativeFetchTool: ToolDefinition = {
  name: 'native_fetch',
  description: '通过 Tauri 原生 HTTP 客户端发起请求，可绕过浏览器 CORS 限制。支持 GET/POST/PUT/DELETE 等方法。',
  parameters: {
    url: { type: 'string', description: '请求 URL', required: true },
    method: { type: 'string', description: 'HTTP 方法：GET/POST/PUT/DELETE，默认 GET' },
    headers: { type: 'string', description: '请求头，JSON 格式如 {"Content-Type":"application/json"}' },
    body: { type: 'string', description: '请求体（POST/PUT 时使用）' },
    timeout: { type: 'number', description: '超时时间（秒），默认 30' },
  },
  meta: {
    permission: 'moderate',
    category: 'native',
    displayName: '原生HTTP请求',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const invoke = await getTauriInvoke()
    if (!invoke) return JSON.stringify({ ok: false, error: '原生 HTTP 请求仅在 Tauri 桌面模式下可用' })

    try {
      const headers = args.headers ? JSON.parse(String(args.headers)) : {}
      const method = String(args.method || 'GET').toUpperCase()
      const fetchArgs: Record<string, unknown> = {
        url: String(args.url),
        method,
        headers,
        connectTimeout: (Number(args.timeout) || 30) * 1000,
      }
      if (args.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        fetchArgs.body = { type: 'Text', content: String(args.body) }
      }

      const result = await invoke('plugin:http|fetch', fetchArgs) as {
        status: number
        headers: Record<string, string>
        body: string
        ok: boolean
      }

      return JSON.stringify({
        ok: result.ok ?? (result.status >= 200 && result.status < 300),
        status: result.status,
        headers: result.headers,
        body: typeof result.body === 'string' ? result.body.slice(0, 50000) : JSON.stringify(result.body).slice(0, 50000),
      })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
}

export const nativeTools = [
  dialogOpenTool, dialogSaveTool, dialogMessageTool, dialogAskTool,
  clipboardReadTool, clipboardWriteTool,
  openUrlTool, notifyTool, nativeFetchTool,
]

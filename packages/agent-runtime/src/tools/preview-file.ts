/**
 * preview_file — 文件预览推送工具（2026-09-14 文件触达「最后一米」）
 *
 * Agent 生成 docx/xlsx/pdf/pptx/图片等文档后，此前只能告知路径，用户需自行在
 * 左栏目录树中找到文件点击预览。本工具把这一步交给 Agent：校验文件存在后，
 * 通过 CustomEvent 推送到前端，由聊天界面 SessionSidebar 接收并走既有
 * 「打开右栏预览面板」三步通路（setPendingFile → openRightPanel('preview')
 * → ws-open-file-preview 事件，与左栏目录树点击文件完全同链）。
 *
 * 跨层模式与 orchestrator-tools / plugin-backend-tools 一致：agent-runtime
 * （packages 层）不 import apps/tauri 的 store，用 window 事件解耦。
 *
 * 边界：
 * - 仅 Tauri 桌面端可用（cmd_fs_stat / 预览面板 IO 均依赖 Tauri 命令）；
 *   Web 模式明确报错而非静默失败。
 * - cmd_fs_stat 对不存在的路径直接 Err（fs_commands.rs 无 exists 字段），
 *   catch 即「文件不存在或无法访问」。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import { isTauri } from '../execution'

/** Tauri invoke 缓存（同 fs-tools 模式） */
let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null
async function getTauriInvoke() {
  if (_invoke) return _invoke
  if (!isTauri()) return null
  try {
    const api = await import('@tauri-apps/api/core')
    _invoke = api.invoke
    return _invoke
  } catch {
    return null
  }
}

/** 路径基名（兼容 / 与 \，同 SessionSidebar.baseNameOf） */
function baseNameOf(p: string): string {
  const segs = p.split(/[\\/]/).filter(Boolean)
  return segs[segs.length - 1] ?? p
}

export const previewFileTool: ToolDefinition = {
  name: 'preview_file',
  description: '将本地磁盘上的文件推送到界面右侧的文件预览面板打开预览（支持图片 png/jpg/gif/webp/svg/bmp 与文档 docx/xlsx/pdf/pptx/ppt 等）。当用户要求「打开/查看/预览」某个文件，尤其是你刚生成的文档时，调用此工具而非只告知路径。仅桌面端可用。',
  parameters: {
    path: { type: 'string', description: '文件的绝对路径', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '预览文件',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const path = String(args.path || '').trim()
    if (!path) return JSON.stringify({ ok: false, error: '缺少 path 参数（文件绝对路径）' })

    const invoke = await getTauriInvoke()
    if (!invoke) {
      return JSON.stringify({ ok: false, error: '文件预览推送仅桌面端（Tauri）支持，Web 模式不可用' })
    }

    // 校验存在性 + 取元数据（cmd_fs_stat 对不存在路径直接 Err，catch 即不存在）
    let stat: { isDir?: boolean; size?: number; modified?: string | null }
    try {
      stat = await invoke('cmd_fs_stat', { path }) as typeof stat
    } catch (err) {
      return JSON.stringify({ ok: false, error: `文件不存在或无法访问: ${path}`, detail: String(err) })
    }
    if (stat.isDir) {
      return JSON.stringify({ ok: false, error: `路径是目录而非文件，无法预览: ${path}` })
    }

    // 构造 FsNode 形状推送（apps/tauri 侧 SessionSidebar 监听后走既有预览通路）
    const node = {
      name: baseNameOf(path),
      path,
      isDir: false,
      size: stat.size ?? 0,
      modified: stat.modified ?? null,
    }
    try {
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('worldsea:preview-file', { detail: node }))
      } else {
        return JSON.stringify({ ok: false, error: '当前环境无 window，无法推送预览事件' })
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: `推送预览事件失败: ${err instanceof Error ? err.message : String(err)}` })
    }
    return JSON.stringify({
      ok: true,
      path,
      name: node.name,
      size: node.size,
      note: `已将「${node.name}」推送到右侧文件预览面板。若右栏未自动打开，用户可从左栏目录树手动点击该文件预览。`,
    })
  },
}

export const previewFileTools = [previewFileTool]

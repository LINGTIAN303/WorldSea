/**
 * 思维导图 Agent 能力描述符
 *
 * 模式同 motion-kit/font-kit 的 LibraryDescriptor（toolbus internal 链），
 * 但注册点在 App 侧（main.ts internalRegistry.register）——芽级能力随 App
 * 装配注册，避开 packages 层对 apps/tauri 的反向依赖。
 *
 * 能力面（二期 Agent 桥接 MVP）：
 * - mindmap.list   列出导图文档
 * - mindmap.read   读取导图结构（Markdown 大纲返回，Agent 可读可改）
 * - mindmap.create 从 Markdown 大纲创建导图（Agent 构思 → 成图主通路）
 * - mindmap.append 向指定导图追加 Markdown 分支（追加为根的直接子级）
 *
 * 执行层直接操作 mindmapDoc 持久化（同目录纯函数），写后派发
 * ws-mindmap-docs-changed 事件——MindmapView 挂载时监听，视图开着则
 * 实时刷新列表与当前画布，未开则下次打开时自然加载。
 */
import type { LibraryDescriptor, CapabilityDeclaration, AvailabilitySpec } from '@worldsea/agent-runtime/toolbus/capability-types'
import type { ToolParameter } from '@worldsea/agent-runtime/bridge-types'
import { getProjectManager } from '@worldsea/entity-core/core'
import { loadDocIndex, loadDoc, saveDoc, saveDocIndex, genId, type MindmapDocMeta } from './mindmapDoc'
import { markdownToMindElixir, mindElixirToMarkdown } from './mindmapMarkdown'

const AVAILABILITY: AvailabilitySpec = { platforms: ['web', 'tauri'], chain: ['internal'], requiresUI: true }

/** 通知前端视图：文档数据被外部（Agent）变更 */
function notifyDocsChanged(updatedId?: string) {
  window.dispatchEvent(new CustomEvent('ws-mindmap-docs-changed', { detail: { updatedId } }))
}

function touchDoc(id: string): MindmapDocMeta | null {
  const index = loadDocIndex()
  const meta = index.find(d => d.id === id)
  if (!meta) return null
  meta.updatedAt = Date.now()
  saveDocIndex(index)
  return meta
}

const mindmapDescriptor: LibraryDescriptor = {
  id: '@worldsea/mindmap',
  name: 'Mindmap',
  version: '2.0.0',
  capabilities: [
    {
      id: 'mindmap.list',
      name: 'List Mindmaps',
      description: '列出当前项目的全部思维导图文档（id、名称、更新时间）。',
      category: 'query',
      parameters: {},
      availability: AVAILABILITY,
      execute: async () => {
        const docs = loadDocIndex().map(d => ({ id: d.id, name: d.name, updatedAt: new Date(d.updatedAt).toISOString() }))
        return JSON.stringify({ ok: true, docs })
      },
    },
    {
      id: 'mindmap.read',
      name: 'Read Mindmap',
      description: '读取指定思维导图的结构，以 Markdown 大纲返回（# 为中心主题，- 缩进列表为分支层级），可直接理解或修改后再传给 mindmap.create / mindmap.append。',
      category: 'query',
      parameters: {
        id: { type: 'string', description: '导图文档 id（可先调 mindmap.list 获取）', required: true } satisfies ToolParameter,
      },
      availability: AVAILABILITY,
      execute: async args => {
        const doc = loadDoc(String(args.id))
        if (!doc) return JSON.stringify({ ok: false, error: `导图 ${args.id} 不存在` })
        return JSON.stringify({ ok: true, id: doc.id, name: doc.name, markdown: mindElixirToMarkdown(doc.data) })
      },
    },
    {
      id: 'mindmap.create',
      name: 'Create Mindmap',
      description: '从 Markdown 大纲创建一张新思维导图。格式：首个 # 标题为中心主题，- 缩进列表（2 空格一层）为分支层级。适合把构思、规划、分析结论直接落成导图。',
      category: 'crud',
      parameters: {
        name: { type: 'string', description: '导图名称', required: true } satisfies ToolParameter,
        markdown: { type: 'string', description: 'Markdown 大纲（# 根 + - 缩进列表）', required: true } satisfies ToolParameter,
      },
      availability: AVAILABILITY,
      execute: async args => {
        const data = markdownToMindElixir(String(args.markdown ?? ''))
        if (!data) return JSON.stringify({ ok: false, error: 'Markdown 大纲为空或无法解析' })
        const meta: MindmapDocMeta = {
          id: genId(),
          name: String(args.name ?? '未命名导图').trim() || '未命名导图',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        saveDoc({ ...meta, data })
        const index = loadDocIndex()
        index.push(meta)
        saveDocIndex(index)
        notifyDocsChanged(meta.id)
        return JSON.stringify({ ok: true, id: meta.id, name: meta.name })
      },
    },
    {
      id: 'mindmap.append',
      name: 'Append To Mindmap',
      description: '向指定思维导图追加分支。传入 Markdown 大纲（- 缩进列表，可多级），整体追加为中心主题下的新分支组。',
      category: 'crud',
      parameters: {
        id: { type: 'string', description: '目标导图 id', required: true } satisfies ToolParameter,
        markdown: { type: 'string', description: '要追加的 Markdown 大纲（- 缩进列表）', required: true } satisfies ToolParameter,
      },
      availability: AVAILABILITY,
      execute: async args => {
        const id = String(args.id)
        const doc = loadDoc(id)
        if (!doc) return JSON.stringify({ ok: false, error: `导图 ${id} 不存在` })
        const parsed = markdownToMindElixir(String(args.markdown ?? ''))
        if (!parsed) return JSON.stringify({ ok: false, error: 'Markdown 大纲为空或无法解析' })
        // 追加：解析结果的顶层节点（root 的 children）挂到目标导图的根下；root topic 弃用
        const root = doc.data.nodeData
        root.children = root.children ?? []
        for (const top of parsed.nodeData.children ?? []) {
          root.children.push(top)
        }
        const meta = touchDoc(id)
        if (!meta) return JSON.stringify({ ok: false, error: '更新索引失败' })
        saveDoc({ ...meta, data: doc.data })
        notifyDocsChanged(id)
        return JSON.stringify({ ok: true, id, appended: (parsed.nodeData.children ?? []).length })
      },
    },
    {
      id: 'mindmap.write',
      name: 'Write Mindmap',
      description: '整图写回：用 Markdown 大纲完全替换指定导图的结构（根 topic 取首个 # 标题）。破坏性操作——先 mindmap.read 读取当前结构，修改后写回；写回前自动保留一份备份（mindmap_doc_{id}_backup，可在项目 DB 中找回）。仅用于用户明确要求重组/整理导图时。',
      category: 'crud',
      parameters: {
        id: { type: 'string', description: '目标导图 id', required: true } satisfies ToolParameter,
        markdown: { type: 'string', description: '完整的新 Markdown 大纲（# 根 + - 缩进列表）', required: true } satisfies ToolParameter,
      },
      availability: AVAILABILITY,
      execute: async args => {
        const id = String(args.id)
        const doc = loadDoc(id)
        if (!doc) return JSON.stringify({ ok: false, error: `导图 ${id} 不存在` })
        const parsed = markdownToMindElixir(String(args.markdown ?? ''))
        if (!parsed) return JSON.stringify({ ok: false, error: 'Markdown 大纲为空或无法解析' })
        // 写前备份：旧文档体存独立 KV（不进索引，孤儿备份），误覆盖时可人工找回
        try {
          const db = getProjectManager().getCurrentProjectDb() as { table: (name: string) => { put: (row: { key: string; value: string }) => void } } | null
          db?.table('project_settings').put({ key: `mindmap_doc_${id}_backup_${Date.now().toString(36)}`, value: JSON.stringify(doc) })
        } catch {
          /* 项目系统未初始化时跳过备份（仅 localStorage 场景，旧数据仍在 localStorage） */
        }
        // 保留文档名与元信息，仅替换树数据与图级元数据
        const meta = touchDoc(id)
        if (!meta) return JSON.stringify({ ok: false, error: '更新索引失败' })
        const nextData = { ...doc.data, nodeData: parsed.nodeData }
        saveDoc({ ...meta, data: nextData })
        notifyDocsChanged(id)
        const count = (function count(n: { children?: unknown[] }): number {
          return 1 + (n.children ?? []).reduce((s: number, c) => s + count(c as { children?: unknown[] }), 0)
        })(parsed.nodeData)
        return JSON.stringify({ ok: true, id, nodes: count })
      },
    },
  ] satisfies CapabilityDeclaration[],
}

export { mindmapDescriptor }

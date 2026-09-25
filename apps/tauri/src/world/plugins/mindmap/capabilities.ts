/**
 * 思维导图的**代理能力面**（C，2026-09-25）：经 A 批的**能力桥**暴露为 `world.mindmap.*`。
 *
 * 与旧 `agent-descriptor.ts`（登记进旧内部注册表、走 toolbus）的区别：
 * - 声明面 = `registerWorldCapabilities`（壳持注册表 + ACL + 审计；provider = 工作台窗）；
 * - 返回值 = **结构化对象**（旧版回 JSON 字符串——桥直传 JSON 更省一层解析）；
 * - 生命周期 = 随插件装载登记、随插件清理撤登记（`unregisterWorldCapabilities`）。
 *
 * 写入类 handler 落 `mindmapDoc` 纯函数后派发 `ws-mindmap-docs-changed`：
 * 视图开着则即时刷新（列表 + 当前画布），未开则下次打开自然加载。
 */
import { getProjectManager } from '@worldsea/entity-core/core'

import type { WorldCapability } from '@/shell/capabilities'
import {
  genId,
  loadDoc,
  loadDocIndex,
  saveDoc,
  saveDocIndex,
  type MindmapDocMeta,
} from './mindmapDoc'
import { markdownToMindElixir, mindElixirToMarkdown } from './mindmapMarkdown'

/** 通知前端视图：文档数据被外部（代理面）变更。 */
function notifyDocsChanged(updatedId?: string): void {
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

/** 节点计数（write 回执用）。 */
function countNodes(node: { children?: unknown[] }): number {
  return 1 + (node.children ?? []).reduce((sum: number, child) => sum + countNodes(child as { children?: unknown[] }), 0)
}

/** 5 条能力（acl 均为 `['main']` = Agent 面窗口）。 */
export const WORLD_MINDMAP_CAPABILITIES: WorldCapability[] = [
  {
    id: 'world.mindmap.list',
    summary: '列出当前项目的全部思维导图文档（id、名称、更新时间）',
    acl: ['main'],
    handler: () => ({
      ok: true,
      docs: loadDocIndex().map(doc => ({
        id: doc.id,
        name: doc.name,
        updatedAt: new Date(doc.updatedAt).toISOString(),
      })),
    }),
  },
  {
    id: 'world.mindmap.read',
    summary: '读取指定导图的结构，以 Markdown 大纲返回（# 中心主题，- 缩进为分支层级），可直接改动后交给 create/append',
    params: [{ name: 'id', description: '导图文档 id（可先调 world.mindmap.list）', required: true }],
    acl: ['main'],
    handler: args => {
      const doc = loadDoc(String(args.id))
      if (!doc) return { ok: false, error: `导图 ${String(args.id)} 不存在` }
      return { ok: true, id: doc.id, name: doc.name, markdown: mindElixirToMarkdown(doc.data) }
    },
  },
  {
    id: 'world.mindmap.create',
    summary: '从 Markdown 大纲创建新导图（首个 # 标题为中心主题，2 空格一层缩进为分支）',
    params: [
      { name: 'name', description: '导图名称', required: true },
      { name: 'markdown', description: 'Markdown 大纲（# 根 + - 缩进列表）', required: true },
    ],
    acl: ['main'],
    handler: args => {
      const data = markdownToMindElixir(String(args.markdown ?? ''))
      if (!data) return { ok: false, error: 'Markdown 大纲为空或无法解析' }
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
      return { ok: true, id: meta.id, name: meta.name }
    },
  },
  {
    id: 'world.mindmap.append',
    summary: '向指定导图追加分支：Markdown 大纲（- 缩进列表）整体挂到中心主题下',
    params: [
      { name: 'id', description: '目标导图 id', required: true },
      { name: 'markdown', description: '要追加的 Markdown 大纲（- 缩进列表）', required: true },
    ],
    acl: ['main'],
    handler: args => {
      const id = String(args.id)
      const doc = loadDoc(id)
      if (!doc) return { ok: false, error: `导图 ${id} 不存在` }
      const parsed = markdownToMindElixir(String(args.markdown ?? ''))
      if (!parsed) return { ok: false, error: 'Markdown 大纲为空或无法解析' }
      const root = doc.data.nodeData
      root.children = root.children ?? []
      for (const top of parsed.nodeData.children ?? []) root.children.push(top)
      const meta = touchDoc(id)
      if (!meta) return { ok: false, error: '更新索引失败' }
      saveDoc({ ...meta, data: doc.data })
      notifyDocsChanged(id)
      return { ok: true, id, appended: (parsed.nodeData.children ?? []).length }
    },
  },
  {
    id: 'world.mindmap.write',
    summary:
      '整图写回：用 Markdown 大纲完全替换指定导图结构（破坏性——写前自动备份到项目 KV `mindmap_doc_{id}_backup_*`；会重建全部节点 id，自由关系线与概要括号不保留）。仅用于明确要求重组/整理时',
    params: [
      { name: 'id', description: '目标导图 id', required: true },
      { name: 'markdown', description: '完整的新 Markdown 大纲（# 根 + - 缩进列表）', required: true },
    ],
    acl: ['main'],
    handler: args => {
      const id = String(args.id)
      const doc = loadDoc(id)
      if (!doc) return { ok: false, error: `导图 ${id} 不存在` }
      const parsed = markdownToMindElixir(String(args.markdown ?? ''))
      if (!parsed) return { ok: false, error: 'Markdown 大纲为空或无法解析' }
      // 写前备份：旧文档体存独立 KV（不进索引，孤儿备份），误覆盖时可人工找回
      try {
        const db = getProjectManager().getCurrentProjectDb() as {
          table: (name: string) => { put: (row: { key: string; value: string }) => void }
        } | null
        db
          ?.table('project_settings')
          .put({ key: `mindmap_doc_${id}_backup_${Date.now().toString(36)}`, value: JSON.stringify(doc) })
      } catch {
        /* 项目系统未初始化时跳过备份（仅 localStorage 场景，旧数据仍在 localStorage） */
      }
      const meta = touchDoc(id)
      if (!meta) return { ok: false, error: '更新索引失败' }
      const nextData = { ...doc.data, nodeData: parsed.nodeData, arrows: [], summaries: [] }
      saveDoc({ ...meta, data: nextData })
      notifyDocsChanged(id)
      return { ok: true, id, nodes: countNodes(parsed.nodeData) }
    },
  },
]

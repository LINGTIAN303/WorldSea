/**
 * agentDataBridges —— Agent→芽 数据动作的 app 级全局桥（2026-09-14 架构拍板）
 *
 * 【根因】数据动作 handler 原挂在视图组件（useAgentPluginBridge 在 onMounted 注册），
 * 视图未挂载时事件无人消费——工具返回 dispatched:true 但实际假成功。
 *
 * 【本模块】数据动作与 UI 解耦：App 启动即注册（installAgentDataBridges，幂等），
 * 数据动作直接操作 pinia store（与视图挂载无关，必达）；UI 动作（导航/打开对话框）
 * 仍由视图内 useAgentPluginBridge 消费。每个 (pluginId, action) 只在一处消费——
 * 数据动作已从视图 handler 中删除，无双写。
 *
 * 【query 返回通路】agent-runtime 发 query 带 requestId → 本桥同步读 store →
 * dispatch worldsea:agent:plugin-query-result 回传（发送侧 3s 超时报错）。
 * window.__worldsea_* 变通回传就此废弃。
 *
 * 【错误桶】数据 handler 抛错时记入 window.__worldsea_agent_bridge_errors__
 * （拍板档 1：写动作 fire-and-forget 保持，store 层异常不阻塞 Agent 但留排查痕迹）。
 *
 * 首批迁移 = 写作三芽（notebook 8 动作 / manuscript 5 数据动作 / outline 6 数据动作）；
 * 其余芽（timeline/graph/mindmap/tactical-board/magic 等）同模式挂账分批迁。
 */

import { useEntityStore, useRelationStore, useBidirectional, relationshipRegistry } from '@worldsea/entity-core'
// 「节点 ↔ 芽实体」关联的唯一写入入口（关系表写入，幂等；2026-09-18 新增三条关系类型）
import { linkOutlineEntity, resolveRefRelation, unlinkOutlineEntity } from '@/entity/outlineLinks'
import { useCodeSandbox } from '@/sprouts/official/notebook/composables/useCodeSandbox'
import { useOutlineTree } from '@/sprouts/official/outline/composables/useOutlineTree'

interface AgentEventDetail {
  pluginId: string
  action?: string
  query?: string
  params?: Record<string, unknown>
  payload?: Record<string, unknown>
  requestId?: string
  timestamp: number
}

type DataHandler = (payload: Record<string, unknown>) => Promise<void> | void
type QueryHandler = (params: Record<string, unknown>) => unknown

let installed = false

export function installAgentDataBridges(): void {
  if (installed) return
  installed = true

  // store/composable 实例化必须在 install 内（pinia 激活后），不可模块顶层
  const es = useEntityStore()
  const rs = useRelationStore()
  const { createBidirectional } = useBidirectional()
  const codeSandbox = useCodeSandbox()
  const { flatNodes, deleteNode: deleteOutlineNode, moveNode: moveOutlineNode, syncParentChildRelation } = useOutlineTree()

  const errorBucket: Array<Record<string, unknown>> = []
  ;(window as unknown as Record<string, unknown>).__worldsea_agent_bridge_errors__ = errorBucket

  function recordError(pluginId: string, action: string, err: unknown): void {
    errorBucket.push({ pluginId, action, error: String(err), at: new Date().toISOString() })
    console.warn(`[agentDataBridges] ${pluginId}:${action} 执行失败`, err)
  }

  // ── 通用小工具 ──
  function stripTags(html: string): string {
    return (html || '').replace(/<[^>]*>/g, '')
  }

  function downloadText(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function safeName(name: string): string {
    return name.replace(/[/\\?%*:|"<>]/g, '_')
  }

  // ══════════════ notebook（8 数据动作，自 NotebookView 上移）══════════════

  const dataHandlers: Record<string, DataHandler> = {
    // folderId 语义（拍板）：payload 显式指定，不传 = 未分类（不再兜底第一个文件夹）
    'notebook:create_note': async (payload) => {
      const id = crypto.randomUUID()
      await es.add({
        id,
        type: 'notebook',
        name: (payload.name as string) || (payload.content as string)?.slice(0, 30) || 'AI 创建的笔记',
        description: '',
        properties: {
          content: (payload.content as string) || '',
          noteType: (payload.noteType as string) || 'markdown',
          tags: (payload.tags as string[]) || [],
          linkedEntities: [],
          codeLanguage: '',
          codeOutput: '',
          sortOrder: Date.now().toString(),
          folderId: (payload.folderId as string) || '',
        },
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, 'user')
    },

    'notebook:update_note': async (payload) => {
      const noteId = payload.noteId as string
      if (!noteId) return
      const note = (es.entities ?? []).find(e => e.id === noteId)
      if (!note) return
      const changes: Record<string, unknown> = { updatedAt: new Date().toISOString() }
      if (payload.content !== undefined) {
        changes.properties = { ...note.properties, content: payload.content }
      }
      if (payload.tags !== undefined) {
        const props = (changes.properties as Record<string, unknown>) || { ...note.properties }
        props.tags = payload.tags
        changes.properties = props
      }
      await es.update(noteId, changes)
    },

    'notebook:delete_note': async (payload) => {
      const noteId = payload.noteId as string
      if (noteId) await es.remove(noteId)
    },

    'notebook:execute_code': async (payload) => {
      const noteId = payload.noteId as string
      const code = payload.code as string
      if (!noteId || !code) return
      const note = (es.entities ?? []).find(e => e.id === noteId)
      if (!note) return
      let output: string
      try {
        output = await codeSandbox.execute(code, 'javascript')
      } catch (err: unknown) {
        output = 'ERROR: ' + (err instanceof Error ? err.message : String(err))
      }
      await es.update(noteId, { properties: { ...note.properties, codeOutput: output } })
    },

    'notebook:create_backlink': async (payload) => {
      const { sourceId, targetId } = payload as { sourceId?: string; targetId?: string }
      if (!sourceId || !targetId) return
      const exists = rs.relations.some(
        (r) => r.type === 'note_link' && r.sourceId === sourceId && r.targetId === targetId
      )
      if (!exists) await createBidirectional({ type: 'note_link', sourceId, targetId })
    },

    'notebook:export_note': async (payload) => {
      const noteId = payload.noteId as string
      const format = (payload.format as string) || 'markdown'
      const note = (es.entities ?? []).find(e => e.id === noteId)
      if (!note) return
      const content = (note.properties?.content as string) || ''
      const filename = `${safeName(note.name)}.${format === 'html' ? 'html' : 'md'}`
      const mimeType = format === 'html' ? 'text/html' : 'text/markdown'
      downloadText(content, filename, mimeType)
    },

    // ══════════════ manuscript（5 数据动作；export_document 是 UI 动作留视图）══════════════

    // bookId 语义（拍板）：payload 显式指定（agent-runtime 工具参数表已加字段），不传 = 未归书
    'manuscript:create_chapter': async (payload) => {
      const title = (payload.title as string) || '未命名章节'
      const content = (payload.content as string) || ''
      const statusMap: Record<string, string> = { draft: '草稿', writing: '草稿', review: '修订中', done: '终稿' }
      const bookId = (payload.bookId as string) || ''
      const now = new Date().toISOString()
      const id = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      // sortOrder = 该书（或未归书）现有章节数——store 计数，不依赖视图状态
      const sortOrder = (es.entities ?? []).filter(
        e => e.type === 'manuscript' && ((e.properties.bookId as string) || '') === bookId
      ).length
      await es.add({
        id,
        type: 'manuscript',
        name: title,
        description: '',
        properties: {
          content,
          outlineNodeId: '',
          wordCount: stripTags(content).length,
          status: statusMap[(payload.status as string) || 'draft'] || '草稿',
          sortOrder,
          volumeName: (payload.volumeName as string) || '',
          bookId,
          entityMentions: '',
          snapshots: '[]',
        },
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
    },

    'manuscript:update_chapter': async (payload) => {
      const ch = (es.entities ?? []).find(e => e.id === (payload.chapterId as string) && e.type === 'manuscript')
      if (!ch) return
      const properties = { ...ch.properties }
      if (payload.content !== undefined) {
        properties.content = payload.content as string
        properties.wordCount = stripTags(payload.content as string).length
      }
      if (payload.status) {
        const statusMap: Record<string, string> = { draft: '草稿', writing: '草稿', review: '修订中', done: '终稿' }
        properties.status = statusMap[payload.status as string] || properties.status
      }
      if (payload.volumeName !== undefined) properties.volumeName = payload.volumeName as string
      await es.update(ch.id, { properties })
    },

    'manuscript:reorder_chapters': async (payload) => {
      const ids = payload.chapterIds as string[]
      if (!Array.isArray(ids)) return
      for (let i = 0; i < ids.length; i++) {
        const ch = (es.entities ?? []).find(e => e.id === ids[i] && e.type === 'manuscript')
        if (ch && (ch.properties.sortOrder as number) !== i) {
          await es.update(ch.id, { properties: { ...ch.properties, sortOrder: i } })
        }
      }
    },

    // ══════════════ outline（6 数据动作；navigate 是 UI 动作留视图）══════════════

    // 带真实 title 建节点（不弹确认打断 Agent）；父 id 无效容错回落根节点；
    // type（act/sequence/scene/beat）原值存 properties.nodeType
    'outline:create_node': async (payload) => {
      const title = String(payload.title || '').trim() || '未命名节点'
      const rawParentId = (payload.parentId as string) || null
      const parent = rawParentId && rawParentId !== 'root'
        ? flatNodes.value.find(e => e.id === rawParentId)
        : undefined
      const effectiveParentId = parent?.id || ''
      const siblings = flatNodes.value.filter(e => (e.properties.parentId as string || '') === effectiveParentId)
      const now = new Date().toISOString()
      const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      await es.add({
        id, type: 'outline_node', name: title,
        // 摘要走实体顶层 description（口径同 update_node，见下方注释）
        description: String(payload.summary || ''),
        properties: {
          status: '未写', order: siblings.length + 1,
          parentId: effectiveParentId, storylines: '', summary: '',
          manuscriptId: '',
          ...(payload.type ? { nodeType: payload.type as string } : {}),
        },
        tags: [], createdAt: now, updatedAt: now,
      })
      if (parent) await syncParentChildRelation(id, parent.id)
    },

    'outline:update_node': async (payload) => {
      const nodeId = payload.nodeId as string
      const changes = (payload.changes as Record<string, unknown>) || undefined
      if (!nodeId || !changes) return
      const node = flatNodes.value.find(e => e.id === nodeId)
      if (!node) return
      const { title, description, summary, type, ...rest } = changes as {
        title?: string
        description?: string
        summary?: string
        type?: string
      }
      // 摘要口径统一到**实体顶层** description（表现形式规格 §2.1-①「映射 node.description，
      // 不新增 summary」）：白板句子式与导出都只认顶层 description，故 Agent 传 summary 或
      // description 都归一写顶层。`type` 与 create 路径对齐写 properties.nodeType
      // （`contentType` 是旧 UI 表单字段，不在此写）。
      const nextDescription = description ?? summary
      const propsPatch: Record<string, unknown> = { ...rest }
      if (type !== undefined) propsPatch.nodeType = type
      await es.update(nodeId, {
        ...(title !== undefined ? { name: title } : {}),
        ...(nextDescription !== undefined ? { description: nextDescription } : {}),
        // 【必须合并】实体更新对 properties 是**整体替换**（updateById 只做顶层浅合并）。
        // 原实现只提交 `rest`，会把 parentId/order/content 一并抹掉 —— Agent 改一次状态，
        // 节点就脱树、正文字段清零（2026-09-17 质量体检发现，见施工分解 §十四）。
        properties: { ...node.properties, ...propsPatch },
      })
    },

    // 递归删除子树（useOutlineTree.deleteNode）
    'outline:delete_node': async (payload) => {
      const nodeId = payload.nodeId as string
      if (nodeId) await deleteOutlineNode(nodeId)
    },

    'outline:move_node': async (payload) => {
      const nodeId = payload.nodeId as string
      const newParentId = (payload.newParentId as string) || ''
      if (!nodeId) return
      // position = 新父中索引（0 基）；缺失时兜底追加到新父末尾
      const raw = Number(payload.position)
      const fallbackOrder = flatNodes.value.filter(e => (e.properties.parentId as string || '') === newParentId).length + 1
      const newOrder = payload.position !== undefined && Number.isFinite(raw) ? raw + 1 : fallbackOrder
      await moveOutlineNode(nodeId, newParentId, newOrder)
    },

    // { title, type?, children?: [...] } 树递归建
    'outline:batch_create': async (payload) => {
      const structure = payload.structure as { title?: unknown; summary?: unknown; type?: unknown; children?: unknown } | undefined
      if (!structure) return
      const createTree = async (node: typeof structure, parentId: string | null): Promise<void> => {
        const title = String(node?.title || '').trim()
        if (!title) return
        const parent = parentId ? flatNodes.value.find(e => e.id === parentId) : undefined
        const effectiveParentId = parent?.id || ''
        const siblings = flatNodes.value.filter(e => (e.properties.parentId as string || '') === effectiveParentId)
        const now = new Date().toISOString()
        const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        await es.add({
          id, type: 'outline_node', name: title,
          description: String(node.summary || ''),
          properties: {
            status: '未写', order: siblings.length + 1,
            parentId: effectiveParentId, storylines: '',
            manuscriptId: '',
            ...(node.type ? { nodeType: String(node.type) } : {}),
          },
          tags: [], createdAt: now, updatedAt: now,
        })
        if (parent) await syncParentChildRelation(id, parent.id)
        const children = node.children
        if (Array.isArray(children)) {
          for (const child of children) {
            await createTree(child as typeof structure, id)
          }
        }
      }
      await createTree(structure, null)
    },

    'outline:export_outline': async (payload) => {
      const format = String(payload.format || 'text')
      const nodes = flatNodes.value
      interface OutlineNodeDTO { name: string; summary: string; children: OutlineNodeDTO[] }
      const buildTree = (parentId: string): OutlineNodeDTO[] => {
        const buildChildren = (pid: string): OutlineNodeDTO[] =>
          nodes
            .filter(e => (e.properties.parentId as string || '') === pid)
            .sort((a, b) => Number(a.properties.order || 0) - Number(b.properties.order || 0))
            .map(e => ({
              name: e.name,
              // 摘要口径 = 实体顶层 description（表现形式规格 §2.1-①「复用 description，不新增 summary」）；
              // 原实现只读 properties.summary（无写入方）→ 导出摘要恒为空。summary 作为历史字段做回落兼容。
              summary: e.description || (e.properties.summary as string) || '',
              children: buildChildren(e.id),
            }))
        return buildChildren(parentId)
      }
      let content = ''
      let mime = 'text/plain'
      let ext = 'txt'
      if (format === 'json') {
        content = JSON.stringify(buildTree(''), null, 2)
        mime = 'application/json'
        ext = 'json'
      } else {
        const lines: string[] = []
        if (format === 'markdown') lines.push('# 大纲', '')
        const walk = (items: ReturnType<typeof buildTree>, depth: number) => {
          for (const n of items) {
            lines.push(`${'  '.repeat(depth)}- ${n.name}${n.summary ? `：${n.summary}` : ''}`)
            walk(n.children, depth + 1)
          }
        }
        walk(buildTree(''), 0)
        content = lines.join('\n')
        if (format === 'markdown') { mime = 'text/markdown'; ext = 'md' }
      }
      downloadText(content, `大纲.${ext}`, mime)
    },
  }

  // ── 查询路由（同步读 store；requestId 回传）──
  const queryHandlers: Record<string, QueryHandler> = {
    'notebook:list_notes': (params) => {
      let results = (es.entities ?? []).filter(e => e.type === 'notebook')
      const folderId = params.folderId as string | undefined
      const keyword = params.keyword as string | undefined
      if (folderId) results = results.filter(n => (n.properties?.folderId as string) === folderId)
      if (keyword) {
        const q = keyword.toLowerCase()
        results = results.filter(n =>
          n.name.toLowerCase().includes(q) ||
          ((n.properties?.content as string) || '').toLowerCase().includes(q)
        )
      }
      return results.map(n => ({ id: n.id, name: n.name, type: n.properties?.noteType }))
    },

    'notebook:search_notes': (params) => {
      const q = ((params.keyword as string) || '').toLowerCase()
      return (es.entities ?? [])
        .filter(e => e.type === 'notebook')
        .filter(n =>
          n.name.toLowerCase().includes(q) ||
          (n.description || '').toLowerCase().includes(q) ||
          ((n.properties?.content as string) || '').toLowerCase().includes(q)
        )
        .map(n => ({ id: n.id, name: n.name, preview: (n.properties?.content as string || '').slice(0, 100) }))
    },

    'manuscript:list_chapters': () =>
      (es.entities ?? [])
        .filter(e => e.type === 'manuscript')
        .map(m => ({
          id: m.id,
          name: m.name,
          status: (m.properties.status as string) || '草稿',
          wordCount: m.properties.wordCount || 0,
          bookId: m.properties.bookId || '',
          volumeName: m.properties.volumeName || '',
        })),

    'manuscript:get_chapter_content': (params) => {
      const ch = (es.entities ?? []).find(e => e.id === (params.chapterId as string) && e.type === 'manuscript')
      return ch
        ? { chapterId: ch.id, name: ch.name, content: ch.properties.content || '', found: true }
        : { chapterId: params.chapterId, found: false }
    },

    'outline:get_structure': () => {
      const nodes = (es.entities ?? []).filter(e => e.type === 'outline_node')
      const build = (parentId: string): unknown[] =>
        nodes
          .filter(e => (e.properties.parentId as string || '') === parentId)
          .sort((a, b) => Number(a.properties.order || 0) - Number(b.properties.order || 0))
          .map(e => ({
            id: e.id,
            title: e.name,
            // 2026-09-18（Q6-①）：只读 `nodeType`。此前的 `|| e.properties.contentType` 兜底
            // 是给旧 UI 表单（写 contentType，取值 章节/场景/片段/备注）用的 ——
            // 该表单随 OutlineView 于 09-17 删除，兜底已无来源；且两套取值语义并不同
            // （备注 ≠ beat），留着只会让「节点类型」出现两种口径。现已注册进 ownFields。
            type: e.properties.nodeType || '',
            status: e.properties.status || '未写',
            children: build(e.id),
          }))
      return build('')
    },

    /**
     * 实体关联（2026-09-18 新增）：把大纲节点关联到角色/地点/事件等芽实体。
     *
     * 与 chapterLink 的分工：**章节关联走双字段**（`manuscriptId`/`outlineNodeId`），
     * **其它实体关联走关系表**（本 handler）—— 后者没有对应的字段，关系是它的唯一表达。
     *
     * 校验（三条，都为了「宁可明确报错也不要假成功」）：
     * ① `relation` 未知 → 报 `unknown-relation`（**不回退默认值**，否则写错语义却显示成功）
     * ② 目标实体不存在 → `missing-entity`
     * ③ 目标实体类型不在该关系类型的 targetTypes 白名单内 → `target-type-mismatch:<type>`
     *    （例如把「角色」当作 `located_in` 的目标 —— 关系能建但语义是错的）
     */
    'outline:link_entity': async (payload: Record<string, unknown>) => {
      const nodeId = String(payload.nodeId ?? '')
      if (!nodeId) throw new Error('link_entity 需要 nodeId')

      const raw = Array.isArray(payload.entities) ? payload.entities : []
      if (!raw.length) throw new Error('link_entity 需要 entities 数组（[{ entityId, relation? }]）')

      const unlink = payload.unlink === true
      const results: Array<{ entityId: string; relation: string; outcome: string }> = []

      for (const item of raw) {
        const rec = (item ?? {}) as Record<string, unknown>
        const entityId = String(rec.entityId ?? '')
        const relationRaw = rec.relation
        const relation = resolveRefRelation(relationRaw)

        if (!entityId) {
          results.push({ entityId: '', relation: '', outcome: 'missing-entity' })
          continue
        }
        if (!relation) {
          results.push({ entityId, relation: String(relationRaw ?? ''), outcome: 'unknown-relation' })
          continue
        }
        const target = (es.entities ?? []).find(e => e.id === entityId)
        if (!target) {
          results.push({ entityId, relation, outcome: 'missing-entity' })
          continue
        }
        const allowed = relationshipRegistry.get(relation)?.targetTypes ?? []
        if (allowed.length && !allowed.includes(target.type)) {
          results.push({ entityId, relation, outcome: `target-type-mismatch:${target.type}` })
          continue
        }

        const outcome = unlink
          ? ((await unlinkOutlineEntity(rs, nodeId, entityId, relation)) ? 'removed' : 'absent')
          : await linkOutlineEntity(rs, nodeId, entityId, relation)
        results.push({ entityId, relation, outcome })
      }

      return { nodeId, results }
    },
  }

  // ── 全局监听（数据事件消费 + 查询回传）──
  // 数据 handler 串行队列：Agent 连发动作按序应用（sortOrder 等派生值依赖
  // 前一动作完成后的 store 状态；并发会读到旧计数）。
  let dispatchChain: Promise<void> = Promise.resolve()

  window.addEventListener('worldsea:agent:plugin-action', (e: Event) => {
    const detail = (e as CustomEvent).detail as AgentEventDetail | undefined
    if (!detail?.pluginId || !detail.action) return
    const handler = dataHandlers[`${detail.pluginId}:${detail.action}`]
    if (!handler) return // UI 动作或未迁移芽 → 交给视图层（useAgentPluginBridge）
    dispatchChain = dispatchChain
      .then(() => handler(detail.payload ?? {}))
      .catch(err => recordError(detail.pluginId, detail.action!, err))
  })

  window.addEventListener('worldsea:agent:plugin-query', (e: Event) => {
    const detail = (e as CustomEvent).detail as AgentEventDetail | undefined
    if (!detail?.pluginId || !detail.query || !detail.requestId) return
    const handler = queryHandlers[`${detail.pluginId}:${detail.query}`]
    if (!handler) return // 未注册查询 → 发送侧超时报「桥未就绪」
    let result: unknown
    try {
      result = handler(detail.params ?? {})
    } catch (err) {
      result = { error: String(err) }
    }
    window.dispatchEvent(new CustomEvent('worldsea:agent:plugin-query-result', {
      detail: { requestId: detail.requestId, result },
    }))
  })
}

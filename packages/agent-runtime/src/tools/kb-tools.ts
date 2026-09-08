/** 知识库工具集：Agent 操作知识库的工具定义，详细见 docs/details/注释/packages/agent-runtime/tools-kb-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import {
  kbWrite, kbRead, kbReadById, kbList, kbDelete, kbDeleteById,
  kbSearchKeyword, kbLinkEntity, kbUnlinkEntity,
  kbGetStats, kbGetTree, kbEnsureStructure, getEntryByPath,
  type KBScope,
} from '../kb/kb-store'
import { indexKBEntry, removeKBIndex, semanticSearchKB, isEmbeddingReady } from '../kb/kb-indexer'

const KB_PATH_CONVENTION = `
知识库路径约定：
- profile/       → 用户画像（偏好、沟通风格、工作模式）— scope: global
- project/       → 项目知识（概览、决策、约定、术语）— scope: project
- entities/      → 实体深度知识（角色洞察、世界规则、关系模式）— scope: project
- reflections/   → 反思与整合（周度反思、发现的模式）— scope: project
- scratch/       → 临时草稿（可被 Agent 清理）— scope: project
`

const kbWriteTool: ToolDefinition = {
  name: 'kb_write',
  description: '写入或更新知识库文档。Agent 自主管理知识库，无需用户手动操作。支持双层作用域：global（跨项目持久）和 project（项目级持久）。',
  parameters: {
    path: { type: 'string', description: '知识文档路径，如 "profile/preferences.md" 或 "entities/character-insights.md"', required: true },
    content: { type: 'string', description: '文档内容（Markdown 格式）', required: true },
    scope: { type: 'string', description: '作用域: global（跨项目）/ project（项目级），默认 project', required: false, enum: ['global', 'project'] },
    tags: { type: 'string', description: '标签，逗号分隔，用于分类检索', required: false },
    entityId: { type: 'string', description: '关联实体 ID（可选，将知识条目链接到特定实体）', required: false },
    summary: { type: 'string', description: '内容摘要（可选，用于快速预览和检索）', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '写入知识库',
  } satisfies ToolMeta,
  execute: async (args) => {
    const path = String(args.path).trim()
    const content = String(args.content)
    const scope = (String(args.scope || 'project')) as KBScope
    const tags = String(args.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    const entityId = args.entityId ? String(args.entityId) : undefined
    const summary = args.summary ? String(args.summary) : undefined

    if (!path || !content) {
      return JSON.stringify({ error: 'path 和 content 不能为空' })
    }

    if (!path.match(/^[a-zA-Z0-9_\-\u4e00-\u9fff\/]+\.([a-z]+)$/)) {
      return JSON.stringify({ error: `路径格式不正确: ${path}。应为如 "profile/preferences.md" 或 "entities/角色洞察.md" 的格式` })
    }

    const entry = await kbWrite({ path, scope, content, tags, entityId, summary })

    indexKBEntry(entry).catch(() => {})

    return JSON.stringify({
      success: true,
      id: entry.id,
      path: entry.path,
      scope: entry.scope,
      action: entry.createdAt === entry.updatedAt ? 'created' : 'updated',
      size: content.length,
    })
  },
}

const kbReadTool: ToolDefinition = {
  name: 'kb_read',
  description: '读取知识库文档内容。通过路径或 ID 定位。',
  parameters: {
    path: { type: 'string', description: '知识文档路径（与 id 二选一）' },
    id: { type: 'string', description: '知识条目 ID（与 path 二选一）' },
    scope: { type: 'string', description: '作用域（使用 path 时需要指定）: global / project', required: false, enum: ['global', 'project'] },
  },
  meta: {
    permission: 'safe',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '读取知识库',
  } satisfies ToolMeta,
  execute: async (args) => {
    if (args.id) {
      const result = await kbReadById(String(args.id))
      if (!result) return JSON.stringify({ error: `知识条目不存在: ${args.id}` })
      return JSON.stringify({
        id: result.id,
        path: result.path,
        scope: result.scope,
        content: result.content,
        mimeType: result.mimeType,
        tags: result.tags,
        entityId: result.entityId,
        summary: result.summary,
        updatedAt: new Date(result.updatedAt).toISOString(),
        accessCount: result.accessCount,
      })
    }

    const path = String(args.path).trim()
    const scope = (String(args.scope || 'project')) as KBScope
    const result = await kbRead(scope, path)
    if (!result) return JSON.stringify({ error: `知识文档不存在: ${scope}/${path}` })
    return JSON.stringify({
      id: result.id,
      path: result.path,
      scope: result.scope,
      content: result.content,
      mimeType: result.mimeType,
      tags: result.tags,
      entityId: result.entityId,
      summary: result.summary,
      updatedAt: new Date(result.updatedAt).toISOString(),
      accessCount: result.accessCount,
    })
  },
}

const kbListTool: ToolDefinition = {
  name: 'kb_list',
  description: '列出知识库目录。可按作用域和路径前缀筛选，返回文档元数据列表。',
  parameters: {
    scope: { type: 'string', description: '作用域筛选: global / project / 不填则全部', required: false, enum: ['global', 'project'] },
    pathPrefix: { type: 'string', description: '路径前缀筛选，如 "profile/" 或 "entities/"', required: false },
    tree: { type: 'boolean', description: '是否以目录树形式展示', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '列出知识库',
  } satisfies ToolMeta,
  execute: async (args) => {
    const scope = args.scope ? (String(args.scope)) as KBScope : undefined
    const pathPrefix = args.pathPrefix ? String(args.pathPrefix) : undefined

    if (args.tree) {
      const tree = await kbGetTree(scope)
      const lines: string[] = ['知识库目录结构：']
      const dirs = Object.keys(tree).sort()
      for (const dir of dirs) {
        const prefix = dir || '(root)'
        lines.push(`\n📁 ${prefix}/`)
        for (const e of tree[dir]) {
          if (e.path.endsWith('/.dir')) continue
          const name = e.path.split('/').pop() || e.path
          const tagStr = e.tags.length > 0 ? ` [${e.tags.join(',')}]` : ''
          const entityStr = e.entityId ? ` → entity:${e.entityId.slice(0, 8)}` : ''
          lines.push(`  📄 ${name}${tagStr}${entityStr}`)
        }
      }
      return lines.join('\n')
    }

    const entries = await kbList(scope, pathPrefix)
    if (entries.length === 0) {
      return JSON.stringify({ message: '知识库为空', hint: '使用 kb_write 写入第一条知识' })
    }
    return JSON.stringify({
      total: entries.length,
      entries: entries.map(e => ({
        id: e.id,
        path: e.path,
        scope: e.scope,
        tags: e.tags,
        entityId: e.entityId,
        summary: e.summary,
        updatedAt: new Date(e.updatedAt).toISOString(),
        accessCount: e.accessCount,
      })),
    })
  },
}

const kbSearchTool: ToolDefinition = {
  name: 'kb_search',
  description: '搜索知识库。支持关键词搜索和语义搜索（需要 Embedding API）。混合模式合并两路结果。',
  parameters: {
    query: { type: 'string', description: '搜索关键词或语义描述', required: true },
    scope: { type: 'string', description: '作用域筛选: global / project / 不填则全部', required: false, enum: ['global', 'project'] },
    mode: { type: 'string', description: '搜索模式: hybrid(混合)/keyword(关键词)/semantic(语义)，默认 hybrid', required: false, enum: ['hybrid', 'keyword', 'semantic'] },
    limit: { type: 'number', description: '返回数量上限，默认10', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '搜索知识库',
  } satisfies ToolMeta,
  execute: async (args) => {
    const query = String(args.query).trim()
    const scope = args.scope ? (String(args.scope)) as KBScope : undefined
    const mode = String(args.mode || 'hybrid')
    const limit = Number(args.limit) || 10

    if (!query) return JSON.stringify({ error: '搜索关键词不能为空' })

    const kwResults = await kbSearchKeyword(query, scope, limit * 2)
    const kwMap = new Map<string, { id: string; path: string; scope: string; score: number; tags: string[]; summary?: string; entityId?: string }>()

    for (const e of kwResults) {
      kwMap.set(e.id, {
        id: e.id, path: e.path, scope: e.scope,
        score: 0, tags: e.tags, summary: e.summary, entityId: e.entityId,
      })
      const existing = kwMap.get(e.id)!
      let score = 0
      const q = query.toLowerCase()
      if (e.path.toLowerCase().includes(q)) score += 3
      if (e.summary && e.summary.toLowerCase().includes(q)) score += 2
      for (const tag of e.tags) {
        if (tag.toLowerCase() === q) score += 4
        else if (tag.toLowerCase().includes(q)) score += 1
      }
      score += e.accessCount * 0.05
      existing.score = score
    }

    if ((mode === 'hybrid' || mode === 'semantic') && isEmbeddingReady()) {
      try {
        const semResults = await semanticSearchKB(query, limit * 2, 0.25, scope)
        for (const sem of semResults) {
          const entryId = sem.metadata?.entryId || sem.id.replace(/^kb_/, '')
          const existing = kwMap.get(entryId)
          if (existing) {
            existing.score = Math.max(existing.score, sem.score * 5)
          } else {
            kwMap.set(entryId, {
              id: entryId,
              path: sem.metadata?.path || '',
              scope: sem.metadata?.scope || 'project',
              score: sem.score * 5,
              tags: sem.metadata?.tags || [],
              summary: sem.metadata?.summary,
              entityId: sem.metadata?.entityId,
            })
          }
        }
      } catch {}
    }

    const allResults = [...kwMap.values()]
    allResults.sort((a, b) => b.score - a.score)
    const results = allResults.slice(0, limit)

    if (results.length === 0) {
      return JSON.stringify({ message: `未找到与 "${query}" 相关的知识`, mode })
    }

    return JSON.stringify({
      results,
      count: results.length,
      mode,
    })
  },
}

const kbDeleteTool: ToolDefinition = {
  name: 'kb_delete',
  description: '删除知识库文档。通过路径或 ID 定位。',
  parameters: {
    path: { type: 'string', description: '知识文档路径（与 id 二选一）' },
    id: { type: 'string', description: '知识条目 ID（与 path 二选一）' },
    scope: { type: 'string', description: '作用域（使用 path 时需要指定）: global / project', required: false, enum: ['global', 'project'] },
  },
  meta: {
    permission: 'dangerous',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '删除知识库',
  } satisfies ToolMeta,
  execute: async (args) => {
    if (args.id) {
      const id = String(args.id)
      const deleted = await kbDeleteById(id)
      if (!deleted) return JSON.stringify({ error: `知识条目不存在: ${id}` })
      removeKBIndex(id).catch(() => {})
      return JSON.stringify({ success: true, deleted: id })
    }

    const path = String(args.path).trim()
    const scope = (String(args.scope || 'project')) as KBScope
    const entry = await getEntryByPath(scope, path)
    if (!entry) return JSON.stringify({ error: `知识文档不存在: ${scope}/${path}` })
    const deleted = await kbDelete(scope, path)
    if (!deleted) return JSON.stringify({ error: `知识文档删除失败: ${scope}/${path}` })
    removeKBIndex(entry.id).catch(() => {})
    return JSON.stringify({ success: true, deleted: `${scope}/${path}` })
  },
}

const kbExtractTool: ToolDefinition = {
  name: 'kb_extract',
  description: '从对话内容中提取值得持久化的知识，自动写入知识库。Agent 应在识别到重要信息时主动调用此工具，无需用户指示。',
  parameters: {
    category: { type: 'string', description: '知识类别: preference(用户偏好)/decision(重要决策)/convention(约定惯例)/insight(洞察发现)/rule(世界规则)/pattern(模式规律)', required: true, enum: ['preference', 'decision', 'convention', 'insight', 'rule', 'pattern'] },
    title: { type: 'string', description: '知识标题，简洁描述', required: true },
    content: { type: 'string', description: '知识内容（Markdown 格式，详细描述）', required: true },
    scope: { type: 'string', description: '作用域: global(跨项目)/project(项目级)，默认 project', required: false, enum: ['global', 'project'] },
    entityId: { type: 'string', description: '关联实体 ID（如果知识涉及特定实体）', required: false },
    tags: { type: 'string', description: '标签，逗号分隔', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '提取知识',
  } satisfies ToolMeta,
  execute: async (args) => {
    const category = String(args.category)
    const title = String(args.title).trim()
    const content = String(args.content)
    const scope = (String(args.scope || 'project')) as KBScope
    const entityId = args.entityId ? String(args.entityId) : undefined
    const tags = [category, ...String(args.tags || '').split(',').map(t => t.trim()).filter(Boolean)]

    if (!title || !content) {
      return JSON.stringify({ error: 'title 和 content 不能为空' })
    }

    const categoryDirMap: Record<string, string> = {
      preference: 'profile',
      decision: 'project',
      convention: 'project',
      insight: 'entities',
      rule: 'entities',
      pattern: 'reflections',
    }

    const dir = categoryDirMap[category] || 'project'
    const safeName = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const path = `${dir}/${safeName}.md`

    const summary = content.length > 200 ? content.slice(0, 200) + '...' : content

    const entry = await kbWrite({ path, scope, content, tags, entityId, summary })
    indexKBEntry(entry).catch(() => {})

    return JSON.stringify({
      success: true,
      id: entry.id,
      path: entry.path,
      scope: entry.scope,
      category,
      action: 'extracted',
    })
  },
}

const kbReflectTool: ToolDefinition = {
  name: 'kb_reflect',
  description: '反思与整合知识库。Agent 可定期回顾知识库，提炼模式、压缩旧内容、更新过时信息。适合在对话结束时调用。',
  parameters: {
    action: { type: 'string', description: '反思动作: consolidate(整合重复)/compress(压缩旧内容)/update(更新过时)/stats(查看统计)', required: true, enum: ['consolidate', 'compress', 'update', 'stats'] },
    scope: { type: 'string', description: '作用域: global / project / 不填则全部', required: false, enum: ['global', 'project'] },
    pathPrefix: { type: 'string', description: '路径前缀筛选', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '反思知识',
  } satisfies ToolMeta,
  execute: async (args) => {
    const action = String(args.action)
    const scope = args.scope ? (String(args.scope)) as KBScope : undefined
    const pathPrefix = args.pathPrefix ? String(args.pathPrefix) : undefined

    if (action === 'stats') {
      const stats = await kbGetStats()
      const entries = await kbList(scope, pathPrefix)
      const staleEntries = entries.filter(e => {
        const ageDays = (Date.now() - e.updatedAt) / 86400000
        return ageDays > 30 && e.accessCount < 2
      })
      return JSON.stringify({
        stats,
        filtered: entries.length,
        stale: staleEntries.length,
        stalePaths: staleEntries.map(e => `${e.scope}/${e.path}`),
        hint: staleEntries.length > 0
          ? `${staleEntries.length} 条知识超过30天未访问，可考虑压缩或清理`
          : '知识库状态良好',
      })
    }

    if (action === 'consolidate') {
      const entries = await kbList(scope, pathPrefix)
      const pathGroups = new Map<string, typeof entries>()
      for (const e of entries) {
        const dir = e.path.includes('/') ? e.path.substring(0, e.path.lastIndexOf('/')) : ''
        if (!pathGroups.has(dir)) pathGroups.set(dir, [])
        pathGroups.get(dir)!.push(e)
      }

      const suggestions: string[] = []
      for (const [dir, group] of pathGroups) {
        if (group.length > 5) {
          suggestions.push(`${dir}/ 下有 ${group.length} 条知识，可考虑整合`)
        }
      }

      return JSON.stringify({
        action: 'consolidate',
        totalEntries: entries.length,
        groups: Object.fromEntries([...pathGroups.entries()].map(([k, v]) => [k, v.length])),
        suggestions,
      })
    }

    if (action === 'compress') {
      const entries = await kbList(scope, pathPrefix)
      const stale = entries.filter(e => {
        const ageDays = (Date.now() - e.updatedAt) / 86400000
        return ageDays > 30 && e.accessCount < 2
      })

      return JSON.stringify({
        action: 'compress',
        candidates: stale.map(e => ({
          id: e.id,
          path: `${e.scope}/${e.path}`,
          ageDays: Math.round((Date.now() - e.updatedAt) / 86400000),
          accessCount: e.accessCount,
        })),
        hint: '请使用 kb_write 更新这些条目的 summary 字段进行压缩，或使用 kb_delete 清理',
      })
    }

    return JSON.stringify({ action, message: '请指定具体的反思动作' })
  },
}

const kbLinkTool: ToolDefinition = {
  name: 'kb_link',
  description: '将知识条目关联到实体，或取消关联。关联后，查询实体时可联动检索相关知识。',
  parameters: {
    action: { type: 'string', description: '操作: link(关联)/unlink(取消关联)', required: true, enum: ['link', 'unlink'] },
    path: { type: 'string', description: '知识文档路径', required: true },
    scope: { type: 'string', description: '作用域: global / project，默认 project', required: false, enum: ['global', 'project'] },
    entityId: { type: 'string', description: '实体 ID（link 时必填）', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '链接知识',
  } satisfies ToolMeta,
  execute: async (args) => {
    const action = String(args.action)
    const path = String(args.path).trim()
    const scope = (String(args.scope || 'project')) as KBScope

    if (action === 'link') {
      const entityId = String(args.entityId)
      if (!entityId) return JSON.stringify({ error: 'link 操作需要 entityId' })
      const ok = await kbLinkEntity(scope, path, entityId)
      if (!ok) return JSON.stringify({ error: `知识文档不存在: ${scope}/${path}` })
      return JSON.stringify({ success: true, action: 'linked', path: `${scope}/${path}`, entityId })
    }

    if (action === 'unlink') {
      const ok = await kbUnlinkEntity(scope, path)
      if (!ok) return JSON.stringify({ error: `知识文档不存在: ${scope}/${path}` })
      return JSON.stringify({ success: true, action: 'unlinked', path: `${scope}/${path}` })
    }

    return JSON.stringify({ error: '未知操作' })
  },
}

const kbInitTool: ToolDefinition = {
  name: 'kb_init',
  description: '初始化知识库目录结构。首次使用时自动调用，创建约定的目录占位。',
  parameters: {
    scope: { type: 'string', description: '作用域: global / project，默认 project', required: false, enum: ['global', 'project'] },
  },
  meta: {
    permission: 'moderate',
    category: 'plan',
    alwaysAvailable: true,
    displayName: '初始化知识库',
  } satisfies ToolMeta,
  execute: async (args) => {
    const scope = (String(args.scope || 'project')) as KBScope
    await kbEnsureStructure(scope)
    return JSON.stringify({
      success: true,
      scope,
      message: `知识库 ${scope} 作用域已初始化`,
      structure: KB_PATH_CONVENTION.trim(),
    })
  },
}

export const kbTools: ToolDefinition[] = [
  kbWriteTool, kbReadTool, kbListTool, kbSearchTool,
  kbDeleteTool, kbExtractTool, kbReflectTool, kbLinkTool, kbInitTool,
]

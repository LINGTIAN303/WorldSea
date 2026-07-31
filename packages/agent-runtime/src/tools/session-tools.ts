import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'

export const sessionInfo: ToolDefinition = {
  name: 'session_info',
  description: '获取当前会话的详细信息（ID、名称、创建时间、消息数、固定状态）。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'session',
    displayName: '会话信息',
  } satisfies ToolMeta,
  execute: async (_args, ctx) => {
    if (!ctx.currentSessionId) {
      return '当前上下文未关联会话'
    }
    if (ctx.getSessionInfo) {
      const info = await ctx.getSessionInfo(ctx.currentSessionId)
      if (info) {
        return JSON.stringify(info)
      }
    }
    return JSON.stringify({ sessionId: ctx.currentSessionId, note: '当前会话 ID，详情可通过 session_list 查看' })
  },
}

export const sessionList: ToolDefinition = {
  name: 'session_list',
  description: '列出所有历史会话。可选按名称搜索。返回每个会话的 ID、名称、创建时间、消息数量和固定状态。',
  parameters: {
    query: {
      type: 'string',
      description: '可选的搜索关键词，按会话名称过滤',
      required: false,
    },
  },
  meta: {
    permission: 'safe',
    category: 'session',
    displayName: '会话列表',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    if (!ctx.listSessions) {
      return '当前环境不支持列出会话'
    }
    const query = args.query as string | undefined
    const sessions = await ctx.listSessions(query)
    if (sessions.length === 0) {
      return query ? `未找到名称包含"${query}"的会话` : '当前没有历史会话'
    }
    return JSON.stringify(sessions)
  },
}

export const sessionRead: ToolDefinition = {
  name: 'session_read',
  description: '读取指定会话的消息内容。返回消息列表（角色、内容、时间戳）。适合查看历史会话中讨论的具体内容。注意：消息数过多的会话会返回最近的部分消息。',
  parameters: {
    sessionId: {
      type: 'string',
      description: '要读取的会话 ID',
      required: true,
    },
  },
  meta: {
    permission: 'safe',
    category: 'session',
    displayName: '读取会话',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const sessionId = args.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return '错误：sessionId 参数不能为空'
    }
    if (!ctx.readSessionMessages) {
      return '当前环境不支持读取会话消息'
    }
    const messages = await ctx.readSessionMessages(sessionId)
    if (!messages || messages.length === 0) {
      return `会话 ${sessionId} 中没有消息`
    }
    return JSON.stringify(messages)
  },
}

export const sessionTools = [sessionInfo, sessionList, sessionRead]

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { ManuscriptBlock } from '../bridge-types'

let _idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_idCounter}`
}

export const manuscriptClone: ToolDefinition = {
  name: 'manuscript_clone',
  description: '从指定会话中复制文境容器到当前会话。复制内容包括文本内容和所有容器样式（排版、动画、阴影、装饰、字号、字体、颜色、背景等）。源会话删除时副本也会被移除。',
  parameters: {
    sourceSessionId: {
      type: 'string',
      description: '源会话 ID，从该会话中复制文境容器',
      required: true,
    },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '克隆文境',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const sourceId = args.sourceSessionId
    if (!sourceId || typeof sourceId !== 'string') {
      return '错误：sourceSessionId 参数不能为空'
    }

    if (!ctx.findManuscriptInSession) {
      return '错误：当前环境不支持文境克隆功能'
    }

    const sourceBlock = await ctx.findManuscriptInSession(sourceId)
    if (!sourceBlock) {
      return `错误：会话 ${sourceId} 中没有找到文境容器`
    }

    // 深拷贝，生成新 ID
    const clonedBlock: ManuscriptBlock = {
      ...JSON.parse(JSON.stringify(sourceBlock)),
      id: nextId('msc'),
      sourceSessionId: sourceId,
    }

    // 如果当前会话已有文境，先移除旧的
    ctx.appendBlock?.(clonedBlock)

    return `已从会话 ${sourceId} 复制文境"${clonedBlock.title || '文稿'}"到当前会话。副本与源文境独立，源会话删除时副本也会被移除。`
  },
}

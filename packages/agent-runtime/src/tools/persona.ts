import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import { kbWrite, kbRead } from '../kb/kb-store'

const PERSONA_UPDATE_TOOL_DESC = `更新你的自我认知信息（名字和头像）。

使用场景：
- 用户给你起了昵称或新名字时，主动更新
- 用户要求更换头像时，主动更新
- 你认为需要调整自我展示时，主动更新

更新后会立即生效到界面显示。名字和头像至少提供一项。`

export const personaUpdateTool: ToolDefinition = {
  name: 'persona_update',
  description: PERSONA_UPDATE_TOOL_DESC,
  parameters: {
    name: { type: 'string', description: '你的新名字或昵称，如"小星"、"WorldSmith"等', required: false },
    avatar: { type: 'string', description: '你的新头像，单个 emoji 或字符，如"🌟"、"✨"、"W"等', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'persona',
    displayName: '更新人格',
  } satisfies ToolMeta,
  execute: async (args) => {
    const name = args.name ? String(args.name).trim() : undefined
    const avatar = args.avatar ? String(args.avatar).trim().slice(0, 2) : undefined

    if (!name && !avatar) {
      return JSON.stringify({ error: '至少提供 name 或 avatar 之一' })
    }

    const updates: string[] = []

    if (name) {
      await kbWrite({
        path: 'profile/nickname.md',
        scope: 'global',
        content: `# 昵称\n\n${name}`,
        tags: ['preference', 'identity'],
        summary: `AI的昵称被用户命名为"${name}"`,
      })
      updates.push(`名字更新为「${name}」`)
    }

    if (avatar) {
      await kbWrite({
        path: 'profile/avatar.md',
        scope: 'global',
        content: `# 头像\n\n${avatar}`,
        tags: ['preference', 'identity'],
        summary: `AI的头像: ${avatar}`,
      })
      updates.push(`头像更新为「${avatar}」`)
    }

    return JSON.stringify({
      success: true,
      updates,
      name: name || '',
      avatar: avatar || '',
    })
  },
}

export async function loadPersonaFromKB(): Promise<{ name?: string; avatar?: string }> {
  const result: { name?: string; avatar?: string } = {}

  try {
    const nickname = await kbRead('global', 'profile/nickname.md')
    if (nickname?.content) {
      const lines = nickname.content.split('\n').map(l => l.trim()).filter(Boolean)
      const nameLine = lines.find(l => l && !l.startsWith('#'))
      if (nameLine) result.name = nameLine
    }
  } catch {}

  try {
    const avatarDoc = await kbRead('global', 'profile/avatar.md')
    if (avatarDoc?.content) {
      const lines = avatarDoc.content.split('\n').map(l => l.trim()).filter(Boolean)
      const avatarLine = lines.find(l => l && !l.startsWith('#'))
      if (avatarLine) result.avatar = avatarLine.slice(0, 2)
    }
  } catch {}

  return result
}

export const personaTools: ToolDefinition[] = [personaUpdateTool]

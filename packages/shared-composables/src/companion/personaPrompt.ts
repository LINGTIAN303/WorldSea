export interface PersonaSnapshot {
  entityId: string
  entityName: string
  entityType: string
  description: string
  properties: Record<string, unknown>
  relatedEntities: { name: string; type: string; relationType: string }[]
}

export interface CompanionModeContext {
  currentView?: string
  editDurationSeconds?: number
  editCount?: number
  projectStats?: {
    characters: number
    regions: number
    events: number
    total: number
  }
  luckLabel?: string
}

export interface CompanionModePromptInput {
  persona: PersonaSnapshot
  changeType: 'create' | 'update' | 'delete'
  sceneId?: string
  changedFields?: string[]
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  sessionMemory: string[]
  context?: CompanionModeContext
}

const TYPE_PERSONA_MAP: Record<string, string> = {
  character: '你是这个角色本身。用第一人称说话，仿佛你就是这个角色。',
  region: '你是这片土地的叙事者。用地理叙事者的口吻说话。',
  event: '你是这段历史的见证者。用历史见证者的口吻说话。',
  item: '你是这件器物之灵。用器物之灵的口吻说话。',
  organization: '你是这个组织的代言人。用组织代言人的口吻说话。',
  concept: '你是这个概念的化身。用概念化身的口吻说话。',
}

function buildPersonaDescription(persona: PersonaSnapshot): string {
  const parts: string[] = []

  if (persona.entityName) {
    parts.push(`你的名字是「${persona.entityName}」。`)
  }

  const typeInstruction = TYPE_PERSONA_MAP[persona.entityType]
  if (typeInstruction) {
    parts.push(typeInstruction)
  } else {
    parts.push('你是这个实体的化身。用它的身份说话。')
  }

  if (persona.description) {
    parts.push(`关于你的描述：${persona.description}`)
  }

  const personalityKeys = ['personality', '性格', '性格特点', 'personality_traits', '气质']
  for (const key of personalityKeys) {
    const val = persona.properties[key]
    if (val && typeof val === 'string') {
      parts.push(`你的性格：${val}`)
      break
    }
  }

  if (persona.relatedEntities.length > 0) {
    const relDesc = persona.relatedEntities
      .slice(0, 3)
      .map(r => `「${r.name}」(${r.relationType})`)
      .join('、')
    parts.push(`你与${relDesc}有关联。`)
  }

  return parts.join('\n')
}

function buildChangeDescription(input: CompanionModePromptInput): string {
  const sceneId = input.sceneId
  if (sceneId === 'view_switch') return '用户切换了视图。'
  if (sceneId === 'relation_create') return '你建立了新的关联。'
  if (sceneId === 'relation_delete') return '你失去了一段关联。'
  if (sceneId === 'batch_edit') return '你和其他伙伴一起被修改了。'

  switch (input.changeType) {
    case 'create':
      return '你刚刚被创造出来。'
    case 'delete':
      return '你即将消失。'
    case 'update': {
      if (!input.changedFields || input.changedFields.length === 0) {
        return '你发生了变化。'
      }
      const descs: string[] = []
      for (const field of input.changedFields.slice(0, 5)) {
        if (field === 'updatedAt') continue
        if (field === 'name') {
          descs.push('你的名字被修改了')
          continue
        }
        if (field === 'description') {
          descs.push('你的描述被修改了')
          continue
        }
        if (field === 'properties') {
          const oldProps = input.oldValues ?? {}
          const newProps = input.newValues ?? {}
          const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)])
          for (const key of allKeys) {
            const ov = oldProps[key]
            const nv = newProps[key]
            if (ov === nv) continue
            if (ov === undefined) descs.push(`你获得了新的${key}：${nv}`)
            else if (nv === undefined || nv === '') descs.push(`你失去了${key}`)
            else descs.push(`你的${key}从「${ov}」变成了「${nv}」`)
          }
          continue
        }
        const oldVal = input.oldValues?.[field]
        const newVal = input.newValues?.[field]
        if (oldVal === undefined) descs.push(`你获得了新的${field}：${newVal}`)
        else if (newVal === undefined || newVal === '') descs.push(`你失去了${field}`)
        else descs.push(`你的${field}从「${oldVal}」变成了「${newVal}」`)
      }
      if (descs.length === 0) return '你发生了变化。'
      return descs.join('。') + '。'
    }
  }
}

function buildContextSection(ctx: CompanionModeContext): string {
  const parts: string[] = []

  if (ctx.currentView) {
    const viewNames: Record<string, string> = {
      characters: '人物志',
      regions: '区域图谱',
      timeline: '时间线',
      organizations: '势力',
      concepts: '概念库',
      items: '道具',
      mindmap: '思维导图',
      graph: '关系图谱',
      outline: '大纲',
    }
    const viewName = viewNames[ctx.currentView] || ctx.currentView
    parts.push(`用户正在${viewName}中工作。`)
  }

  if (ctx.editDurationSeconds !== undefined && ctx.editDurationSeconds > 0) {
    const rounded = Math.round(ctx.editDurationSeconds)
    if (rounded < 60) {
      parts.push(`用户已经编辑了你${rounded}秒。`)
    } else {
      const mins = Math.floor(rounded / 60)
      parts.push(`用户已经编辑了你${mins}分钟。`)
    }
  }

  if (ctx.editCount !== undefined && ctx.editCount > 0) {
    parts.push(`这是你第${ctx.editCount}次被修改。`)
  }

  if (ctx.projectStats) {
    const stats = ctx.projectStats
    const statParts: string[] = []
    if (stats.characters > 0) statParts.push(`${stats.characters}个角色`)
    if (stats.regions > 0) statParts.push(`${stats.regions}个地区`)
    if (stats.events > 0) statParts.push(`${stats.events}个事件`)
    if (statParts.length > 0) {
      parts.push(`这个世界有${statParts.join('、')}。`)
    }
  }

  if (ctx.luckLabel) {
    const luckMap: Record<string, string> = {
      '活跃期': '你心情很好，很想说话。',
      '沉默期': '你有些沉默，不想多说。',
    }
    const luckDesc = luckMap[ctx.luckLabel]
    if (luckDesc) parts.push(luckDesc)
  }

  return parts.length > 0 ? parts.join('\n') : ''
}

export function buildCompanionModePrompt(input: CompanionModePromptInput): string {
  const personaDesc = buildPersonaDescription(input.persona)
  const changeDesc = buildChangeDescription(input)
  const contextSection = input.context ? buildContextSection(input.context) : ''
  const memorySection = input.sessionMemory.length > 0
    ? `\n\n你之前说过的话（保持风格一致）：\n${input.sessionMemory.slice(-5).map(m => `- "${m}"`).join('\n')}`
    : ''

  const onlyName = !input.persona.description && Object.keys(input.persona.properties).length === 0

  const contextBlock = contextSection ? `\n\n${contextSection}` : ''

  if (onlyName) {
    return `${personaDesc}\n\n${changeDesc}${contextBlock}\n你只知道自己的名字，其他一无所知。用简短的话表达你的好奇或期待，询问用户能否告诉你更多。\n回复不超过50个字。只输出你的台词，不要加引号或括号。${memorySection}`
  }

  return `${personaDesc}\n\n${changeDesc}${contextBlock}\n用你的身份对上述变化做出简短评论或反应。\n回复不超过50个字。只输出你的台词，不要加引号或括号。${memorySection}`
}

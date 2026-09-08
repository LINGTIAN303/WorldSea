import Dexie, { type Table } from 'dexie'
import type { GroupSession, CasualGroupSession, ChatAgent } from './types'
import type { GroupListItem } from './management/GroupStore'

class GroupChatDB extends Dexie {
  sessions!: Table<GroupSession, string>
  casualSessions!: Table<CasualGroupSession, string>
  agents!: Table<ChatAgent, string>

  constructor() {
    super('worldsea-group-chat')
    this.version(1).stores({
      sessions: 'id, name, updatedAt, state',
    })
    this.version(2).stores({
      sessions: 'id, name, updatedAt, state',
      casualSessions: 'id',
    }).upgrade(_tx => {
      // v2 adds casualSessions table
    })
    this.version(3).stores({
      sessions: 'id, name, updatedAt, state',
      casualSessions: 'id',
      agents: 'id, name, sourceType, updatedAt',
    })
  }
}

let db: GroupChatDB | null = null

function getDb(): GroupChatDB {
  if (!db) db = new GroupChatDB()
  return db
}

export async function listGroupSessions(): Promise<GroupSession[]> {
  try {
    return await getDb().sessions.orderBy('updatedAt').reverse().toArray()
  } catch (err) {
    console.warn('[GroupSessionManager] listGroupSessions 失败', err)
    return []
  }
}

export async function getGroupSession(id: string): Promise<GroupSession | undefined> {
  try {
    return await getDb().sessions.get(id)
  } catch (err) {
    console.warn('[GroupSessionManager] getGroupSession 失败', err)
    return undefined
  }
}

export async function saveGroupSession(session: GroupSession): Promise<void> {
  try {
    const raw = JSON.parse(JSON.stringify({ ...session, updatedAt: new Date().toISOString() }))
    await getDb().sessions.put(raw)
  } catch (e) {
    console.error('[GroupSessionManager] saveGroupSession failed:', e)
  }
}

export async function deleteGroupSession(id: string): Promise<void> {
  try {
    await getDb().sessions.delete(id)
  } catch (err) {
    console.warn('[GroupSessionManager] deleteGroupSession 失败', err)
  }
}

export async function createGroupSession(
  topic: string,
  participants: GroupSession['participants'],
  config: GroupSession['config'],
  budget: GroupSession['budget'],
): Promise<GroupSession> {
  const session: GroupSession = {
    id: crypto.randomUUID(),
    name: topic,
    topic,
    participants,
    messages: [],
    config,
    budget,
    costTracker: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      perAgentCost: {},
      remainingBudget: budget.maxCostUsd,
      budgetPercentUsed: 0,
    },
    state: 'idle',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentRound: 0,
    startedAt: null,
  }
  await saveGroupSession(session)
  return session
}

export async function pinGroupSession(id: string): Promise<void> {
  const session = await getGroupSession(id)
  if (session) {
    await saveGroupSession({ ...JSON.parse(JSON.stringify(session)), pinned: true })
  }
}

export async function unpinGroupSession(id: string): Promise<void> {
  const session = await getGroupSession(id)
  if (session) {
    await saveGroupSession({ ...JSON.parse(JSON.stringify(session)), pinned: false })
  }
}

export async function renameGroupSession(id: string, name: string): Promise<void> {
  const session = await getGroupSession(id)
  if (session) {
    await saveGroupSession({ ...JSON.parse(JSON.stringify(session)), name })
  }
}

export async function getAllGroupSessions(): Promise<GroupListItem[]> {
  try {
    const meetingSessions = await getDb().sessions.orderBy('updatedAt').reverse().toArray()
    const casualSessions = await getDb().casualSessions.toArray()

    const meetingItems: GroupListItem[] = meetingSessions.map(s => ({
      id: s.id,
      name: s.name,
      avatar: '👥',
      mode: 'meeting' as const,
      lastMessage: s.messages.length > 0 ? s.messages[s.messages.length - 1].content.slice(0, 30) : '',
      lastMessageAt: new Date(s.updatedAt).getTime(),
      unreadCount: 0,
      pinned: s.pinned || false,
      memberCount: s.participants.length,
    }))

    const casualItems: GroupListItem[] = casualSessions.map(s => ({
      id: s.info.id,
      name: s.info.name,
      avatar: s.info.avatar || '👥',
      mode: 'casual' as const,
      lastMessage: s.messages.length > 0 ? s.messages[s.messages.length - 1].content.slice(0, 30) : '',
      lastMessageAt: s.info.updatedAt,
      unreadCount: 0,
      pinned: false,
      memberCount: s.members.length,
    }))

    return [...meetingItems, ...casualItems].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  } catch {
    return []
  }
}

export async function saveCasualGroupSession(session: CasualGroupSession): Promise<void> {
  try {
    const raw = JSON.parse(JSON.stringify(session))
    raw.id = session.info.id
    await getDb().casualSessions.put(raw)
  } catch (e) {
    console.error('[GroupSessionManager] saveCasualGroupSession failed:', e)
  }
}

export async function getCasualGroupSession(id: string): Promise<CasualGroupSession | undefined> {
  try {
    return await getDb().casualSessions.get(id)
  } catch {
    return undefined
  }
}

export async function deleteCasualGroupSession(id: string): Promise<void> {
  try {
    await getDb().casualSessions.delete(id)
  } catch {}
}

export async function saveChatAgent(agent: ChatAgent): Promise<void> {
  try {
    const raw = JSON.parse(JSON.stringify(agent))
    await getDb().agents.put(raw)
  } catch (e) {
    console.error('[GroupSessionManager] saveChatAgent failed:', e)
  }
}

export async function getChatAgent(id: string): Promise<ChatAgent | undefined> {
  try {
    return await getDb().agents.get(id)
  } catch {
    return undefined
  }
}

export async function getAllChatAgents(): Promise<ChatAgent[]> {
  try {
    return await getDb().agents.orderBy('updatedAt').reverse().toArray()
  } catch {
    return []
  }
}

export async function deleteChatAgent(id: string): Promise<void> {
  try {
    await getDb().agents.delete(id)
  } catch {}
}
import { ref, readonly } from 'vue'

export interface AgentCommand {
  id: string
  label: string
  icon: string
  description: string
  category: 'skill' | 'session' | 'action' | 'settings'
  handler: () => void | Promise<void>
}

const commands = ref<AgentCommand[]>([])
const menuOpen = ref(false)
const sessionsOpen = ref(false)
const settingsOpen = ref(false)

let _sendMessageRef: ((text: string) => Promise<void>) | null = null
let _openSettingsRef: (() => void) | null = null

export function bindAgentActions(
  sendMessage: (text: string) => Promise<void>,
  openSettings: () => void,
): void {
  _sendMessageRef = sendMessage
  _openSettingsRef = openSettings
}

function lazySend(text: string): void {
  if (_sendMessageRef) _sendMessageRef(text)
}

function lazyOpenSettings(): void {
  if (_openSettingsRef) _openSettingsRef()
}

const WORLD_SMITH_SKILLS: AgentCommand[] = [
  { id: 'create-character', label: '创建角色', icon: 'user', description: '创建一个新的角色实体', category: 'skill', handler: () => lazySend('帮我创建一个角色，请告诉我名称和描述') },
  { id: 'create-location', label: '创建地点', icon: 'building', description: '创建一个新的地点实体', category: 'skill', handler: () => lazySend('帮我创建一个地点，请告诉我名称和描述') },
  { id: 'create-faction', label: '创建势力', icon: 'sword', description: '创建一个新的势力实体', category: 'skill', handler: () => lazySend('帮我创建一个势力，请告诉我名称和描述') },
  { id: 'create-event', label: '创建事件', icon: 'zap', description: '创建一个新的世界事件', category: 'skill', handler: () => lazySend('帮我创建一个世界事件，请告诉我事件名称和经过') },
  { id: 'link', label: '建立关系', icon: 'link', description: '在两个实体之间建立关系', category: 'skill', handler: () => lazySend('帮我在两个实体之间建立关系，请告诉我实体名称和关系类型') },
  { id: 'search', label: '搜索内容', icon: 'search', description: '在项目中搜索关键词', category: 'skill', handler: () => lazySend('帮我搜索项目中的内容，请告诉我关键词') },
  { id: 'report', label: '每日报告', icon: 'chart', description: '生成项目每日状态报告', category: 'skill', handler: () => lazySend('生成今日项目状态报告') },
  { id: 'check', label: '一致性检查', icon: 'check-circle', description: '检查数据一致性', category: 'skill', handler: () => lazySend('检查项目数据一致性') },
  { id: 'overview', label: '数据概览', icon: 'clipboard-list', description: '列出所有实体类型和数量', category: 'skill', handler: () => lazySend('列出所有实体类型和数量分布') },
  { id: 'settings', label: 'AI 设置', icon: 'settings', description: '打开 AI 助手设置', category: 'settings', handler: () => lazyOpenSettings() },
]

let skillsRegistered = false

function ensureSkillsRegistered(): void {
  if (skillsRegistered) return
  skillsRegistered = true
  for (const skill of WORLD_SMITH_SKILLS) {
    if (!commands.value.some(c => c.id === skill.id)) {
      commands.value.push(skill)
    }
  }
}

export function useAgentCommands() {
  ensureSkillsRegistered()

  function register(command: AgentCommand): void {
    if (commands.value.some(c => c.id === command.id)) return
    commands.value.push(command)
  }

  function unregister(id: string): void {
    commands.value = commands.value.filter(c => c.id !== id)
  }

  function toggleMenu(): void {
    menuOpen.value = !menuOpen.value
  }

  function openMenu(): void {
    menuOpen.value = true
  }

  function closeMenu(): void {
    menuOpen.value = false
  }

  function toggleSessions(): void {
    sessionsOpen.value = !sessionsOpen.value
  }

  function openSettings(): void {
    settingsOpen.value = true
  }

  function closeSettings(): void {
    settingsOpen.value = false
  }

  function closeSessions(): void {
    sessionsOpen.value = false
  }

  function getCommandsByCategory(category: AgentCommand['category']): AgentCommand[] {
    return commands.value.filter(c => c.category === category)
  }

  return {
    commands: readonly(commands),
    menuOpen: readonly(menuOpen),
    sessionsOpen: readonly(sessionsOpen),
    settingsOpen: readonly(settingsOpen),
    register,
    unregister,
    toggleMenu,
    openMenu,
    closeMenu,
    toggleSessions,
    openSettings,
    closeSettings,
    closeSessions,
    getCommandsByCategory,
  }
}

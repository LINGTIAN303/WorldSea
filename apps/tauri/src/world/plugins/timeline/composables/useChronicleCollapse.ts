/**
 * 编年史分段折叠状态：localStorage 按项目隔离（换项目不串），视图重载 / 切视图后恢复。
 * 只存 Set 的数组快照；分组模式切换后遗留 id 不匹配即自然忽略，无需清理。
 */
import { ref } from 'vue'
import { getProjectManager } from '@worldsea/entity-core/core'

const LS_PREFIX = 'worldsea_timeline_collapsed_groups'

function storageKey(): string {
  try {
    return `${LS_PREFIX}:${getProjectManager().getCurrentProjectId() ?? 'default'}`
  } catch {
    return `${LS_PREFIX}:default`
  }
}

function readCollapsed(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeCollapsed(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value]))
  } catch {
    /* 隐私模式 / 配额：折叠态不持久化，本次会话内仍生效 */
  }
}

export function useChronicleCollapse() {
  const key = storageKey()
  const collapsed = ref(readCollapsed(key))

  function isCollapsed(id: string): boolean {
    return collapsed.value.has(id)
  }
  function toggleGroup(id: string): void {
    const next = new Set(collapsed.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsed.value = next
    writeCollapsed(key, next)
  }
  return { isCollapsed, toggleGroup }
}

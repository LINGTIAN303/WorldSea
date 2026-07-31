export type ShortcutScope = 'global' | 'view' | 'editor' | 'modal'

export interface ShortcutDef {
  id: string
  keys: string[]
  description: string
  scope: ShortcutScope
  handler: () => void
  preventDefault?: boolean
}

export const isMac = typeof navigator !== 'undefined'
  && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

export function formatKeysForDisplay(keys: string[]): string {
  return keys.map(k => {
    if (isMac) {
      const macMap: Record<string, string> = {
        ctrl: '⌘', alt: '⌥', shift: '⇧',
        escape: '⎋', enter: '↵', space: '␣',
        delete: '⌦', backspace: '⌫', tab: '⇥',
        up: '↑', down: '↓', left: '←', right: '→',
      }
      return macMap[k] || k.toUpperCase()
    }
    const winMap: Record<string, string> = {
      ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift',
      escape: 'Esc', enter: 'Enter', space: 'Space',
      delete: 'Del', backspace: 'BS', tab: 'Tab',
      up: '↑', down: '↓', left: '←', right: '→',
    }
    return winMap[k] || k.toUpperCase()
  }).join(isMac ? '' : '+')
}

export function formatKeyForDisplay(k: string): string {
  return formatKeysForDisplay([k])
}

const registry = new Map<string, ShortcutDef>()
const defaultKeysMap = new Map<string, string[]>()

function normalizeKeys(e: KeyboardEvent): string[] {
  const keys: string[] = []
  if (e.ctrlKey || e.metaKey) keys.push('ctrl')
  if (e.altKey) keys.push('alt')
  if (e.shiftKey) keys.push('shift')
  const main = e.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(main)) {
    const special: Record<string, string> = {
      'escape': 'escape', 'enter': 'enter', ' ': 'space',
      'delete': 'delete', 'backspace': 'backspace',
      'tab': 'tab', 'arrowup': 'up', 'arrowdown': 'down',
      'arrowleft': 'left', 'arrowright': 'right',
    }
    keys.push(special[main] || main)
  }
  return keys.sort()
}

function keysMatch(pressed: string[], def: string[]): boolean {
  if (pressed.length !== def.length) return false
  const pa = [...pressed].sort()
  const da = [...def].sort()
  return pa.every((k, i) => k === da[i])
}

const SCOPE_ORDER: ShortcutScope[] = ['modal', 'editor', 'view', 'global']

const PREVENT_DEFAULT: Record<string, string[]> = {
  'ctrl+n': ['ctrl', 'n'],
  'ctrl+s': ['ctrl', 's'],
  'ctrl+t': ['ctrl', 't'],
  'ctrl+w': ['ctrl', 'w'],
  'ctrl+shift+n': ['ctrl', 'shift', 'n'],
}

function isPreventDefault(pressed: string[]): boolean {
  const key = pressed.join('+')
  return key in PREVENT_DEFAULT
}

let cachedOverrides: Record<string, string[]> | null = null

function loadOverrides(): Record<string, string[]> {
  if (cachedOverrides) return cachedOverrides
  try {
    const raw = localStorage.getItem('worldsmith_shortcuts')
    cachedOverrides = raw ? JSON.parse(raw) : {}
  } catch {
    cachedOverrides = {}
  }
  return cachedOverrides ?? {}
}

function isValidKeys(keys: unknown): keys is string[] {
  return Array.isArray(keys) && keys.length > 0 && keys.every(k => typeof k === 'string' && k.length > 0)
}

let listenerAttached = false

function attachGlobalListener() {
  if (listenerAttached) return
  listenerAttached = true

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const pressed = normalizeKeys(e)
    if (pressed.length === 0) return

    const tag = (e.target as HTMLElement)?.tagName
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable

    for (const scope of SCOPE_ORDER) {
      if (isInput && scope !== 'modal') continue

      for (const [, def] of registry) {
        if (def.scope !== scope) continue
        if (!keysMatch(pressed, def.keys)) continue

        if (def.preventDefault || isPreventDefault(pressed)) {
          e.preventDefault()
        }
        e.stopImmediatePropagation()
        def.handler()
        return
      }
    }
  })
}

export interface ShortcutConflict {
  id: string
  keys: string[]
  scope: ShortcutScope
  conflictWith: { id: string; keys: string[]; scope: ShortcutScope }[]
}

export function useShortcuts() {
  attachGlobalListener()

  /** 检测同 scope 下是否有重复键位，返回冲突列表 */
  function detectConflicts(id: string, keys: string[], scope: ShortcutScope): ShortcutConflict | null {
    const conflicts: { id: string; keys: string[]; scope: ShortcutScope }[] = []
    for (const [otherId, def] of registry) {
      if (otherId === id) continue
      if (def.scope !== scope) continue
      if (sameKeys(keys, def.keys)) {
        conflicts.push({ id: otherId, keys: def.keys, scope: def.scope })
      }
    }
    return conflicts.length > 0 ? { id, keys, scope, conflictWith: conflicts } : null
  }

  function register(def: ShortcutDef) {
    if (registry.has(def.id)) {
      console.warn(`[useShortcuts] 快捷键 "${def.id}" 被重新注册，覆盖旧定义`)
    }
    const c = detectConflicts(def.id, def.keys, def.scope)
    if (c) {
      console.warn(`[useShortcuts] 注册 "${def.id}" 键位 ${JSON.stringify(def.keys)} 与 ${c.conflictWith.length} 个已有快捷键冲突`)
    }
    defaultKeysMap.set(def.id, def.keys)
    const overrides = loadOverrides()
    const overrideKeys = overrides[def.id]
    if (isValidKeys(overrideKeys)) {
      def = { ...def, keys: overrideKeys }
    }
    registry.set(def.id, def)
  }

  function getDefaultKeys(id: string): string[] | null {
    return defaultKeysMap.get(id) ?? null
  }

  function getRegisteredKeys(id: string): string[] | null {
    const stored = registry.get(id)
    return stored ? stored.keys : null
  }

  function unregister(id: string) {
    registry.delete(id)
  }

  function getAll(): ShortcutDef[] {
    return Array.from(registry.values())
  }

  function getByScope(scope: ShortcutScope): ShortcutDef[] {
    return getAll().filter(d => d.scope === scope)
  }

  function updateKeys(id: string, newKeys: string[]) {
    const def = registry.get(id)
    if (def) {
      registry.set(id, { ...def, keys: newKeys })
    }
  }

  /**
   * 设置自定义快捷键（供 settings 面板使用），有冲突时阻断并返回冲突列表。
   * 无冲突时写入 registry 并持久化到 localStorage。
   */
  function setShortcut(id: string, newKeys: string[]): { ok: boolean; conflict?: ShortcutConflict } {
    const def = registry.get(id)
    if (!def) return { ok: false }
    const c = detectConflicts(id, newKeys, def.scope)
    if (c) {
      console.warn(`[useShortcuts] 设置 "${id}" 键位 ${JSON.stringify(newKeys)} 冲突`)
      return { ok: false, conflict: c }
    }
    registry.set(id, { ...def, keys: newKeys })
    const overrides = loadOverrides()
    overrides[id] = newKeys
    try {
      localStorage.setItem('worldsmith_shortcuts', JSON.stringify(overrides))
    } catch {
      console.warn('[useShortcuts] 持久化快捷键覆盖失败')
    }
    cachedOverrides = overrides
    return { ok: true }
  }

  return { register, unregister, getAll, getByScope, getDefaultKeys, getRegisteredKeys, updateKeys, setShortcut }
}

/** 比较两个键位数组是否相等 */
function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((k, i) => k === sb[i])
}

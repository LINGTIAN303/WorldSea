import { ref } from 'vue'

export type ShortcutScope = 'global' | 'space' | 'view' | 'editor' | 'modal'
export type ShortcutKind = 'chord' | 'sequence'

export interface ShortcutDef {
  id: string
  keys: string[]
  description: string
  scope: ShortcutScope
  handler: () => void
  preventDefault?: boolean
  /** 键型：chord=组合键（默认）；sequence=连击序列（keys 按序逐键匹配，500ms 超时，如 ['n','c']） */
  kind?: ShortcutKind
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
// ── 视图上下文（N9 修复 2026-08-28）──
// view scope 快捷键仅在「主视图上下文」生效：Agent 空间激活（App.vue currentShell==='space'）
// 时由 App 注入 null → view 快捷键全部失效，避免 Shell 常驻挂载的插件视图（角色/导图等）
// 快捷键在 Agent 空间误触发（如 n=新建 / delete=删除）。
let activeViewId: string | null = null
export function setActiveViewId(id: string | null): void {
  activeViewId = id
}

// ── 壳上下文（2026-09-06 space scope）──
// space scope 仅在 Agent 空间壳激活时生效（App.vue 按 currentShell 注入）。
// AgentSpace 与 Shell 均 v-show 常驻挂载、注册不随壳切换注销，
// 必须靠此上下文过滤，否则 Agent 空间快捷键会在 workbench 泄漏。
let agentSpaceActive = false
export function setAgentSpaceActive(active: boolean): void {
  agentSpaceActive = active
}

const SPECIAL_KEY_ALIASES: Record<string, string> = {
  'escape': 'escape', 'enter': 'enter', ' ': 'space',
  'delete': 'delete', 'backspace': 'backspace', 'tab': 'tab',
  'arrowup': 'up', 'arrowdown': 'down', 'arrowleft': 'left', 'arrowright': 'right',
}
const MODIFIER_NAMES = ['control', 'meta', 'alt', 'shift']

export function normalizeKeys(e: KeyboardEvent): string[] {
  const keys: string[] = []
  if (e.ctrlKey || e.metaKey) keys.push('ctrl')
  if (e.altKey) keys.push('alt')
  const main = e.key
  const lower = main.toLowerCase()
  if (!MODIFIER_NAMES.includes(lower)) {
    const isLetter = main.length === 1 && /[a-z]/i.test(main)
    // shift 归一化：非字母可打印字符（如 ? , = -）的 shift 信息已体现在 e.key 本身
    // （e.key 即按下 shift 后的结果），不再叠加 shift 修饰符——否则注册 ['?'] 与实际
    // ['shift','?'] 长度不等永不匹配（原 ? 帮助键失效的根因）。
    // 字母与特殊键保持叠加（Ctrl+Shift+Z 等组合依赖 shift 入列）。
    if (e.shiftKey && (main.length !== 1 || isLetter)) keys.push('shift')
    keys.push(SPECIAL_KEY_ALIASES[main] ?? SPECIAL_KEY_ALIASES[lower] ?? lower)
  }
  return keys.sort()
}

function keysMatch(pressed: string[], def: string[]): boolean {
  if (pressed.length !== def.length) return false
  const pa = [...pressed].sort()
  const da = [...def].sort()
  return pa.every((k, i) => k === da[i])
}

const SCOPE_ORDER: ShortcutScope[] = ['modal', 'editor', 'view', 'space', 'global']

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

// ── 连击序列状态（kind='sequence'，如 n c=新建角色）──
const SEQ_TIMEOUT = 500
const seqProgress = new Map<string, number>()
let seqLastTime = 0
/** 当前进行中的序列前缀（如 'n' 或 'n c'），供按键提示 UI 读取；空串表示无进行中序列 */
export const currentSequence = ref('')

function clearSequenceState() {
  seqProgress.clear()
  seqLastTime = 0
  currentSequence.value = ''
}

function advanceSequences(pressed: string[]): ShortcutDef | null {
  const now = Date.now()
  if (seqLastTime > 0 && now - seqLastTime > SEQ_TIMEOUT) seqProgress.clear()
  seqLastTime = now

  if (pressed[0] === 'escape' && pressed.length === 1) {
    clearSequenceState()
    return null
  }
  // 仅无修饰单键参与序列；修饰组合或特殊键打断进行中的序列
  if (pressed.length !== 1) {
    clearSequenceState()
    return null
  }
  const key = pressed[0]

  let completed: ShortcutDef | null = null
  for (const [, def] of registry) {
    if (def.kind !== 'sequence') continue
    // 序列上下文过滤：与 chord 分发同语义（view 需主视图上下文、space 需 Agent 空间激活），
    // 否则导图连击（view 层）在 Agent 空间也会推进并触发（N9 修复时漏了序列路径）
    if (def.scope === 'view' && activeViewId === null) continue
    if (def.scope === 'space' && !agentSpaceActive) continue
    const prev = seqProgress.get(def.id) ?? 0
    if (def.keys[prev] === key) {
      const next = prev + 1
      if (next >= def.keys.length) {
        completed = def
        seqProgress.delete(def.id)
      } else {
        seqProgress.set(def.id, next)
      }
    } else if (def.keys[0] === key) {
      seqProgress.set(def.id, 1)
    } else {
      seqProgress.delete(def.id)
    }
  }

  // 提示状态：显示进度最深序列的已按前缀（多序列共享首键时取其一展示）
  let best = 0
  for (const n of seqProgress.values()) {
    if (n > best) best = n
  }
  if (best === 0) {
    currentSequence.value = ''
  } else {
    for (const [id, n] of seqProgress) {
      if (n !== best) continue
      const def = registry.get(id)
      if (def) {
        currentSequence.value = def.keys.slice(0, n).join(' ')
        break
      }
    }
  }

  return completed
}

let cachedOverrides: Record<string, string[]> | null = null

// ── 弹窗激活深度 ──
// 未收编浮层（TuiModal/TuiDrawer/useFocusTrap/DialogContainer 等自挂监听的基座）
// show 时入栈、hide 时出栈。深度>0 时注册表跳过 modal 以外的 scope——弹窗优先：
// view/global 键在弹窗打开期间失效，Esc 等按键交由浮层自身监听处理。
let modalDepth = 0
export function setShortcutModalActive(active: boolean): void {
  modalDepth = Math.max(0, modalDepth + (active ? 1 : -1))
}
export function isShortcutModalActive(): boolean {
  return modalDepth > 0
}

// ── 收编弹窗栈（叠层顺序）──
// useModalShortcuts 收编的弹窗开/关时入栈/出栈。分发器在 modal 层只放行栈顶条目
// ——弹窗叠层时 Esc 只关最后打开的那个，不再双关/错关。
const modalStack: string[] = []
export function pushModalShortcut(id: string): void {
  if (!modalStack.includes(id)) modalStack.push(id)
}
export function popModalShortcut(id: string): void {
  const i = modalStack.indexOf(id)
  if (i >= 0) modalStack.splice(i, 1)
}
export function isTopModalShortcut(id: string): boolean {
  return modalStack.length === 0 || modalStack[modalStack.length - 1] === id
}

function loadOverrides(): Record<string, string[]> {
  if (cachedOverrides) return cachedOverrides
  try {
    const raw = localStorage.getItem('worldsea_shortcuts')
    cachedOverrides = raw ? JSON.parse(raw) : {}
  } catch {
    cachedOverrides = {}
  }
  return cachedOverrides ?? {}
}

function saveOverrides(overrides: Record<string, string[]>) {
  try {
    localStorage.setItem('worldsea_shortcuts', JSON.stringify(overrides))
  } catch {
    console.warn('[useShortcuts] 持久化快捷键覆盖失败')
  }
  cachedOverrides = overrides
}

function isValidKeys(keys: unknown): keys is string[] {
  return Array.isArray(keys) && keys.length > 0 && keys.every(k => typeof k === 'string' && k.length > 0)
}

let listenerAttached = false

function attachGlobalListener() {
  if (listenerAttached) return
  listenerAttached = true

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // IME 组合期（中文输入法选词/上屏）一律忽略，避免 Enter 确认候选词误触发快捷键
    if (e.isComposing || e.keyCode === 229) return

    const pressed = normalizeKeys(e)
    if (pressed.length === 0) return

    const tag = (e.target as HTMLElement)?.tagName
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable

    // 连击序列推进：仅非输入焦点时参与（序列均挂 view 层，与原 useKeySequence 语义一致）
    if (!isInput) {
      const seqDef = advanceSequences(pressed)
      if (seqDef) {
        if (seqDef.preventDefault) e.preventDefault()
        seqDef.handler()
        return
      }
    }

    for (const scope of SCOPE_ORDER) {
      // 弹窗打开期间（含未收编浮层）：modal 以外的 scope 全部失效
      if (modalDepth > 0 && scope !== 'modal') continue
      if (isInput && scope !== 'modal') continue
      // N9：无视图上下文（Agent 空间）→ view scope 快捷键全部失效
      if (scope === 'view' && activeViewId === null) continue
      // space scope：仅 Agent 空间壳激活时生效（两壳互斥，与 view 天然无同屏竞争）
      if (scope === 'space' && !agentSpaceActive) continue

      for (const [, def] of registry) {
        if (def.scope !== scope) continue
        if (def.kind === 'sequence') continue
        // 收编弹窗叠层：modal 层仅栈顶条目响应（Esc 只关最后打开的弹窗）
        if (scope === 'modal' && !isTopModalShortcut(def.id)) continue
        if (!keysMatch(pressed, def.keys)) continue

        if (def.preventDefault || isPreventDefault(pressed)) {
          e.preventDefault()
        }
        // 【消费策略（2026-09 批5）】view 层命令命中后阻断传播：document/window 级残留
        // 监听（未收编的组件局部监听，如 InfoPanel 的 Delete）不再重复执行同键行为。
        // modal/global 层暂不阻断——兼容存量浮层（TuiModal 等约 30 处）的 window Esc
        // 监听，其收编按规范渐进（新代码一律 useScopedShortcuts）。
        if (scope === 'view') {
          e.stopImmediatePropagation()
        }
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

  /**
   * 检测跨 scope 遮蔽：更高优先级 scope（modal>editor>view>global）中若已占用相同键位，
   * 新键位实际永远不会触发。仅警示不阻断——用户可能就是想「备而不用」。
   */
  function detectShadowing(id: string, keys: string[], scope: ShortcutScope): ShortcutDef[] {
    const orderIdx = SCOPE_ORDER.indexOf(scope)
    const shadowers: ShortcutDef[] = []
    for (const [, def] of registry) {
      if (def.id === id || def.kind === 'sequence') continue
      if (SCOPE_ORDER.indexOf(def.scope) >= orderIdx) continue
      if (sameKeys(keys, def.keys)) shadowers.push(def)
    }
    return shadowers
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

  function unregister(id: string) {
    registry.delete(id)
    seqProgress.delete(id)
  }

  function getDefaultKeys(id: string): string[] | null {
    return defaultKeysMap.get(id) ?? null
  }

  function getRegisteredKeys(id: string): string[] | null {
    const stored = registry.get(id)
    return stored ? stored.keys : null
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
   * 设置自定义快捷键（供 settings 面板使用）：
   * - modal 层不开放（交互惯例固定），直接拒绝
   * - 同 scope 键位冲突时阻断并返回冲突列表
   * - 跨 scope 遮蔽时放行但返回警示（更高优先级 scope 已占用该键）
   * 成功时写入 registry 并持久化到 localStorage。
   */
  function setShortcut(id: string, newKeys: string[]): { ok: boolean; conflict?: ShortcutConflict; shadowing?: ShortcutDef[] } {
    const def = registry.get(id)
    if (!def) return { ok: false }
    if (def.scope === 'modal') return { ok: false }
    const c = detectConflicts(id, newKeys, def.scope)
    if (c) {
      console.warn(`[useShortcuts] 设置 "${id}" 键位 ${JSON.stringify(newKeys)} 冲突`)
      return { ok: false, conflict: c }
    }
    const shadowing = detectShadowing(id, newKeys, def.scope)
    registry.set(id, { ...def, keys: newKeys })
    const overrides = loadOverrides()
    overrides[id] = newKeys
    saveOverrides(overrides)
    return { ok: true, shadowing: shadowing.length > 0 ? shadowing : undefined }
  }

  /** 恢复某快捷键为注册时声明的默认键位，并清除其持久化覆盖 */
  function resetShortcut(id: string) {
    const def = registry.get(id)
    const defaults = defaultKeysMap.get(id)
    if (def && defaults) {
      registry.set(id, { ...def, keys: defaults })
    }
    const overrides = loadOverrides()
    if (id in overrides) {
      delete overrides[id]
      saveOverrides(overrides)
    }
  }

  return {
    register, unregister, getAll, getByScope,
    getDefaultKeys, getRegisteredKeys,
    updateKeys, setShortcut, resetShortcut,
    detectConflicts, detectShadowing,
  }
}

/** 比较两个键位数组是否相等 */
function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((k, i) => k === sb[i])
}

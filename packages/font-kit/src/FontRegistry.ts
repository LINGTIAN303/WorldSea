export type FontEntryStatus = 'pending' | 'loading' | 'loaded' | 'error' | 'unloaded'

export interface FontSourceUrl {
  type: 'url'
  url: string
  format?: string
}

export interface FontSourceBuffer {
  type: 'buffer'
  buffer: ArrayBuffer
  format?: string
}

export type FontSource = FontSourceUrl | FontSourceBuffer

export interface FontEntry {
  id: string
  family: string
  weight: number
  style: string
  source: FontSource
  status: FontEntryStatus
  fontFace: FontFace | null
  error: string | null
}

export interface FontQuery {
  family?: string
  weight?: number
  style?: string
}

const _registry = new Map<string, FontEntry>()
const _listeners = new Set<() => void>()

function notify() {
  for (const fn of _listeners) fn()
}

export function register(entry: Omit<FontEntry, 'status' | 'fontFace' | 'error'>): FontEntry {
  if (_registry.has(entry.id)) {
    return _registry.get(entry.id)!
  }
  const full: FontEntry = {
    ...entry,
    status: 'pending',
    fontFace: null,
    error: null,
  }
  _registry.set(entry.id, full)
  notify()
  return full
}

export function unregister(id: string): boolean {
  const entry = _registry.get(id)
  if (!entry) return false
  if (entry.fontFace && typeof document !== 'undefined') {
    try {
      document.fonts.delete(entry.fontFace)
    } catch {}
    entry.fontFace = null
  }
  _registry.delete(id)
  notify()
  return true
}

export function get(id: string): FontEntry | undefined {
  return _registry.get(id)
}

export function list(): FontEntry[] {
  return Array.from(_registry.values())
}

export function findByFamily(family: string): FontEntry[] {
  return list().filter(e => e.family === family)
}

export function query(q: FontQuery): FontEntry[] {
  return list().filter(e => {
    if (q.family !== undefined && e.family !== q.family) return false
    if (q.weight !== undefined && e.weight !== q.weight) return false
    if (q.style !== undefined && e.style !== q.style) return false
    return true
  })
}

export function updateStatus(id: string, status: FontEntryStatus, error?: string): void {
  const entry = _registry.get(id)
  if (!entry) return
  entry.status = status
  entry.error = error ?? null
  notify()
}

export function setFontFace(id: string, fontFace: FontFace | null): void {
  const entry = _registry.get(id)
  if (!entry) return
  entry.fontFace = fontFace
  if (fontFace) entry.status = 'loaded'
  notify()
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function clear(): void {
  if (typeof document !== 'undefined') {
    for (const entry of _registry.values()) {
      if (entry.fontFace) {
        try { document.fonts.delete(entry.fontFace) } catch {}
      }
    }
  }
  _registry.clear()
  notify()
}

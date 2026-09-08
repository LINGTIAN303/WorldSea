import {
  type FontEntry,
  get as getEntry,
  updateStatus,
  setFontFace,
} from './FontRegistry'

const DB_NAME = 'worldsea-fonts'
const DB_VERSION = 1
const STORE_NAME = 'fonts'

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB not available'))
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      _db = req.result
      resolve(_db)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function persistToDB(id: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ id, buffer, timestamp: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadFromDB(id: string): Promise<ArrayBuffer | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => {
      const row = req.result
      resolve(row?.buffer ?? null)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function removeFromDB(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function listDBKeys(): Promise<string[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAllKeys()
    req.onsuccess = () => resolve(req.result as string[])
    req.onerror = () => reject(req.error)
  })
}

async function fetchBuffer(source: string): Promise<ArrayBuffer> {
  const resp = await fetch(source)
  if (!resp.ok) throw new Error(`Failed to fetch font: ${resp.status}`)
  return resp.arrayBuffer()
}

function createFontFace(
  family: string,
  buffer: ArrayBuffer,
  descriptors: FontFaceDescriptors,
): FontFace {
  return new FontFace(family, buffer, descriptors)
}

export async function loadFont(id: string): Promise<FontEntry> {
  const entry = getEntry(id)
  if (!entry) throw new Error(`Font not registered: ${id}`)
  if (entry.status === 'loaded') return entry
  if (typeof document === 'undefined') throw new Error('FontLoader requires a browser environment')

  updateStatus(id, 'loading')

  try {
    let buffer: ArrayBuffer

    if (entry.source.type === 'buffer') {
      buffer = entry.source.buffer
    } else {
      buffer = await fetchBuffer(entry.source.url)
    }

    const descriptors: FontFaceDescriptors = {
      weight: entry.weight as any,
      style: entry.style as any,
    }

    const fontFace = createFontFace(entry.family, buffer, descriptors)
    const loaded = await fontFace.load()

    document.fonts.add(loaded)
    setFontFace(id, loaded)

    if (entry.source.type === 'url') {
      await persistToDB(id, buffer).catch(() => {})
    }

    return getEntry(id)!
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateStatus(id, 'error', msg)
    throw err
  }
}

export async function loadFontFromDB(id: string): Promise<FontEntry | null> {
  const entry = getEntry(id)
  if (!entry) return null
  if (entry.status === 'loaded') return entry
  if (typeof document === 'undefined') return null

  const buffer = await loadFromDB(id)
  if (!buffer) return null

  updateStatus(id, 'loading')

  try {
    const descriptors: FontFaceDescriptors = {
      weight: entry.weight as any,
      style: entry.style as any,
    }

    const fontFace = createFontFace(entry.family, buffer, descriptors)
    const loaded = await fontFace.load()

    document.fonts.add(loaded)
    setFontFace(id, loaded)

    return getEntry(id)!
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateStatus(id, 'error', msg)
    return null
  }
}

export async function unloadFont(id: string): Promise<void> {
  const entry = getEntry(id)
  if (!entry) return

  if (entry.fontFace && typeof document !== 'undefined') {
    try { document.fonts.delete(entry.fontFace) } catch {}
  }

  updateStatus(id, 'unloaded')
  setFontFace(id, null)
}

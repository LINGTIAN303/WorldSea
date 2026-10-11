export interface SystemFontInfo {
  family: string
  path: string
  weight: number
  style: string
  format: string
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

let _invoke: InvokeFn | null = null
let _loadAttempted = false

async function getInvoke(): Promise<InvokeFn | null> {
  if (_loadAttempted) return _invoke
  _loadAttempted = true
  try {
    const mod = await import('@tauri-apps/api/core')
    _invoke = mod.invoke
    return _invoke
  } catch {
    _invoke = null
    return null
  }
}

export async function isTauriAvailable(): Promise<boolean> {
  const invoke = await getInvoke()
  return invoke !== null
}

export async function scanSystemFonts(): Promise<SystemFontInfo[]> {
  const invoke = await getInvoke()
  if (!invoke) return []
  try {
    return await invoke('cmd_font_scan_system') as SystemFontInfo[]
  } catch {
    return []
  }
}

export async function readFontFile(path: string): Promise<ArrayBuffer | null> {
  const invoke = await getInvoke()
  if (!invoke) return null
  try {
    const bytes = await invoke('cmd_font_read_file', { path }) as number[]
    const arr = new Uint8Array(bytes)
    return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength)
  } catch {
    return null
  }
}

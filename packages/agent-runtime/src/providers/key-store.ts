/**
 * API Key 加密存储模块
 *
 * 双后端策略：
 * - Tauri 桌面端：优先使用系统 Keyring，写入后回读验证；
 *   若 Keyring 不可靠（Windows Credential Manager 兼容性问题），自动降级到 localStorage 加密存储。
 * - Web / 降级：使用 Web Crypto API (AES-GCM) 加密后存入 localStorage。
 *   加密密钥派生自设备指纹（userAgent + hostname），因此密钥在不同设备/域名下无法解密。
 *
 * 存储格式:
 * - Tauri Keyring: service = "com.worldsmith.app:{provider}", username = "api_keys"
 * - Tauri 降级 / Web: localStorage key = "worldsmith_ak_{provider}", value = Base64(iv || ciphertext)
 *
 * 使用流程:
 *   storeApiKey('openai', 'sk-xxx') → Tauri: Keyring(验证) / 降级: AES-GCM → localStorage
 *   loadApiKey('openai') → Tauri: Keyring / 降级: localStorage → 解密 → 返回明文
 */

/** localStorage 键名前缀，用于区分 API Key 和其他存储数据 */
const STORAGE_PREFIX = 'worldsmith_ak_'

/** Keyring 是否可用（一次检测，全局缓存） */
let _keyringAvailable: boolean | null = null

/** 检测当前是否运行在 Tauri 桌面端 */
async function isTauri(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
      return true
    }
  } catch {}
  return false
}

/** 懒加载 Tauri invoke — 优先从全局 __TAURI__ 获取，降级到动态 import */
let _invoke: any = null
async function getTauriInvoke(): Promise<(cmd: string, args?: Record<string, unknown>) => Promise<any>> {
  if (!_invoke) {
    if (typeof window !== 'undefined' && (window as any).__TAURI__?.invoke) {
      _invoke = (window as any).__TAURI__.invoke
    } else {
      const mod = await import('@tauri-apps/api/core')
      _invoke = mod.invoke
    }
  }
  return _invoke
}

// ── Tauri Keyring 后端 ──

async function tauriStore(key: string, value: string): Promise<void> {
  const invoke = await getTauriInvoke()
  await invoke('cmd_secure_store', { key, value })
}

async function tauriLoad(key: string): Promise<string> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_secure_load', { key }) as Promise<string>
}

async function tauriDelete(key: string): Promise<void> {
  const invoke = await getTauriInvoke()
  await invoke('cmd_secure_delete', { key })
}

/**
 * 检测 Keyring 是否真正可用
 * 写入测试值 → 回读验证 → 删除测试值
 * 解决 Windows Credential Manager 下 set_password 不报错但数据未持久化的问题
 */
async function checkKeyringAvailable(): Promise<boolean> {
  if (_keyringAvailable !== null) return _keyringAvailable
  try {
    const testKey = '__worldsmith_keyring_test__'
    const testValue = 'test_' + Date.now()
    await tauriStore(testKey, testValue)
    const readBack = await tauriLoad(testKey)
    // 清理测试数据
    try { await tauriDelete(testKey) } catch { /* ignore */ }
    _keyringAvailable = readBack === testValue
    if (!_keyringAvailable) {
      console.warn('[key-store] Keyring 回读验证失败，降级到 localStorage 加密存储')
    } else {
      console.log('[key-store] Keyring 可用')
    }
  } catch (e) {
    console.warn('[key-store] Keyring 检测失败，降级到 localStorage 加密存储:', e)
    _keyringAvailable = false
  }
  return _keyringAvailable
}

// ── Web AES-GCM 后端 ──

/**
 * 派生加密密钥
 * 基于设备指纹（userAgent + hostname）通过 SHA-256 哈希生成 256 位 AES-GCM 密钥
 * 这确保了密钥在同一设备同域下可解密，更换设备/域名后无法解密
 */
async function getDeviceKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = encoder.encode(navigator.userAgent + location.hostname + 'worldsmith-key-v1')
  const hash = await crypto.subtle.digest('SHA-256', keyMaterial)
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/**
 * 使用 AES-GCM 加密文本
 * 每次加密使用随机 12 字节 IV，IV 拼接在密文前一同 Base64 编码
 * 返回格式: Base64(IV[12 bytes] || ciphertext)
 */
async function encrypt(text: string): Promise<string> {
  const key = await getDeviceKey()
  const encoder = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text))
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...combined))
}

/**
 * 解密 Base64 编码的密文
 * 从开头提取 12 字节 IV，剩余部分为密文，使用 AES-GCM 解密
 */
async function decrypt(encoded: string): Promise<string> {
  const key = await getDeviceKey()
  const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(decrypted)
}

// ── 公开 API ──

/**
 * 存储加密 API Key
 * @param provider 供应商名称，如 'openai'、'custom:api.example.com'
 * @param key 明文的 API Key
 */
export async function storeApiKey(provider: string, key: string): Promise<void> {
  const storeKey = STORAGE_PREFIX + provider
  if (await isTauri()) {
    const keyringOk = await checkKeyringAvailable()
    if (keyringOk) {
      try {
        await tauriStore(storeKey, key)
        return
      } catch (e) {
        console.warn('[key-store] Keyring 写入失败，降级到 localStorage:', e)
        _keyringAvailable = false
      }
    }
    // Keyring 不可用 → 降级到 localStorage 加密存储
  }
  if (!key) {
    await removeApiKey(provider)
    return
  }
  const encrypted = await encrypt(key)
  localStorage.setItem(storeKey, encrypted)
}

/**
 * 加载并解密 API Key
 * @param provider 供应商名称
 * @returns 解密的 API Key，未找到或解密失败返回空字符串
 */
export async function loadApiKey(provider: string): Promise<string> {
  const storeKey = STORAGE_PREFIX + provider
  if (await isTauri()) {
    const keyringOk = await checkKeyringAvailable()
    if (keyringOk) {
      try {
        const result = await tauriLoad(storeKey)
        if (result) return result
      } catch { /* keyring 读取失败 */ }
    }
    // Keyring 不可用或无值 → 从 localStorage 读取
    const raw = localStorage.getItem(storeKey)
    if (!raw) return ''
    try {
      const decrypted = await decrypt(raw)
      if (!decrypted) {
        await removeApiKey(provider)
        return ''
      }
      return decrypted
    } catch {
      await removeApiKey(provider)
      return ''
    }
  }
  const raw = localStorage.getItem(storeKey)
  if (!raw) return ''
  try {
    const decrypted = await decrypt(raw)
    if (!decrypted) {
      await removeApiKey(provider)
      return ''
    }
    return decrypted
  } catch {
    await removeApiKey(provider)
    return ''
  }
}

/** 删除指定供应商的 API Key */
export async function removeApiKey(provider: string): Promise<void> {
  const storeKey = STORAGE_PREFIX + provider
  if (await isTauri()) {
    try { await tauriDelete(storeKey) } catch { /* ignore */ }
  }
  localStorage.removeItem(storeKey)
}

/** 检查指定供应商是否已存储 API Key（仅检查是否存在，不解密） */
export async function hasApiKey(provider: string): Promise<string | null> {
  const storeKey = STORAGE_PREFIX + provider
  if (await isTauri()) {
    const keyringOk = await checkKeyringAvailable()
    if (keyringOk) {
      try {
        const result = await tauriLoad(storeKey)
        if (result) return result
      } catch { /* ignore */ }
    }
  }
  return localStorage.getItem(storeKey)
}

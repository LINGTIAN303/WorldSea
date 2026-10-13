import {
  loadFont,
  persistToDB,
  loadFromDB,
  removeFromDB,
  listDBKeys,
  unloadFont,
} from './FontLoader'
import {
  register,
} from './FontRegistry'
import {
  unpackWsFont,
  type WsFontManifest,
} from './WsFontPack'
import JSZip from 'jszip'

// ── 类型 ──

export interface FontVariantEntry {
  weight: number
  style: string
  format: string
  registryId: string
  size: number
}

export interface FontLibraryEntry {
  id: string
  family: string
  displayName: string
  source: 'preset' | 'wsfont' | 'raw' | 'windfonts' | 'system' | 'zip'
  variants: FontVariantEntry[]
  tags: string[]
  totalSize: number
  installedAt: number
  manifest?: WsFontManifest
  windfontsFamily?: string
  windfontsWeight?: string
  /** ZIP 分组 ID，同一 ZIP 导入的字体共享此 ID */
  groupId?: string
  /** ZIP 分组显示名，通常为 ZIP 文件名（不含扩展名） */
  groupName?: string
}

export const MAX_FONT_STORAGE = 400 * 1024 * 1024

// ── 辅助函数 ──

/**
 * 从字体二进制的 OS/2 表中解析 weight（usWeightClass），
 * 回退到从 head 表的 macStyle 推断。
 * 返回标准 CSS font-weight 值（100-900）。
 */
function parseFontWeightFromBuffer(buffer: ArrayBuffer): number {
  try {
    const view = new DataView(buffer)
    if (buffer.byteLength < 12) return 400

    const signature = view.getUint32(0)
    if (signature !== 0x00010000 && signature !== 0x4F54544F && signature !== 0x74746366) return 400

    const numTables = view.getUint16(4)

    for (let i = 0; i < numTables; i++) {
      const offset = 12 + i * 16
      if (offset + 16 > buffer.byteLength) break

      const tag =
        String.fromCharCode(view.getUint8(offset)) +
        String.fromCharCode(view.getUint8(offset + 1)) +
        String.fromCharCode(view.getUint8(offset + 2)) +
        String.fromCharCode(view.getUint8(offset + 3))

      if (tag === 'OS/2') {
        const tableOffset = view.getUint32(offset + 8)
        // usWeightClass 在 OS/2 表偏移 4 处（uint16）
        if (tableOffset + 6 <= buffer.byteLength) {
          const weight = view.getUint16(tableOffset + 4)
          if (weight >= 100 && weight <= 900) return weight
        }
      }
    }

    return 400
  } catch {
    return 400
  }
}

/**
 * 从字体二进制推断 font-style。
 * 检查 OS/2 表的 fsSelection 位 0（ITALIC）和位 9（OBLIQUE），
 * 以及 post 表的 italicAngle。
 */
function parseFontStyleFromBuffer(buffer: ArrayBuffer): string {
  try {
    const view = new DataView(buffer)
    if (buffer.byteLength < 12) return 'normal'

    const signature = view.getUint32(0)
    if (signature !== 0x00010000 && signature !== 0x4F54544F && signature !== 0x74746366) return 'normal'

    const numTables = view.getUint16(4)
    let os2Offset = -1
    let postOffset = -1

    for (let i = 0; i < numTables; i++) {
      const offset = 12 + i * 16
      if (offset + 16 > buffer.byteLength) break

      const tag =
        String.fromCharCode(view.getUint8(offset)) +
        String.fromCharCode(view.getUint8(offset + 1)) +
        String.fromCharCode(view.getUint8(offset + 2)) +
        String.fromCharCode(view.getUint8(offset + 3))

      if (tag === 'OS/2') os2Offset = view.getUint32(offset + 8)
      if (tag === 'post') postOffset = view.getUint32(offset + 8)
    }

    // 检查 OS/2 fsSelection
    if (os2Offset >= 0 && os2Offset + 64 <= buffer.byteLength) {
      const fsSelection = view.getUint16(os2Offset + 62)
      // 位0=ITALIC（斜体）、位9=OBLIQUE（倾斜）
      if (fsSelection & 0x0001) return 'italic'
      if (fsSelection & 0x0200) return 'oblique'
    }

    // 回退：检查 post 表的 italicAngle
    if (postOffset >= 0 && postOffset + 12 <= buffer.byteLength) {
      // italicAngle 是 Fixed（int16 + uint16），偏移 8
      const angleHi = view.getInt16(postOffset + 8)
      if (angleHi !== 0) return 'italic'
    }

    return 'normal'
  } catch {
    return 'normal'
  }
}

/**
 * 从字体二进制 name 表解析真实 family 名（nameID=1 优先，回退 nameID=4）。
 * FontFace.family 返回的是构造时传入值而非字体内部元数据，不能用于探测。
 */
function parseFontFamilyFromBuffer(buffer: ArrayBuffer): string | null {
  try {
    const view = new DataView(buffer)
    if (buffer.byteLength < 12) return null

    // 验证字体签名：TrueType (0x00010000), OpenType/CFF ('OTTO'), TrueType Collection ('ttcf')
    const signature = view.getUint32(0)
    if (signature !== 0x00010000 && signature !== 0x4F54544F && signature !== 0x74746366) {
      return null
    }

    const numTables = view.getUint16(4)

    // 遍历 offset table 查找 'name' 表
    for (let i = 0; i < numTables; i++) {
      const offset = 12 + i * 16
      if (offset + 16 > buffer.byteLength) break

      const tag =
        String.fromCharCode(view.getUint8(offset)) +
        String.fromCharCode(view.getUint8(offset + 1)) +
        String.fromCharCode(view.getUint8(offset + 2)) +
        String.fromCharCode(view.getUint8(offset + 3))

      if (tag !== 'name') continue

      const tableOffset = view.getUint32(offset + 8)
      if (tableOffset + 6 > buffer.byteLength) return null

      const nameCount = view.getUint16(tableOffset + 2)
      const stringOffset = view.getUint16(tableOffset + 4)

      // 优先级：nameID=1 (Family Name) > nameID=4 (Full Name)
      let bestName: string | null = null
      let bestPriority = 999

      for (let j = 0; j < nameCount; j++) {
        const recOffset = tableOffset + 6 + j * 12
        if (recOffset + 12 > buffer.byteLength) break

        const platformID = view.getUint16(recOffset)
        const encodingID = view.getUint16(recOffset + 2)
        const nameID = view.getUint16(recOffset + 6)
        const length = view.getUint16(recOffset + 8)
        const strOffset = view.getUint16(recOffset + 10)

        // 只关心 nameID 1 和 4
        let priority: number
        if (nameID === 1) priority = 1
        else if (nameID === 4 && bestPriority > 2) priority = 2
        else continue

        if (priority >= bestPriority) continue

        const absStrOffset = tableOffset + stringOffset + strOffset
        if (absStrOffset + length > buffer.byteLength) continue

        // 优先使用 Windows 平台 (3) + Unicode BMP (1)，或 Macintosh (1)
        const isUnicode = (platformID === 3 && encodingID === 1) || platformID === 0
        const isMacRoman = platformID === 1 && encodingID === 0

        if (!isUnicode && !isMacRoman) continue

        let name: string
        if (isUnicode) {
          // UTF-16BE
          const bytes = new Uint8Array(buffer, absStrOffset, length)
          name = new TextDecoder('utf-16be').decode(bytes)
        } else {
          // Mac Roman
          const bytes = new Uint8Array(buffer, absStrOffset, length)
          name = new TextDecoder('macintosh').decode(bytes)
        }

        if (name.trim()) {
          bestName = name.trim()
          bestPriority = priority
        }
      }

      return bestName
    }

    return null
  } catch {
    return null
  }
}

/**
 * 解析字体二进制获取真实的 family 名。
 * 先尝试从 name 表解析，失败时回退到 FontFace 探测（用真实 family 名构造）。
 */
export async function resolveFontFamily(
  buffer: ArrayBuffer,
  fallbackName?: string,
): Promise<string> {
  // 1. 优先从二进制 name 表解析
  const parsed = parseFontFamilyFromBuffer(buffer)
  if (parsed) return parsed

  // 2. 回退：用 fallbackName 作为 family 名构造 FontFace 验证字体是否可加载
  try {
    const probeFamily = fallbackName || 'Unknown'
    const face = new FontFace(probeFamily, buffer)
    await face.load()
    // 字体可加载，使用 fallbackName
    return probeFamily
  } catch {
    return fallbackName || 'Unknown'
  }
}

export interface CssFontFaceInfo {
  url: string
  weight: number
  style: string
}

/**
 * 从 CSS 文本解析全部 @font-face 的 URL、weight 与 style
 * （输入通常来自 windfonts API）。
 */
export function extractFontUrlsFromCss(cssText: string): CssFontFaceInfo[] {
  const results: CssFontFaceInfo[] = []
  const faceRegex = /@font-face\s*\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = faceRegex.exec(cssText)) !== null) {
    const block = match[1]
    const urlMatch = block.match(/src\s*:[^;]*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/)
    const weightMatch = block.match(/font-weight\s*:\s*(\d+)/)
    const styleMatch = block.match(/font-style\s*:\s*(\w+)/)
    if (urlMatch) {
      results.push({
        url: urlMatch[1],
        weight: weightMatch ? parseInt(weightMatch[1]) : 400,
        style: styleMatch ? styleMatch[1] : 'normal',
      })
    }
  }
  return results
}

export async function installFromWsfont(
  buffer: ArrayBuffer,
): Promise<{ entry: FontLibraryEntry; manifest: WsFontManifest }> {
  const { manifest, files } = await unpackWsFont(buffer)

  const variants: FontVariantEntry[] = []
  let totalSize = 0

  for (const v of manifest.variants) {
    const data = files.get(v.file)
    if (!data) continue

    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer

    const registryId = `${manifest.id}-${v.weight}-${v.style}`
    const format = v.format || 'truetype'

    register({
      id: registryId,
      family: manifest.family,
      weight: v.weight,
      style: v.style,
      source: { type: 'buffer', buffer: arrayBuffer, format },
    })

    await loadFont(registryId)
    await persistToDB(registryId, arrayBuffer)

    const size = arrayBuffer.byteLength
    totalSize += size

    variants.push({
      weight: v.weight,
      style: v.style,
      format,
      registryId,
      size,
    })
  }

  const entry: FontLibraryEntry = {
    id: manifest.id,
    family: manifest.family,
    displayName: manifest.displayName || manifest.family,
    source: 'wsfont',
    variants,
    tags: manifest.tags || [],
    totalSize,
    installedAt: Date.now(),
    manifest,
  }

  return { entry, manifest }
}

const EXT_FORMAT_MAP: Record<string, string> = {
  ttf: 'truetype',
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
}

export async function installFromRawFont(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<{ entry: FontLibraryEntry }> {
  const ext = fileName.split('.').pop()?.toLowerCase() || 'ttf'
  const format = EXT_FORMAT_MAP[ext] || 'truetype'

  const displayName = fileName.replace(/\.[^.]+$/, '')
  const family = await resolveFontFamily(buffer, displayName)
  const weight = parseFontWeightFromBuffer(buffer)
  const style = parseFontStyleFromBuffer(buffer)

  const id = `user-${displayName}`
  const registryId = `${id}-${weight}-${style}`

  register({
    id: registryId,
    family,
    weight,
    style,
    source: { type: 'buffer', buffer, format },
  })

  await loadFont(registryId)
  await persistToDB(registryId, buffer)

  const entry: FontLibraryEntry = {
    id,
    family,
    displayName,
    source: 'raw',
    variants: [
      {
        weight,
        style,
        format,
        registryId,
        size: buffer.byteLength,
      },
    ],
    tags: [],
    totalSize: buffer.byteLength,
    installedAt: Date.now(),
  }

  return { entry }
}

export async function installFromWindfonts(
  family: string,
  weight: string,
): Promise<{ entry: FontLibraryEntry }> {
  const cssUrl =
    `https://app.windfonts.com/api/css?family=${encodeURIComponent(family)}&weight=${encodeURIComponent(weight)}&version=zh-common`

  const cssResp = await fetch(cssUrl)
  const cssText = await cssResp.text()

  const fontFaces = extractFontUrlsFromCss(cssText)
  if (fontFaces.length === 0) {
    throw new Error(`No font URLs found in windfonts CSS for "${family}"`)
  }

  const variants: FontVariantEntry[] = []
  let totalSize = 0
  let resolvedFamily = family

  for (let i = 0; i < fontFaces.length; i++) {
    const { url, weight: weightNum, style } = fontFaces[i]
    const resp = await fetch(url)
    const buffer = await resp.arrayBuffer()

    if (i === 0) {
      resolvedFamily = await resolveFontFamily(buffer, family)
    }

    const urlExt = url.split('.').pop()?.toLowerCase() || 'woff2'
    const format = EXT_FORMAT_MAP[urlExt] || 'woff2'

    const entryId = `wf-${family}`
    const registryId = `${entryId}-${weightNum}-${style}`

    register({
      id: registryId,
      family: resolvedFamily,
      weight: weightNum,
      style,
      source: { type: 'buffer', buffer, format },
    })

    await loadFont(registryId)
    await persistToDB(registryId, buffer)

    const size = buffer.byteLength
    totalSize += size

    variants.push({
      weight: weightNum,
      style,
      format,
      registryId,
      size,
    })
  }

  const entryId = `wf-${family}`
  const entry: FontLibraryEntry = {
    id: entryId,
    family: resolvedFamily,
    displayName: family,
    source: 'windfonts',
    variants,
    tags: [],
    totalSize,
    installedAt: Date.now(),
    windfontsFamily: family,
    windfontsWeight: weight,
  }

  return { entry }
}

export async function restoreFromDB(entry: FontLibraryEntry): Promise<boolean> {
  const cachedKeys = new Set(await listDBKeys())
  let restored = false

  // 如果 entry.family 是旧版 resolveFontFamily 的探测占位符，需要重新解析
  const needsFamilyFix = entry.family === '___probe___'

  for (const variant of entry.variants) {
    if (!cachedKeys.has(variant.registryId)) continue

    try {
      const buffer = await loadFromDB(variant.registryId)
      if (!buffer) continue

      // 修复旧数据：从 buffer 重新解析真实 family 名
      let family = entry.family
      if (needsFamilyFix) {
        const parsed = parseFontFamilyFromBuffer(buffer)
        if (parsed) {
          family = parsed
          entry.family = parsed
        }
      }

      register({
        id: variant.registryId,
        family,
        weight: variant.weight,
        style: variant.style,
        source: { type: 'buffer', buffer, format: variant.format },
      })

      await loadFont(variant.registryId)
      restored = true
    } catch {
      // 跳过恢复失败的变体
    }
  }

  return restored
}

export async function removeFontData(entry: FontLibraryEntry): Promise<void> {
  for (const variant of entry.variants) {
    try {
      unloadFont(variant.registryId)
    } catch {
      // 字体可能未加载，忽略
    }

    try {
      await removeFromDB(variant.registryId)
    } catch {
      // 条目可能不在 DB 中，忽略
    }
  }
}

const FONT_EXTENSIONS = new Set(['ttf', 'otf', 'woff', 'woff2'])

/**
 * 从包含多个字体文件的 ZIP 包中批量安装字体。
 * ZIP 内每个字体文件独立解析 family 名并注册，所有条目共享同一个 groupId/groupName。
 */
export async function installFromZip(
  buffer: ArrayBuffer,
  zipFileName: string,
): Promise<{ entries: FontLibraryEntry[] }> {
  const zip = await JSZip.loadAsync(buffer)

  // 收集所有字体文件
  const fontFiles: { path: string; data: Uint8Array; ext: string }[] = []
  const loadPromises: Promise<void>[] = []

  zip.forEach((relativePath, file) => {
    if (file.dir) return
    const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
    if (!FONT_EXTENSIONS.has(ext)) return
    // 跳过 macOS 的 __MACOSX 目录和隐藏文件
    if (relativePath.startsWith('__MACOSX') || relativePath.includes('/._')) return

    loadPromises.push(
      file.async('uint8array').then(data => {
        fontFiles.push({ path: relativePath, data, ext })
      }),
    )
  })

  await Promise.all(loadPromises)

  if (fontFiles.length === 0) {
    throw new Error('ZIP 中未找到字体文件（支持 .ttf/.otf/.woff/.woff2）')
  }

  const groupName = zipFileName.replace(/\.zip$/i, '')
  const groupId = `zip-${groupName}-${Date.now()}`

  // 先解析所有字体文件，收集 family/weight/style 信息
  type ParsedFont = {
    family: string
    weight: number
    style: string
    format: string
    displayName: string
    arrayBuffer: ArrayBuffer
    registryId: string
  }

  const parsed: ParsedFont[] = []

  for (const ff of fontFiles) {
    const arrayBuffer = ff.data.buffer.slice(
      ff.data.byteOffset,
      ff.data.byteOffset + ff.data.byteLength,
    ) as ArrayBuffer

    const format = EXT_FORMAT_MAP[ff.ext] || 'truetype'
    const fileName = ff.path.split('/').pop() || ff.path
    const displayName = fileName.replace(/\.[^.]+$/, '')
    const family = await resolveFontFamily(arrayBuffer, displayName)
    const weight = parseFontWeightFromBuffer(arrayBuffer)
    const style = parseFontStyleFromBuffer(arrayBuffer)
    const id = `zip-${displayName}`
    const registryId = `${id}-${weight}-${style}`

    register({
      id: registryId,
      family,
      weight,
      style,
      source: { type: 'buffer', buffer: arrayBuffer, format },
    })

    await loadFont(registryId)
    await persistToDB(registryId, arrayBuffer)

    parsed.push({ family, weight, style, format, displayName, arrayBuffer, registryId })
  }

  // 按 family 分组合并变体
  const familyMap = new Map<string, ParsedFont[]>()
  for (const p of parsed) {
    let list = familyMap.get(p.family)
    if (!list) {
      list = []
      familyMap.set(p.family, list)
    }
    list.push(p)
  }

  const entries: FontLibraryEntry[] = []
  for (const [family, fonts] of familyMap) {
    const variants: FontVariantEntry[] = fonts.map(p => ({
      weight: p.weight,
      style: p.style,
      format: p.format,
      registryId: p.registryId,
      size: p.arrayBuffer.byteLength,
    }))
    const totalSize = variants.reduce((s, v) => s + v.size, 0)
    // 用第一个字体的 displayName 作为 entry 的 displayName
    const displayName = fonts[0].displayName
    const id = `zip-${displayName}`

    entries.push({
      id,
      family,
      displayName,
      source: 'zip',
      variants,
      tags: [],
      totalSize,
      installedAt: Date.now(),
      groupId,
      groupName,
    })
  }

  return { entries }
}

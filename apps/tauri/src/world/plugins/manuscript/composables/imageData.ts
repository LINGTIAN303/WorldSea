/**
 * imageData —— docx 导出的图片数据处理：data URL 解析 + 无需解码全图的尺寸读取
 *
 * 为什么自己读图片头而不让浏览器量尺寸：导出链路（htmlToDocxBlocks → blocksToDocx）
 * 是纯数据变换，`new Image()` 量 naturalWidth 需要异步加载且 jsdom 不渲染 ——
 * 而PNG/GIF/BMP/JPEG 的宽高都在**固定偏移或可扫描的短头部**里，几十行同步代码即可。
 * docx 的 ImageRun 必须显式给 `transformation: { width, height }`，拿不到真实尺寸
 * 就只能瞎猜比例 —— 读头是消除「导出图片变形」的最小代价。
 *
 * 支持矩阵（与 docx 9.7.1 的 RegularImageOptions 对齐：jpg/png/gif/bmp）：
 * - webp / svg：Word 不兼容（svg 需 fallback 双图）→ 由映射层给占位段落，不进此模块
 */

export interface ParsedImageDataUrl {
  mime: string
  base64: string
}

/** 解析 `data:image/png;base64,....`；非 data URL（http 等）返回 null */
export function parseDataUrl(src: string): ParsedImageDataUrl | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(src)
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null
}

/** base64 → 字节（浏览器 atob；jsdom 同样可用） */
export function decodeBase64(base64: string): Uint8Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** data URL 的 mime → docx RegularImageOptions 的 type；不支持返回 null */
export function mimeToDocxType(mime: string): 'png' | 'jpg' | 'gif' | 'bmp' | null {
  switch (mime) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/bmp': return 'bmp'
    default: return null
  }
}

export interface ImageDims {
  width: number
  height: number
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/** PNG：签名 8 字节 + IHDR 长度 4 + 'IHDR' 4 + 宽高各 4（大端） */
function pngDims(b: Uint8Array): ImageDims | null {
  const be32 = (o: number) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]
  return { width: be32(16), height: be32(20) }
}

/** GIF：'GIF8?a' + 宽高各 2（小端） */
function gifDims(b: Uint8Array): ImageDims | null {
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }
}

/** BMP：'BM' + DIB 头偏移 18/22 宽高各 4（小端；高可为负 = top-down 行序，取绝对值） */
function bmpDims(b: Uint8Array): ImageDims | null {
  const le32 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
  return { width: le32(18), height: Math.abs(le32(22)) }
}

/**
 * JPEG：从 SOI 后扫 marker 段。每个段 = FF + marker + 2 字节段长（含自身）；
 * SOF 段里：段长 2 + 精度 1 + 高 2（大端）+ 宽 2。SOF 在 APP/注释等段之后，
 * 必须逐段跳过直到命中。
 */
function jpegDims(b: Uint8Array): ImageDims | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker === 0xff || marker === 0x00) { i++; continue }
    if (JPEG_SOF_MARKERS.has(marker)) {
      return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] }
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len <= 0) return null
    i += 2 + len
  }
  return null
}

/**
 * 从图片字节读固有尺寸（宽高单位 = 像素）。识别失败 / 格式不符返回 null，
 * 由调用方决定 fallback（当前为 480×320 默认并在注释中说明局限）。
 */
export function readImageSize(bytes: Uint8Array, mime: string): ImageDims | null {
  if (bytes.length < 24) return null
  try {
    if (mime === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50) return pngDims(bytes)
    if (mime === 'image/gif' && bytes[0] === 0x47 && bytes[1] === 0x49) return gifDims(bytes)
    if (mime === 'image/bmp' && bytes[0] === 0x42 && bytes[1] === 0x4d) return bmpDims(bytes)
    if (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDims(bytes)
  } catch {
    return null
  }
  return null
}

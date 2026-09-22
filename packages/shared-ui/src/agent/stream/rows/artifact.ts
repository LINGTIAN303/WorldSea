/**
 * 大结果 artifact 解析（UX-c）
 *
 * 两类引用来源（C2 · T-d 与 A1 己1①，同一存储 `raw/<hash>`）：
 * 1. **artifact 信封**：工具结果超阈值（默认 32 KiB）→ 结果本体被替换为
 *    `{artifact: 'raw/<hash>', bytes, note, preview}`（上下文只留摘要与引用）；
 * 2. **截断标注**：`raw_context` 增量外置在截断文本里追加
 *    `原文已外置：raw/<hash>`（与 Rust `EXTERNALIZED_MARKER` 同串）。
 *
 * 本模块只做**解析**（纯函数，可单测）；取回原文由壳侧经 `memory_read_raw` 完成
 * （shared-ui 不依赖 IPC）。
 */

/** 坐标格式：sha256 前 16 位十六进制（与 Rust `raw_context` / `raw_store` 同口径） */
const HASH_RE = /^[0-9a-f]{16}$/

/** artifact 信封（工具结果被外置后的形态） */
export interface ArtifactEnvelope {
  /** 内容坐标（16 位十六进制，不含 `raw/` 前缀） */
  hash: string
  /** 原文字节数 */
  bytes: number
  /** 说明文本（Rust 侧生成；含「原文已外置」标注） */
  note: string
  /** 摘要预览（前 400 字符） */
  preview: string
}

/**
 * 解析 artifact 信封；非信封（普通结果 / 坏 JSON / 坐标格式不符）→ `null`。
 */
export function parseArtifactEnvelope(raw?: string): ArtifactEnvelope | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const v = parsed as Record<string, unknown>
  if (typeof v.artifact !== 'string') return null
  const m = /^raw\/([0-9a-f]{16})$/.exec(v.artifact)
  if (!m) return null
  return {
    hash: m[1],
    bytes: typeof v.bytes === 'number' && Number.isFinite(v.bytes) ? v.bytes : 0,
    note: typeof v.note === 'string' ? v.note : '',
    preview: typeof v.preview === 'string' ? v.preview : '',
  }
}

/**
 * 从文本中提取全部「原文已外置」坐标（截断标注；去重保序）。
 *
 * 与 Rust `raw_context::EXTERNALIZED_MARKER`（`原文已外置：raw/`）逐字对齐。
 */
export function extractExternalizedHashes(text?: string): string[] {
  if (!text) return []
  const out: string[] = []
  const re = /原文已外置：raw\/([0-9a-f]{16})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** 坐标合法性（取回前的本地守卫；Rust 侧另有防路径穿越校验） */
export function isValidArtifactHash(hash: string): boolean {
  return HASH_RE.test(hash)
}

/**
 * forms/titleNumbering —— 标题式的「编号 / 缩进 / 标题层级」纯函数
 *
 * 拆出来是为了可单测：标题式的全部呈现规则（除文本本身）都在这三个函数里，
 * 组件只负责把结果贴到 DOM 上。规格见
 * docs/plans/2026-09-16-大纲白板-表现形式规格.md §一。
 */

export type NumberingStyle = 'none' | 'numeric' | 'chinese' | 'roman'

/** 缩进层级上限：超过后不再累加（避免窄容器里文本被挤出） */
export const MAX_INDENT_DEPTH = 6
/** 每层缩进像素 */
export const INDENT_STEP = 16
/** 导出时标题层级上限（markdown / docx 都是 H1–H6） */
export const MAX_HEADING_LEVEL = 6

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 1–99 的中文数字（大纲编号够用；超出走阿拉伯数字兜底） */
export function toChineseNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return String(n)
  if (n < 10) return CHINESE_DIGITS[n]
  if (n === 10) return '十'
  if (n < 20) return `十${CHINESE_DIGITS[n - 10]}`
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return `${CHINESE_DIGITS[tens]}十${ones ? CHINESE_DIGITS[ones] : ''}`
  }
  return String(n)
}

const ROMAN_TABLE: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

export function toRomanNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 3999) return String(n)
  let rest = Math.floor(n)
  let out = ''
  for (const [value, symbol] of ROMAN_TABLE) {
    while (rest >= value) {
      out += symbol
      rest -= value
    }
  }
  return out
}

/**
 * 层级编号链 → 显示文本。
 * - numeric：`1.2.3`
 * - chinese：逐层换样式（一层「一、」二层「（一）」三层「1.」四层起「(1)」）
 * - roman：首层罗马数字，其后阿拉伯数字点分（如 `II.3`）
 * - none：空串
 */
export function formatNumbering(chain: number[], style: NumberingStyle): string {
  if (!chain.length) return ''
  switch (style) {
    case 'none':
      return ''
    case 'numeric':
      return chain.join('.')
    case 'roman': {
      const [head, ...tail] = chain
      const headText = toRomanNumber(head)
      return tail.length ? `${headText}.${tail.join('.')}` : headText
    }
    case 'chinese':
    default: {
      return chain.map((n, idx) => {
        if (idx === 0) return `${toChineseNumber(n)}、`
        if (idx === 1) return `（${toChineseNumber(n)}）`
        if (idx === 2) return `${n}.`
        return `(${n})`
      }).join('')
    }
  }
}

/** 层级深度 → 缩进像素（超过 MAX_INDENT_DEPTH 后不再累加） */
export function indentForDepth(depth: number, step: number = INDENT_STEP): number {
  const d = Math.max(0, Math.min(MAX_INDENT_DEPTH, Math.floor(depth || 0)))
  return d * step
}

/** 层级深度 → 导出标题层级（H1–H6，超出夹到 6；与缩进上限同源避免"看着是 7 层、导出却还是 6" 的不一致） */
export function depthToHeadingLevel(depth: number): number {
  const d = Math.max(0, Math.floor(depth || 0))
  return Math.min(MAX_HEADING_LEVEL, d + 1)
}

/** 缩进停止后（超限层）是否应降级为列表项而非标题（导出规则的一致化） */
export function shouldDegradeToListItem(depth: number): boolean {
  return Math.floor(depth || 0) >= MAX_INDENT_DEPTH
}

/** 编号 + 标题合成一行文本（供列表/导出复用） */
export function composeTitleLine(
  name: string,
  numbering: number[],
  style: NumberingStyle,
): string {
  const prefix = formatNumbering(numbering, style)
  const text = (name || '').trim() || '未命名节点'
  return prefix ? `${prefix} ${text}` : text
}

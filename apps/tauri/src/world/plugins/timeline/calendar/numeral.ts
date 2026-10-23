/** 中文数字 ↔ 阿拉伯数字（历法解析/格式化共用） */

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

const CHINESE_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

/** 解析中文/阿拉伯数字；无法解析返回 null */
export function parseNumber(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (/^-?\d+$/.test(text)) return parseInt(text, 10)
  const negative = text.startsWith('负')
  const body = negative ? text.slice(1) : text
  if (!body) return null

  let result = 0
  let current = 0
  for (const ch of body) {
    const digit = CHINESE_DIGITS[ch]
    if (digit !== undefined) {
      current = digit
      continue
    }
    const unit = CHINESE_UNITS[ch]
    if (unit === undefined) return null
    if (unit === 10000) {
      result = (result + (current || 1)) * unit
      current = 0
    } else {
      result += (current || 1) * unit
      current = 0
    }
  }
  const value = result + current
  return negative ? -value : value
}

/** 阿拉伯数字 → 中文数字（0..9999；超出范围回退阿拉伯） */
export function formatChineseNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 9999) return String(value)
  if (value === 0) return '零'
  const digits = '零一二三四五六七八九'
  const units = ['', '十', '百', '千']
  const text = String(value).padStart(4, '0')
  let out = ''
  let zeroPending = false
  for (let i = 0; i < 4; i++) {
    const digit = Number(text[i])
    const unitIndex = 3 - i
    if (digit === 0) {
      zeroPending = out.length > 0
      continue
    }
    if (zeroPending) {
      out += '零'
      zeroPending = false
    }
    out += digits[digit] + units[unitIndex]
  }
  // 10~19 习惯写「十」而不是「一十」
  if (out.startsWith('一十')) out = out.slice(1)
  return out
}

/** 按单位声明的数字样式格式化 */
export function formatNumber(value: number, numeral: 'arabic' | 'chinese' = 'arabic'): string {
  return numeral === 'chinese' ? formatChineseNumber(value) : String(value)
}

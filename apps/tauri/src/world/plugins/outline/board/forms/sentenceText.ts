/**
 * sentenceText —— 句子式的文本处理（纯函数，可单测）
 *
 * 规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §二
 * 设计约束：**纯文本**（不解析 markdown/HTML）；行钳制而非滚动；字数软上限只提示不截断。
 * 之所以抽成纯函数：这些规则都是「输入文本 → 输出文本/数字」的判定，组件只做绑定与渲染，
 * 便于在 jsdom 之外按规则逐条验证（项目测试策略：几何/文本规则尽量纯函数化）。
 */

/** 中文引号装饰对（规格 §2.2-④ `showQuoteMark`） */
const QUOTE_OPEN = '「'
const QUOTE_CLOSE = '」'

/** 把配置里的 maxLines 归一化到 1–10（规格：默认 3） */
export function normalizeMaxLines(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 3
  return Math.min(10, Math.max(1, Math.round(n)))
}

/** 把配置里的 charLimit 归一化到正数（非有限或 <=0 回退默认 120） */
export function normalizeCharLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 120
  return Math.round(n)
}

/**
 * 按换行切行并钳制到 maxLines 行。
 * 返回 `clamped` 表示是否被截断（用于「悬停提示全文」与省略提示）。
 * 注意保留空行（空行属于用户输入的版式意图）。
 */
export function clampLines(
  text: string,
  maxLines: number,
): { lines: string[]; clamped: boolean } {
  const limit = normalizeMaxLines(maxLines)
  const all = String(text ?? '').split(/\r?\n/)
  return { lines: all.slice(0, limit), clamped: all.length > limit }
}

/**
 * 统计字数：按 Unicode 码点计数（中文一字一码点，代理对算一个），忽略首尾空白。
 * 供软上限提示用——**不参与截断**。
 */
export function countChars(text: string): number {
  return Array.from(String(text ?? '').trim()).length
}

/** 是否超出软上限（软上限只用于提示，不参与截断） */
export function exceedsLimit(text: string, limit: number): boolean {
  return countChars(text) > normalizeCharLimit(limit)
}

/** 引号装饰：开启且有内容时包一层中文引号；空文本不加（避免出现空引号对） */
export function withQuoteMark(text: string, enabled: boolean): string {
  const body = String(text ?? '')
  if (!enabled || !body.trim()) return body
  return `${QUOTE_OPEN}${body}${QUOTE_CLOSE}`
}

/** 展示用文本：钳制后的多行文本 + 引号装饰（组件渲染的唯一入口，保证规则集中） */
export function toDisplayText(
  text: string,
  opts: { maxLines: number; quoteMark?: boolean },
): { text: string; clamped: boolean; empty: boolean } {
  const raw = String(text ?? '')
  const { lines, clamped } = clampLines(raw, opts.maxLines)
  const joined = lines.join('\n')
  return {
    text: withQuoteMark(joined, opts.quoteMark === true),
    clamped,
    empty: !raw.trim(),
  }
}

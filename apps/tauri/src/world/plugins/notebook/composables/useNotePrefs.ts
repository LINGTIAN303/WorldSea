import { ref, watch, type Ref } from 'vue'

/**
 * 笔记本芽排版偏好（批2 平移自正文写作的芽域偏好机制）：localStorage 持久化的芽域 KV，
 * 模块级 ref = 进程内单例。键域 worldsea_nb_* 独立于 manuscript 的 worldsea_ms_*——
 * 两芽默认值不同（notebook 14px/1.75 vs manuscript 1.8），共用键会互相污染默认呈现。
 * 只做三键：字号/行距（prose.css 的 .ws-nb-prose 呈现）+ 引号风格（一键排版用）；
 * 页宽（prose.css 已有 860px 阅读宽度约束）与专注类开关不设。
 */

// ── 轻量持久化（localStorage 读写容错；与 useWritingPrefs 同口径的芽域本地版）──
function persisted<T extends string | number | boolean>(key: string, fallback: T): Ref<T> {
  let initial = fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      if (typeof fallback === 'boolean') initial = (raw === 'true') as T
      else if (typeof fallback === 'number') initial = (Number.isFinite(Number(raw)) ? Number(raw) : fallback) as T
      else initial = raw as T
    }
  } catch {
    // localStorage 不可用（隐私模式等）退化为内存态
  }
  const val = ref(initial) as Ref<T>
  watch(val, v => {
    try {
      localStorage.setItem(key, String(v))
    } catch {
      // 写失败静默：仅丢偏好，不影响功能
    }
  })
  return val
}

const KEY_FONT_SIZE = 'worldsea_nb_font_size'
const KEY_LINE_HEIGHT = 'worldsea_nb_line_height'
const KEY_QUOTE_STYLE = 'worldsea_nb_quote_style'

/** 正文字号 px（13~20） */
export const nbFontSize = persisted<number>(KEY_FONT_SIZE, 14)
/** 正文行距 */
export const nbLineHeight = persisted<number>(KEY_LINE_HEIGHT, 1.75)
/** 引号风格（一键排版用）：off=不统一 / curly=“弯引号” / corner=「直角引号」 */
export const nbQuoteStyle = persisted<'off' | 'curly' | 'corner'>(KEY_QUOTE_STYLE, 'off')

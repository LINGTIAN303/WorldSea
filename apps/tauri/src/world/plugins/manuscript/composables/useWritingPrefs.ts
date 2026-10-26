import { ref, watch, type Ref } from 'vue'

/**
 * 正文芽写作偏好（批1）：localStorage 持久化的芽域 KV。
 * 不进 entity-core settingsStore——该文件已冻结 arch 基线（只禁增长），芽域偏好就地自治，
 * 键名沿用 worldsea_ms_* 命名空间。模块级 ref = 进程内单例，全部消费者共享同一份。
 *
 * 默认值即既有呈现（零行为变化锚点）：字号 14px（原 --font-size-md 未定义继承 --fs-base）、
 * 行距 1.8、页宽全宽、缩进关、引号不统一、专注/打字机/淡出全关。
 */

// ── 轻量持久化（localStorage 读写容错；与 settingsStore.persistedRef 同口径的芽域本地版）──
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

const KEY_FONT_SIZE = 'worldsea_ms_font_size'
const KEY_LINE_HEIGHT = 'worldsea_ms_line_height'
const KEY_PAGE_WIDTH = 'worldsea_ms_page_width'
const KEY_INDENT = 'worldsea_ms_indent'
const KEY_QUOTE_STYLE = 'worldsea_ms_quote_style'
const KEY_FOCUS = 'worldsea_ms_focus'
const KEY_TYPEWRITER = 'worldsea_ms_typewriter'
const KEY_PARA_DIM = 'worldsea_ms_para_dim'

/** 正文字号 px（13~20） */
export const msFontSize = persisted<number>(KEY_FONT_SIZE, 14)
/** 正文行距 */
export const msLineHeight = persisted<number>(KEY_LINE_HEIGHT, 1.8)
/** 页宽档：full=全宽（默认=既有呈现）/ standard=760px / wide=920px */
export const msPageWidth = persisted<string>(KEY_PAGE_WIDTH, 'full')
/** 段首缩进（呈现层 text-indent，不改内容） */
export const msIndent = persisted<boolean>(KEY_INDENT, false)
/** 引号风格（一键排版用）：off=不统一 / curly=“弯引号” / corner=「直角引号」 */
export const msQuoteStyle = persisted<'off' | 'curly' | 'corner'>(KEY_QUOTE_STYLE, 'off')
/** 专注模式（Esc 退出，视图层处理） */
export const msFocusMode = persisted<boolean>(KEY_FOCUS, false)
/** 打字机滚动（光标回中） */
export const msTypewriter = persisted<boolean>(KEY_TYPEWRITER, false)
/** 段落淡出（当前段外降透明度） */
export const msParaDim = persisted<boolean>(KEY_PARA_DIM, false)

/**
 * popoverPosition — 光标锚定弹层的视口感知定位（走查修复轮 3，2026-10-12）。
 *
 * 策略（吸取走查反馈「出现位置不跟随指令符 / 滚动不跟手 / 上下横跳」）：
 * 1. **下方优先 + 缩高保位**：默认贴光标下方。下方空间「完整放不下但够高」
 *    （≥ MIN_PARTIAL_H）时**不翻走**，改为限制弹层高度（maxHeight）放回下方
 *    （列表自身滚动）——位置永远贴住指令符，这是治"位置感"的核心。
 *    —— 旧版「下方差一点就翻 + 上方只更宽裕也翻」是中部偏下光标高频误翻的根因。
 * 2. **翻上的前提**：仅当下方连"缩高显示"都放不下（< MIN_PARTIAL_H）且上方
 *    「完整放得下」（或至少够高）时才翻到上方。
 * 3. **边界防抖**：两侧都不完整装得下且空间接近（≤ MARGIN_TIE）时保持上次方向
 *    （preferDir），消除临界区横跳。
 * 4. **锚点缺失不乱飞**：clientRect() 取不到时返回 null——调用方保持原位；
 *    旧版兜底到「视口中上」，是位置乱飞的另一来源。
 */

export type PopoverDir = 'below' | 'above'

export interface PopoverPos {
  x: number
  y: number
  /** 本次采用的方向（调用方保存后作为下次 preferDir 传回，实现防抖） */
  dir: PopoverDir
  /** 需要应用的高度上限（"部分可用"场景缩高放回锚点下方；null = 不限制，用 CSS 默认） */
  maxHeight: number | null
}

const VIEWPORT_MARGIN = 8
/** 弹层与光标行的间距 */
const GAP = 4
/** 弹层缩高后的最小可接受高度——低于此值的空间视为「放不下」（宁可翻面/贴边） */
const MIN_PARTIAL_H = 150
/** 两侧空间差小于该值视为胶着 → 保持上次方向（防临界区横跳） */
const MARGIN_TIE = 24

/** 视口尺寸（测试可注入；缺省 window） */
function viewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1280, h: 800 }
  return { w: window.innerWidth, h: window.innerHeight }
}

/**
 * 计算弹层位置。
 * @param clientRect suggestion 提供的实时位置函数（可为 null → 返回 null，调用方保持原位）
 * @param size 弹层实际尺寸（调用方在挂载后用 offsetWidth/Height 取）
 * @param preferDir 上次采用的方向（边界防抖偏好；每次打开传 'below'）
 */
export function computePopoverPos(
  clientRect: (() => DOMRect | null) | null,
  size: { width: number; height: number },
  preferDir: PopoverDir = 'below',
): PopoverPos | null {
  const { w: vw, h: vh } = viewport()
  const rect = clientRect?.() ?? null
  if (!rect) return null

  const needH = size.height + GAP
  const spaceBelow = vh - rect.bottom
  const spaceAbove = rect.top

  let dir: PopoverDir
  let maxHeight: number | null = null
  // 缩高值 = 可用空间 - 间距 - 安全边距（保证缩高后底/顶边不贴视口边缘）
  if (spaceBelow >= needH) {
    dir = 'below' // 下方完整放下
  } else if (spaceBelow >= MIN_PARTIAL_H) {
    dir = 'below' // 下方部分可用 → 缩高放下方（位置贴锚点，不翻走）
    maxHeight = spaceBelow - GAP - VIEWPORT_MARGIN
  } else if (spaceAbove >= needH) {
    dir = 'above' // 下方过矮 → 翻上（完整放下）
  } else if (spaceAbove >= MIN_PARTIAL_H) {
    dir = 'above' // 上方部分可用 → 翻上 + 缩高
    maxHeight = spaceAbove - GAP - VIEWPORT_MARGIN
  } else {
    // 两侧都过矮（极端窗口）：取宽裕侧贴边显示；差值接近时保持上次方向（防抖）
    const diff = spaceBelow - spaceAbove
    dir = Math.abs(diff) <= MARGIN_TIE ? preferDir : diff > 0 ? 'below' : 'above'
    maxHeight = Math.max(80, (dir === 'below' ? spaceBelow : spaceAbove) - GAP - VIEWPORT_MARGIN)
  }

  // 垂直内缩以「实际生效高度」为准（缩高后不能用完整高度算安全线，否则会把 y 顶回去）
  const effH = maxHeight !== null ? Math.min(size.height, maxHeight) : size.height
  let x = rect.left
  let y = dir === 'below' ? rect.bottom + GAP : rect.top - size.height - GAP
  // 越界内缩（水平必做；垂直兜底：真放不下的极端下贴边显示而非飞出视口）
  x = Math.min(Math.max(VIEWPORT_MARGIN, x), Math.max(VIEWPORT_MARGIN, vw - size.width - VIEWPORT_MARGIN))
  y = Math.min(Math.max(VIEWPORT_MARGIN, y), Math.max(VIEWPORT_MARGIN, vh - effH - VIEWPORT_MARGIN))
  return { x, y, dir, maxHeight }
}

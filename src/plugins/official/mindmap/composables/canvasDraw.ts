import type { CameraState, CanvasNode, CanvasEdge } from './canvasTypes'

export type FreehandDrawFn = (ctx: CanvasRenderingContext2D, camera: CameraState) => void

/** 从 CSS 变量读取主题色；fallback 保持原 dark 风格 */
function getCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** 主题色解析 — 浅/深主题都用同一组色，按 CSS 变量值推断 */
export interface ThemeColors {
  bg: string
  glow: string
  grid: string
  text: string
  textMuted: string
  border: string
  selectedGlow: string
  selectedStroke: string
  isDark: boolean
}

/** 每帧渲染前重新读一次 — 主题切换时只需 markDirty 即可生效 */
let _themeCache: ThemeColors | null = null
let _themeTick = 0

export function getThemeColors(): ThemeColors {
  // 每 ~30 帧重读一次 CSS 变量（主题切换 + 颜色编辑器会更新根变量）
  _themeTick = (_themeTick + 1) % 30
  if (_themeCache && _themeTick !== 0) return _themeCache

  const bg = getCssVar('--canvas-bg', '#0f1318')
  // 通过 bg 亮度粗略判断深/浅主题，决定一组协调的 UI 色
  const isDark = isColorDark(bg)
  _themeCache = {
    bg,
    glow: isDark ? 'rgba(245,158,11,0.04)' : 'rgba(99,102,241,0.05)',
    grid: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
    text: isDark ? '#e6e8eb' : '#1f2328',
    textMuted: isDark ? '#9aa0a6' : '#5b6270',
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    selectedGlow: getCssVar('--color-primary', '#4f46e5'),
    selectedStroke: getCssVar('--color-primary', '#4a6cf7'),
    isDark,
  }
  return _themeCache
}

/** 主题切换后让画布重读 CSS 变量 */
export function invalidateThemeCache(): void {
  _themeCache = null
}

function isColorDark(hex: string): boolean {
  let r = 0, g = 0, b = 0
  if (hex.startsWith('#')) {
    const h = hex.replace('#', '')
    r = parseInt(h.slice(0, 2), 16) || 0
    g = parseInt(h.slice(2, 4), 16) || 0
    b = parseInt(h.slice(4, 6), 16) || 0
  } else if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g)
    if (m) { r = +m[0]; g = +m[1]; b = +m[2] }
  }
  return (r * 299 + g * 587 + b * 114) / 1000 < 140
}

export function drawGraph(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  camera: CameraState,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
  freehandDrawFn?: FreehandDrawFn | null,
  aiSuggestions?: Array<{ sourceId: string; targetId: string; relType: string }>,
  highlightedIds?: Set<string>,
): void {
  ctx.save()
  ctx.clearRect(0, 0, width, height)

  const theme = getThemeColors()
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, width, height)

  // 中心径向高光
  const cx = width / 2
  const cy = height / 2
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.5)
  gradient.addColorStop(0, theme.glow)
  gradient.addColorStop(1, 'transparent')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // 浅主题：画点阵网格；深主题不画（避免噪点）
  if (!theme.isDark && camera.k > 0.4) {
    drawGrid(ctx, width, height, camera, theme.grid)
  }

  // AI 候选虚线（在普通边下层画，提示但不抢戏）
  if (aiSuggestions && aiSuggestions.length > 0) {
    drawAISuggestionHints(ctx, aiSuggestions, nodes, theme)
  }

  ctx.translate(cx, cy)
  ctx.scale(camera.k, camera.k)
  ctx.translate(-camera.x, -camera.y)

  for (const edge of edges) {
    if (edge.hidden) continue
    drawEdge(ctx, edge, nodes, hoveredNodeId, selectedNodeId)
  }

  for (const node of nodes) {
    if (node.hidden) continue
    drawNode(ctx, node, hoveredNodeId === node.id, selectedNodeId === node.id, highlightedIds?.has(node.id) || false)
  }

  if (freehandDrawFn) {
    freehandDrawFn(ctx, camera)
  }

  ctx.restore()
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: CanvasNode,
  isHovered: boolean,
  isSelected: boolean,
  isHighlighted: boolean = false,
): void {
  const { x, y, width: w, height: h } = node
  const color = node.customColor || node.color
  const theme = getThemeColors()
  const radius = 8

  ctx.save()

  if (node.type === 'section') {
    drawSectionNode(ctx, node, theme)
    ctx.restore()
    return
  }

  if (node.type === 'group') {
    drawGroupNode(ctx, node, theme)
    ctx.restore()
    return
  }

  if (node.type === 'image' && node.imageUrl) {
    drawImageNode(ctx, node, isHovered, isSelected, theme)
    ctx.restore()
    return
  }

  if (node.type === 'textbox') {
    drawTextboxNode(ctx, node, isHovered, isSelected, theme)
    ctx.restore()
    return
  }

  if (node.type === 'note') {
    drawNoteNode(ctx, node, isHovered, isSelected, theme)
    ctx.restore()
    return
  }

  if (node.type === 'link') {
    drawLinkNode(ctx, node, isHovered, isSelected, theme)
    ctx.restore()
    return
  }

  if (node.type === 'center') {
    drawCenterNode(ctx, node, isHovered, isSelected, theme)
    ctx.restore()
    return
  }

  // 中心主题（isRoot）也使用 center 节点渲染
  if (node.isRoot) {
    drawCenterNode(ctx, node, isHovered, isSelected, theme)
    ctx.restore()
    return
  }

  // === 通用实体节点：双层色块 + 顶部类型色条 + 图标 + 文字 ===
  // 阴影：选中强发光，hover 轻提
  if (isSelected) {
    ctx.shadowColor = hexToRgba(theme.selectedGlow, 0.45)
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 2
  } else if (isHovered) {
    ctx.shadowColor = 'rgba(0,0,0,0.25)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 3
  }

  // 底色（深一点的同色系）
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.fillStyle = darkenColor(color, 0.15)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  // 顶部类型色条
  ctx.fillStyle = color
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, 6, { tl: radius, tr: radius, bl: 0, br: 0 })
  ctx.fill()

  // 左侧色条（保留原风格叠加）
  ctx.fillStyle = color
  ctx.globalAlpha = 0.85
  drawRoundRect(ctx, x - w / 2, y - h / 2, 4, h, { tl: radius, bl: radius, tr: 0, br: 0 })
  ctx.fill()
  ctx.globalAlpha = 1

  // 选中/悬停状态描边
  if (isSelected) {
    ctx.strokeStyle = theme.selectedStroke
    ctx.lineWidth = 2.5
    drawRoundRect(ctx, x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2, radius + 1)
    ctx.stroke()
  } else if (isHovered) {
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 1.5
    drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
    ctx.stroke()
  }

  // 搜索高亮外环
  if (node.searchHighlight) {
    ctx.strokeStyle = '#ffd700'
    ctx.lineWidth = 2
    drawRoundRect(ctx, x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, radius + 3)
    ctx.stroke()
  }

  // AI 高亮外环（青色脉冲感）
  if (isHighlighted) {
    ctx.strokeStyle = '#06b6d4'
    ctx.lineWidth = 3
    ctx.setLineDash([4, 3])
    drawRoundRect(ctx, x - w / 2 - 5, y - h / 2 - 5, w + 10, h + 10, radius + 4)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 类型徽标（左下小圆点）
  ctx.beginPath()
  ctx.arc(x - w / 2 + 10, y + h / 2 - 10, 4, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = theme.isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 文字（自动按 zoom 给最小字号保护）
  const camK = (ctx.getTransform().a || 1)
  const minFont = 11
  const baseFont = node.isRoot ? 14 : 12
  const fontSize = Math.max(minFont, baseFont * Math.min(1.5, camK))
  const maxTextWidth = w - 24
  ctx.fillStyle = theme.text
  ctx.font = `${node.isRoot ? 'bold' : 'normal'} ${fontSize}px ${'var(--font-family-base, sans-serif)'}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = truncateText(ctx, node.name, maxTextWidth)
  ctx.fillText(text, x, y + 2)

  // 折叠徽标
  if (node.isCollapsed && node.childCount > 0) {
    const badgeX = x + w / 2 - 12
    const badgeY = y - h / 2 + 12
    ctx.beginPath()
    ctx.arc(badgeX, badgeY, 9, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`+${node.childCount}`, badgeX, badgeY)
  }

  ctx.restore()
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  edge: CanvasEdge,
  nodes: CanvasNode[],
  hoveredNodeId: string | null,
  _selectedNodeId: string | null,
): void {
  const src = nodes.find(n => n.id === edge.source)
  const tgt = nodes.find(n => n.id === edge.target)
  if (!src || !tgt) return

  const theme = getThemeColors()
  const isHot = edge.selected || (hoveredNodeId && (hoveredNodeId === edge.source || hoveredNodeId === edge.target))

  ctx.save()
  ctx.strokeStyle = edge.color || (theme.isDark ? '#5a5a7a' : '#9aa0a6')
  ctx.lineWidth = (edge.selected ? 3 : isHot ? 2.5 : 2)

  if (edge.dashed) {
    ctx.setLineDash([6, 4])
  }

  // 起点/终点：从节点边缘开始而非中心（贴合式箭头）
  const { x: sx, y: sy } = edgePointOnNode(src, tgt)
  const { x: tx, y: ty } = edgePointOnNode(tgt, src)

  ctx.beginPath()
  if (edge.curveStyle === 'bezier') {
    const dx = tx - sx
    const dy = ty - sy
    const cx1 = (sx + tx) / 2 - dy * 0.2
    const cy1 = (sy + ty) / 2 + dx * 0.2
    ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cx1, cy1, tx, ty)
  } else if (edge.curveStyle === 'taxi') {
    const midX = (sx + tx) / 2
    ctx.moveTo(sx, sy)
    ctx.lineTo(midX, sy)
    ctx.lineTo(midX, ty)
    ctx.lineTo(tx, ty)
  } else {
    ctx.moveTo(sx, sy)
    ctx.lineTo(tx, ty)
  }
  ctx.stroke()
  ctx.setLineDash([])

  if (!edge.noArrow && !edge.symmetric) {
    drawArrow(ctx, sx, sy, tx, ty, edge.color || (theme.isDark ? '#5a5a7a' : '#9aa0a6'))
  } else if (edge.symmetric) {
    // 对称关系两端都画箭头
    drawArrow(ctx, tx, ty, sx, sy, edge.color || (theme.isDark ? '#5a5a7a' : '#9aa0a6'))
  }

  if (edge.relLabel) {
    drawEdgeLabel(ctx, sx, sy, tx, ty, edge.relLabel, theme)
  }

  ctx.restore()
}

/** 把连线的端点裁剪到节点矩形边上（避免箭头进入节点内部） */
function edgePointOnNode(node: CanvasNode, other: { x: number; y: number }): { x: number; y: number } {
  const dx = other.x - node.x
  const dy = other.y - node.y
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y }
  const hw = node.width / 2
  const hh = node.height / 2
  // 用 |dx|/hw vs |dy|/hh 决定从哪条边出去
  const scaleX = Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity
  const scaleY = Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity
  const s = Math.min(scaleX, scaleY, 1)
  return { x: node.x + dx * s, y: node.y + dy * s }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  tx: number, ty: number,
  color: string,
): void {
  const angle = Math.atan2(ty - sy, tx - sx)
  const arrowLen = 9
  const arrowAngle = Math.PI / 6
  // 箭头根部往回退一点，留视觉间隙
  const tipX = tx - Math.cos(angle) * 2
  const tipY = ty - Math.sin(angle) * 2

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX - arrowLen * Math.cos(angle - arrowAngle), tipY - arrowLen * Math.sin(angle - arrowAngle))
  ctx.lineTo(tipX - arrowLen * Math.cos(angle + arrowAngle), tipY - arrowLen * Math.sin(angle + arrowAngle))
  ctx.closePath()
  ctx.fill()
}

function drawEdgeLabel(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, tx: number, ty: number,
  label: string,
  theme: ThemeColors,
): void {
  const mx = (sx + tx) / 2
  const my = (sy + ty) / 2
  ctx.font = '10px sans-serif'
  const tw = ctx.measureText(label).width
  const padX = 6
  const w = tw + padX * 2
  const h = 16
  // 徽标底
  ctx.fillStyle = theme.isDark ? 'rgba(15,19,24,0.92)' : 'rgba(255,255,255,0.96)'
  drawRoundRect(ctx, mx - w / 2, my - h / 2, w, h, h / 2)
  ctx.fill()
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 1
  drawRoundRect(ctx, mx - w / 2, my - h / 2, w, h, h / 2)
  ctx.stroke()
  // 文字
  ctx.fillStyle = theme.textMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, mx, my)
}

function drawSectionNode(ctx: CanvasRenderingContext2D, node: CanvasNode, theme: ThemeColors): void {
  const { x, y, width: w, height: h } = node
  const color = node.sectionColor || '#6c5ce7'

  ctx.shadowColor = 'rgba(0,0,0,0.15)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2

  ctx.fillStyle = theme.isDark ? color + '15' : color + '20'
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, 10)
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.setLineDash([8, 5])
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, 10)
  ctx.stroke()
  ctx.setLineDash([])

  const labelText = node.name || '分组'
  ctx.font = 'bold 12px sans-serif'
  const tw = ctx.measureText(labelText).width
  const tagW = tw + 16
  const tagH = 22
  const tagX = x - w / 2 + 12
  const tagY = y - h / 2 - 6
  ctx.fillStyle = color
  drawRoundRect(ctx, tagX, tagY, tagW, tagH, tagH / 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(labelText, tagX + tagW / 2, tagY + tagH / 2 + 1)
}

function drawGroupNode(ctx: CanvasRenderingContext2D, node: CanvasNode, theme: ThemeColors): void {
  const { x, y, width: w, height: h } = node
  ctx.fillStyle = theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, 10)
  ctx.fill()
  ctx.setLineDash([8, 5])
  ctx.strokeStyle = theme.textMuted
  ctx.lineWidth = 1.5
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, 10)
  ctx.stroke()
  ctx.setLineDash([])

  const labelText = node.name || '分组'
  ctx.font = 'bold 12px sans-serif'
  const tw = ctx.measureText(labelText).width
  const tagW = tw + 16
  const tagH = 22
  const tagX = x - w / 2 + 12
  const tagY = y - h / 2 - 6
  ctx.fillStyle = theme.textMuted
  drawRoundRect(ctx, tagX, tagY, tagW, tagH, tagH / 2)
  ctx.fill()
  ctx.fillStyle = theme.bg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(labelText, tagX + tagW / 2, tagY + tagH / 2 + 1)
}

function drawTextboxNode(ctx: CanvasRenderingContext2D, node: CanvasNode, _h: boolean, _s: boolean, theme: ThemeColors): void {
  const { x, y, width: w, height: h } = node
  const color = node.customColor || node.color || '#eab308'
  const radius = 8
  ctx.fillStyle = theme.isDark ? darkenColor(color, 0.2) : lightenColor(color, 0.4)
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.stroke()
  ctx.fillStyle = theme.text
  ctx.font = `bold 13px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = truncateText(ctx, node.name || '文本框', w - 20)
  ctx.fillText(text, x, y)
}

function drawNoteNode(ctx: CanvasRenderingContext2D, node: CanvasNode, _h: boolean, _s: boolean, theme: ThemeColors): void {
  const { x, y, width: w, height: h } = node
  const color = node.customColor || node.color || '#ca8a04'
  const radius = 6
  ctx.fillStyle = theme.isDark ? darkenColor(color, 0.15) : '#fef9c3'
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.stroke()
  ctx.fillStyle = theme.text
  ctx.font = `12px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = truncateText(ctx, node.name || '备注', w - 20)
  ctx.fillText(text, x, y)
}

function drawLinkNode(ctx: CanvasRenderingContext2D, node: CanvasNode, _h: boolean, _s: boolean, theme: ThemeColors): void {
  const { x, y, width: w, height: h } = node
  const color = node.customColor || node.color || '#3b82f6'
  const radius = h / 2
  ctx.fillStyle = theme.isDark ? darkenColor(color, 0.2) : lightenColor(color, 0.45)
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.stroke()
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x - w / 2 + 14, y, 5, Math.PI * 0.5, Math.PI * 1.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x - w / 2 + 22, y, 5, Math.PI * 1.5, Math.PI * 0.5)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = theme.text
  ctx.font = `12px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = truncateText(ctx, node.name || '链接', w - 44)
  ctx.fillText(text, x + 8, y)
}

function drawCenterNode(ctx: CanvasRenderingContext2D, node: CanvasNode, isHovered: boolean, isSelected: boolean, theme: ThemeColors): void {
  const { x, y, width: w, height: h } = node
  const color = node.customColor || node.color || '#a78bfa'
  const radius = 12
  const style = node.centerStyle

  if (isSelected) {
    ctx.shadowColor = hexToRgba(color, 0.5)
    ctx.shadowBlur = 20
  } else if (isHovered) {
    ctx.shadowColor = 'rgba(0,0,0,0.3)'
    ctx.shadowBlur = 14
  }

  const grad = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2)
  if (style === 'gold') {
    grad.addColorStop(0, '#fbbf24'); grad.addColorStop(1, '#b45309')
  } else if (style === 'flame') {
    grad.addColorStop(0, '#f97316'); grad.addColorStop(1, '#dc2626')
  } else if (style === 'ocean') {
    grad.addColorStop(0, '#06b6d4'); grad.addColorStop(1, '#1e40af')
  } else if (style === 'forest') {
    grad.addColorStop(0, '#10b981'); grad.addColorStop(1, '#065f46')
  } else {
    grad.addColorStop(0, lightenColor(color, 0.2)); grad.addColorStop(1, darkenColor(color, 0.2))
  }
  ctx.fillStyle = grad
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  ctx.strokeStyle = theme.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.1)'
  ctx.lineWidth = 1
  drawRoundRect(ctx, x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8, radius - 4)
  ctx.stroke()

  ctx.fillStyle = '#fff'
  ctx.font = `bold 14px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = truncateText(ctx, node.name || '中心', w - 20)
  ctx.fillText(text, x, y + 2)
}

function drawImageNode(ctx: CanvasRenderingContext2D, node: CanvasNode, isHovered: boolean, isSelected: boolean, theme: ThemeColors): void {
  const { x, y, width: w, height: h } = node
  const radius = 8
  if (isSelected) {
    ctx.shadowColor = hexToRgba(theme.selectedGlow, 0.4)
    ctx.shadowBlur = 14
  } else if (isHovered) {
    ctx.shadowColor = 'rgba(0,0,0,0.25)'
    ctx.shadowBlur = 10
  }
  ctx.fillStyle = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.strokeStyle = isSelected ? theme.selectedStroke : theme.border
  ctx.lineWidth = isSelected ? 2.5 : 1
  drawRoundRect(ctx, x - w / 2, y - h / 2, w, h, radius)
  ctx.stroke()
  try {
    const img = ensureImage(node.imageUrl)
    if (img.complete && img.naturalWidth > 0) {
      const pad = 6
      const iw = w - pad * 2
      const ih = h - pad * 2 - 14
      ctx.save()
      drawRoundRect(ctx, x - w / 2 + pad, y - h / 2 + pad, iw, ih, 4)
      ctx.clip()
      const ar = img.naturalWidth / img.naturalHeight
      let dw = iw, dh = ih
      if (ar > iw / ih) dh = iw / ar
      else dw = ih * ar
      ctx.drawImage(img, x - dw / 2, y - h / 2 + pad + (ih - dh) / 2, dw, dh)
      ctx.restore()
    }
  } catch { /* noop */ }
  ctx.fillStyle = theme.text
  ctx.font = `11px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = truncateText(ctx, node.name || '图片', w - 12)
  ctx.fillText(text, x, y + h / 2 - 8)
}

// 简单的图片缓存（避免每帧重新解码）
const _imgCache = new Map<string, HTMLImageElement>()
function ensureImage(url: string): HTMLImageElement {
  let img = _imgCache.get(url)
  if (!img) {
    img = new Image()
    img.src = url
    _imgCache.set(url, img)
  }
  return img
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | { tl: number; tr: number; bl: number; br: number },
): void {
  const tl = typeof r === 'number' ? r : r.tl
  const tr = typeof r === 'number' ? r : r.tr
  const bl = typeof r === 'number' ? r : r.bl
  const br = typeof r === 'number' ? r : r.br
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr)
  ctx.lineTo(x + w, y + h - br)
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  ctx.lineTo(x + bl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl)
  ctx.lineTo(x, y + tl)
  ctx.quadraticCurveTo(x, y, x + tl, y)
  ctx.closePath()
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let truncated = text
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return truncated + '…'
}

function darkenColor(hex: string, amount: number): string {
  if (!hex || hex.length < 7) return '#1a1a2e'
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.round(255 * amount))
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.round(255 * amount))
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.round(255 * amount))
  return `rgb(${r},${g},${b})`
}

function lightenColor(hex: string, amount: number): string {
  if (!hex || hex.length < 7) return '#f5f5f5'
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amount))
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amount))
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amount))
  return `rgb(${r},${g},${b})`
}

function hexToRgba(hex: string, alpha: number): string {
  if (!hex || hex.length < 7) return `rgba(74,108,247,${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 浅主题下的点阵网格，给画布"工程图"质感 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: CameraState,
  color: string,
): void {
  const spacing = 60
  const stepWorld = spacing / camera.k
  const offsetX = (camera.x % stepWorld + stepWorld) % stepWorld
  const offsetY = (camera.y % stepWorld + stepWorld) % stepWorld
  ctx.save()
  ctx.fillStyle = color
  for (let wx = -offsetX; wx < width / camera.k + stepWorld; wx += stepWorld) {
    for (let wy = -offsetY; wy < height / camera.k + stepWorld; wy += stepWorld) {
      ctx.beginPath()
      ctx.arc(wx, wy, 1.2 / camera.k, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** AI 关系建议虚线：青色半透 + 短虚线 + 微脉冲感 */
function drawAISuggestionHints(
  ctx: CanvasRenderingContext2D,
  hints: Array<{ sourceId: string; targetId: string; relType: string }>,
  nodes: CanvasNode[],
  _theme: ThemeColors,
): void {
  const aiColor = '#06b6d4'  // cyan
  ctx.save()
  ctx.strokeStyle = aiColor
  ctx.fillStyle = aiColor
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 4])
  ctx.globalAlpha = 0.75
  for (const hint of hints) {
    const s = nodes.find(n => n.id === hint.sourceId)
    const t = nodes.find(n => n.id === hint.targetId)
    if (!s || !t) continue
    const a = edgePointOnNode(s, t)
    const b = edgePointOnNode(t, s)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    // 末端小箭头
    drawArrow(ctx, a.x, a.y, b.x, b.y, aiColor)
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1
  ctx.restore()
}

export interface MoodboardCamera {
  x: number
  y: number
  k: number
}

export interface CardData {
  id: string
  entityId: string
  name: string
  type: string
  x: number
  y: number
  w: number
  h: number
  imageUrl: string | null
  color: string | null
  text: string | null
  colors: string[]
}

export interface MoodboardRenderData {
  cards: CardData[]
  selectedCardId: string | null
  hoveredCardId: string | null
  dragPreview: { id: string; x: number; y: number } | null
}

const CARD_RADIUS = 6
const CARD_SHADOW = 'rgba(0,0,0,0.3)'
const CARD_BORDER = '#30363d'
const CARD_BORDER_HOVER = '#58a6ff'
const CARD_BORDER_SELECTED = '#f0883e'
const CARD_BG = '#1c2128'
const CARD_TEXT_COLOR = '#c9d1d9'
const CARD_SUBTEXT_COLOR = '#8b949e'

const TYPE_COLORS: Record<string, string> = {
  '\u56fe\u7247': '#3fb950',
  '\u89c6\u9891': '#f85149',
  '\u6587\u7ae0': '#58a6ff',
  '\u97f3\u4e50': '#d2a8ff',
  '\u6982\u5ff5': '#f0883e',
  '\u89d2\u8272': '#4a9eff',
  '\u573a\u666f': '#3fb950',
  '\u5bf9\u8bdd': '#d29922',
  '\u5176\u4ed6': '#8b949e',
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  card: CardData,
  isSelected: boolean,
  isHovered: boolean,
  isDragPreview: boolean,
): void {
  const { x, y, w, h, name, type, imageUrl, color, text, colors } = card

  ctx.save()

  if (isDragPreview) {
    ctx.globalAlpha = 0.7
  }

  ctx.shadowColor = isHovered || isSelected ? 'rgba(0,0,0,0.5)' : CARD_SHADOW
  ctx.shadowBlur = isHovered || isSelected ? 12 : 6
  ctx.shadowOffsetY = isHovered || isSelected ? 4 : 2

  roundRect(ctx, x, y, w, h, CARD_RADIUS)
  ctx.fillStyle = color || CARD_BG
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  if (isSelected) {
    roundRect(ctx, x, y, w, h, CARD_RADIUS)
    ctx.strokeStyle = CARD_BORDER_SELECTED
    ctx.lineWidth = 2.5
    ctx.stroke()
  } else if (isHovered) {
    roundRect(ctx, x, y, w, h, CARD_RADIUS)
    ctx.strokeStyle = CARD_BORDER_HOVER
    ctx.lineWidth = 2
    ctx.stroke()
  } else {
    roundRect(ctx, x, y, w, h, CARD_RADIUS)
    ctx.strokeStyle = CARD_BORDER
    ctx.lineWidth = 1
    ctx.stroke()
  }

  const padding = 8
  const innerY = y + padding
  const innerW = w - padding * 2

  if (imageUrl) {
    const imgH = h * 0.55
    roundRect(ctx, x + padding, innerY, innerW, imgH, 4)
    ctx.fillStyle = '#0d1117'
    ctx.fill()

    ctx.fillStyle = CARD_SUBTEXT_COLOR
    ctx.font = `${Math.max(10, Math.min(14, w * 0.08))}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('\u{1F5BC}', x + w / 2, innerY + imgH / 2)
  } else if (text) {
    const textAreaH = h * 0.55
    ctx.fillStyle = CARD_TEXT_COLOR
    ctx.font = `${Math.max(11, Math.min(13, w * 0.07))}px sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const maxW = innerW
    const words = text
    let line = ''
    let lineY = innerY + 4
    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i]
      const metrics = ctx.measureText(testLine)
      if (metrics.width > maxW && line.length > 0) {
        ctx.fillText(line, x + padding, lineY)
        line = words[i]
        lineY += 16
        if (lineY > innerY + textAreaH - 16) {
          ctx.fillText(line + '...', x + padding, lineY)
          line = ''
          break
        }
      } else {
        line = testLine
      }
    }
    if (line) ctx.fillText(line, x + padding, lineY)
  }

  const typeColor = TYPE_COLORS[type] || TYPE_COLORS['\u5176\u4ed6']
  const badgeY = imageUrl || text ? y + h * 0.58 : y + padding
  roundRect(ctx, x + padding, badgeY, Math.min(innerW, 48), 16, 3)
  ctx.fillStyle = typeColor + '33'
  ctx.fill()
  ctx.fillStyle = typeColor
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(type, x + padding + 4, badgeY + 8)

  ctx.fillStyle = CARD_TEXT_COLOR
  ctx.font = `600 ${Math.max(11, Math.min(13, w * 0.07))}px sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const nameY = badgeY + 20
  const maxNameW = innerW
  let displayName = name
  while (ctx.measureText(displayName).width > maxNameW && displayName.length > 1) {
    displayName = displayName.slice(0, -1)
  }
  if (displayName !== name) displayName += '\u2026'
  ctx.fillText(displayName, x + padding, nameY)

  if (colors.length > 0) {
    const swatchY = nameY + 18
    const swatchSize = Math.min(12, (innerW - (colors.length - 1) * 2) / colors.length)
    for (let i = 0; i < Math.min(colors.length, 6); i++) {
      roundRect(ctx, x + padding + i * (swatchSize + 2), swatchY, swatchSize, swatchSize, 2)
      ctx.fillStyle = colors[i]
      ctx.fill()
    }
  }

  ctx.restore()
}

export function drawMoodboard(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  data: MoodboardRenderData,
  camera: MoodboardCamera,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH)

  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, canvasW, canvasH)

  ctx.save()
  const cx = canvasW / 2
  const cy = canvasH / 2
  ctx.translate(cx, cy)
  ctx.scale(camera.k, camera.k)
  ctx.translate(-camera.x, -camera.y)

  const gridSize = 40
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'
  ctx.lineWidth = 0.5
  const startX = Math.floor((camera.x - canvasW / 2 / camera.k) / gridSize) * gridSize
  const endX = camera.x + canvasW / 2 / camera.k
  const startY = Math.floor((camera.y - canvasH / 2 / camera.k) / gridSize) * gridSize
  const endY = camera.y + canvasH / 2 / camera.k
  for (let gx = startX; gx <= endX; gx += gridSize) {
    ctx.beginPath()
    ctx.moveTo(gx, startY)
    ctx.lineTo(gx, endY)
    ctx.stroke()
  }
  for (let gy = startY; gy <= endY; gy += gridSize) {
    ctx.beginPath()
    ctx.moveTo(startX, gy)
    ctx.lineTo(endX, gy)
    ctx.stroke()
  }

  for (const card of data.cards) {
    const isDragPreview = data.dragPreview?.id === card.id
    const drawCard2 = isDragPreview
      ? { ...card, x: data.dragPreview!.x, y: data.dragPreview!.y }
      : card
    const isSelected = data.selectedCardId === card.id
    const isHovered = data.hoveredCardId === card.id
    drawCard(ctx, drawCard2, isSelected, isHovered, isDragPreview)
  }

  ctx.restore()
}

export function hitTestCard(
  worldX: number,
  worldY: number,
  cards: CardData[],
): CardData | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i]
    if (worldX >= c.x && worldX <= c.x + c.w && worldY >= c.y && worldY <= c.y + c.h) {
      return c
    }
  }
  return null
}

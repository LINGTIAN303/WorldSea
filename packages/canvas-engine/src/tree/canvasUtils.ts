export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
}

export function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('hsl')) {
    const match = hex.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
    if (match) {
      const h = parseInt(match[1]) / 360
      const s = parseInt(match[2]) / 100
      const l = parseInt(match[3]) / 100
      const [r, g, b] = hslToRgb(h, s, l)
      return `rgba(${r},${g},${b},${alpha})`
    }
    return `rgba(150,150,150,${alpha})`
  }
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  nodeW: number,
  nodeH: number,
  color: string,
  bidir: boolean = false,
): void {
  const dx = toX - fromX
  const dy = toY - fromY
  const angle = Math.atan2(dy, dx)

  const startX = fromX + Math.cos(angle) * (nodeW / 2 + 4)
  const startY = fromY + Math.sin(angle) * (nodeH / 2 + 4)
  const endX = toX - Math.cos(angle) * (nodeW / 2 + 4)
  const endY = toY - Math.sin(angle) * (nodeH / 2 + 4)

  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  ctx.stroke()

  const arrowLen = 8
  ctx.beginPath()
  ctx.moveTo(endX, endY)
  ctx.lineTo(
    endX - arrowLen * Math.cos(angle - 0.3),
    endY - arrowLen * Math.sin(angle - 0.3),
  )
  ctx.lineTo(
    endX - arrowLen * Math.cos(angle + 0.3),
    endY - arrowLen * Math.sin(angle + 0.3),
  )
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()

  if (bidir) {
    const revAngle = angle + Math.PI
    const revEndX = fromX - Math.cos(revAngle) * (nodeW / 2 + 4)
    const revEndY = fromY - Math.sin(revAngle) * (nodeH / 2 + 4)
    ctx.beginPath()
    ctx.moveTo(revEndX, revEndY)
    ctx.lineTo(
      revEndX - arrowLen * Math.cos(revAngle - 0.3),
      revEndY - arrowLen * Math.sin(revAngle - 0.3),
    )
    ctx.lineTo(
      revEndX - arrowLen * Math.cos(revAngle + 0.3),
      revEndY - arrowLen * Math.sin(revAngle + 0.3),
    )
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }
}

export function drawClusterOutlines<T extends { x: number; y: number; color: string }>(
  ctx: CanvasRenderingContext2D,
  nodes: T[],
  clusterKey: keyof T & string,
  nodeW: number,
  nodeH: number,
  colorFn?: (val: string) => string,
): void {
  const groups = new Map<string, T[]>()
  for (const n of nodes) {
    const val = String(n[clusterKey] ?? '(未分类)')
    if (!groups.has(val)) groups.set(val, [])
    groups.get(val)!.push(n)
  }

  for (const [val, groupNodes] of groups) {
    if (groupNodes.length < 2) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of groupNodes) {
      minX = Math.min(minX, n.x - nodeW / 2)
      minY = Math.min(minY, n.y - nodeH / 2)
      maxX = Math.max(maxX, n.x + nodeW / 2)
      maxY = Math.max(maxY, n.y + nodeH / 2)
    }
    const pad = 16
    const clusterColor = colorFn ? colorFn(val) : groupNodes[0].color
    ctx.save()
    ctx.beginPath()
    roundRect(ctx, minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 12)
    ctx.fillStyle = hexToRgba(clusterColor, 0.06)
    ctx.fill()
    ctx.strokeStyle = hexToRgba(clusterColor, 0.2)
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.font = '11px sans-serif'
    ctx.fillStyle = hexToRgba(clusterColor, 0.6)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(val, minX - pad + 8, minY - pad + 6)
    ctx.restore()
  }
}

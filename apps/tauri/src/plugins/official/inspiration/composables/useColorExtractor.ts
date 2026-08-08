export interface ExtractedColor {
  r: number
  g: number
  b: number
  hex: string
  ratio: number
}

export function extractColorsFromImage(img: HTMLImageElement, maxColors: number = 5): ExtractedColor[] {
  const canvas = document.createElement('canvas')
  const size = 64
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  ctx.drawImage(img, 0, 0, size, size)
  const imageData = ctx.getImageData(0, 0, size, size)
  const data = imageData.data

  const colorMap = new Map<string, { count: number; r: number; g: number; b: number }>()
  const step = 24

  for (let i = 0; i < data.length; i += 4) {
    const r = Math.round(data[i] / step) * step
    const g = Math.round(data[i + 1] / step) * step
    const b = Math.round(data[i + 2] / step) * step
    const a = data[i + 3]
    if (a < 128) continue

    const brightness = (r * 299 + g * 587 + b * 114) / 1000
    if (brightness < 15 || brightness > 245) continue

    const key = `${r},${g},${b}`
    const existing = colorMap.get(key)
    if (existing) {
      existing.count++
    } else {
      colorMap.set(key, { count: 1, r, g, b })
    }
  }

  const sorted = Array.from(colorMap.values()).sort((a, b) => b.count - a.count)
  const total = sorted.reduce((s, c) => s + c.count, 0)

  const results: ExtractedColor[] = []
  for (const color of sorted) {
    if (results.length >= maxColors) break
    const isTooSimilar = results.some(existing => {
      const dr = existing.r - color.r
      const dg = existing.g - color.g
      const db = existing.b - color.b
      return Math.sqrt(dr * dr + dg * dg + db * db) < 60
    })
    if (isTooSimilar) continue

    results.push({
      r: color.r,
      g: color.g,
      b: color.b,
      hex: `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`,
      ratio: color.count / total,
    })
  }

  return results
}

export function extractColorsFromUrl(url: string, maxColors: number = 5): Promise<ExtractedColor[]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      resolve(extractColorsFromImage(img, maxColors))
    }
    img.onerror = () => resolve([])
    img.src = url
  })
}

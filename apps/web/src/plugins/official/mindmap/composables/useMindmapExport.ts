/**
 * 思维导图导出功能
 *
 * - PNG: Canvas.toDataURL → 触发下载
 * - SVG: 遍历节点/边构建 SVG DOM → 触发下载
 * - 剪贴板: Canvas → Clipboard API
 */
import type { CanvasNode, CanvasEdge } from './canvasTypes'

export function useMindmapExport() {
  /**
   * 导出为 PNG（从现有 Canvas 元素）
   */
  function exportPNG(canvasEl: HTMLCanvasElement | null, filename = 'worldsmith-mindmap.png'): void {
    if (!canvasEl) return
    try {
      const url = canvasEl.toDataURL('image/png')
      downloadDataURL(url, filename)
    } catch (err) {
      console.error('[useMindmapExport] PNG export failed:', err)
    }
  }

  /**
   * 导出为 SVG
   * 构建最小 SVG DOM：仅包含节点(rect+text)和边(line+polygon)
   */
  function exportSVG(
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    filename = 'worldsmith-mindmap.svg',
  ): void {
    if (nodes.length === 0) return

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodes) {
      if (n.x - n.width / 2 < minX) minX = n.x - n.width / 2
      if (n.x + n.width / 2 > maxX) maxX = n.x + n.width / 2
      if (n.y - n.height / 2 < minY) minY = n.y - n.height / 2
      if (n.y + n.height / 2 > maxY) maxY = n.y + n.height / 2
    }

    const padding = 20
    const width = maxX - minX + padding * 2
    const height = maxY - minY + padding * 2

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX - padding} ${minY - padding} ${width} ${height}">\n`
    svg += '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polygon points="0,0 10,5 0,10" fill="#8899aa"/></marker></defs>\n'

    // 边
    for (const e of edges) {
      if (e.hidden) continue
      const src = nodes.find(n => n.id === e.source)
      const tgt = nodes.find(n => n.id === e.target)
      if (!src || !tgt) continue
      svg += `<line x1="${src.x}" y1="${src.y}" x2="${tgt.x}" y2="${tgt.y}" stroke="${e.color}" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.6"/>\n`
    }

    // 节点
    for (const n of nodes) {
      if (n.hidden) continue
      const fill = n.customColor || n.color || '#4a6cf7'
      svg += `<g>\n`
      svg += `<rect x="${n.x - n.width / 2}" y="${n.y - n.height / 2}" width="${n.width}" height="${n.height}" rx="6" fill="${fill}" fill-opacity="0.9" stroke="${fill}" stroke-width="1.5"/>\n`
      svg += `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="11" font-family="sans-serif">${escapeXml(n.name)}</text>\n`
      svg += `</g>\n`
    }

    svg += '</svg>'

    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    downloadDataURL(url, filename)
    URL.revokeObjectURL(url)
  }

  /**
   * 复制当前画布到剪贴板（PNG）
   */
  async function copyToClipboard(canvasEl: HTMLCanvasElement | null): Promise<boolean> {
    if (!canvasEl) return false
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvasEl.toBlob((b) => resolve(b), 'image/png')
      })
      if (!blob) return false
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ])
      return true
    } catch (err) {
      console.error('[useMindmapExport] Clipboard copy failed:', err)
      return false
    }
  }

  return { exportPNG, exportSVG, copyToClipboard }
}

function downloadDataURL(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

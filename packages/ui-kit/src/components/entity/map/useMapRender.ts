/**
 * useMapRender — Canvas 渲染逻辑
 *
 * 从 RegionMap.vue 提取的纯渲染函数，只读取状态并绘制，不修改任何状态。
 * 依赖通过 options 注入，保持与主文件解耦。
 */
import type { Ref } from 'vue'
import { roundedRect } from './geometry'
import type { MapMode, RegionEntity, Point } from './types'

/** 关系记录（最小结构） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RelationLike = { type: string; sourceId: string; targetId: string }

interface UseMapRenderOptions {
  canvasRef: Ref<HTMLCanvasElement | undefined>
  mapRoot: Ref<HTMLDivElement | undefined>
  pixelRatio: number
  /** 平移量（let 变量，通过 getter 读取） */
  getPanX: () => number
  getPanY: () => number
  getScale: () => number
  /** 数据访问 */
  getRegions: () => RegionEntity[]
  getTerritory: (r: RegionEntity) => Point[]
  regionColor: (r: RegionEntity) => string
  /** 关系与实体查找 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRelations: () => RelationLike[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getEntity: (id: string) => any | undefined
  /** UI 状态 */
  getMode: () => MapMode
  getSelectedRegionId: () => string | null
  /** 接壤状态 */
  adjoinSelectMode: Ref<boolean>
  adjoinSelectedIds: Ref<Set<string>>
  adjoinSourceRegion: Ref<RegionEntity | null>
  /** 抹除状态 */
  eraseMode: Ref<string | null>
  eraseBorderVertices: Ref<Point[]>
  eraseBorderFixedIndices: Ref<number[]>
  eraseRedrawPath: Ref<Point[]>
  /** 绘制状态 */
  drawingPath: Ref<Point[]>
}

/**
 * 绘制区域地图到 Canvas。
 * 包含：羊皮纸背景、关系连线、区域多边形、顶点、标签、
 * 选中高亮、接壤高亮、偏移/重划/绘制预览、图例。
 */
export function useMapRender(opts: UseMapRenderOptions) {
  function draw() {
    const canvas = opts.canvasRef.value
    if (!canvas || !opts.mapRoot.value) return
    const rect = opts.mapRoot.value.getBoundingClientRect()
    const pr = opts.pixelRatio
    canvas.width = rect.width * pr
    canvas.height = rect.height * pr
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(pr, 0, 0, pr, 0, 0)

    // === 羊皮纸背景 ===
    ctx.fillStyle = '#f5ecd7'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = 'rgba(200,180,140,0.05)'
    for (let i = 0; i < 60; i++) {
      ctx.fillRect(Math.random() * rect.width, Math.random() * rect.height, Math.random() * 40 + 5, 1)
    }

    // === 世界坐标变换 ===
    ctx.save()
    ctx.translate(opts.getPanX(), opts.getPanY())
    const sc = opts.getScale()
    ctx.scale(sc, sc)

    const regions = opts.getRegions()

    // === 绘制连线（关系） ===
    const rels = opts.getRelations()
    for (const r of rels) {
      if (!['borders', 'route', 'located_in', 'contains', 'enclave_of'].includes(r.type)) continue
      const src = opts.getEntity(r.sourceId)
      const tgt = opts.getEntity(r.targetId)
      if (!src || !tgt) continue
      const p1 = { x: Number(src.properties?.mapX) || 0, y: Number(src.properties?.mapY) || 0 }
      const p2 = { x: Number(tgt.properties?.mapX) || 0, y: Number(tgt.properties?.mapY) || 0 }
      if (p1.x === 0 && p1.y === 0) continue
      if (p2.x === 0 && p2.y === 0) continue
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      if (r.type === 'route') {
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = '#c4a95a'
      } else if (r.type === 'borders') {
        ctx.setLineDash([])
        ctx.strokeStyle = '#8b4513'
      } else {
        ctx.setLineDash([2, 3])
        ctx.strokeStyle = '#aaa'
      }
      ctx.lineWidth = r.type === 'borders' ? 2 : 1.5
      ctx.stroke()
      ctx.setLineDash([])
    }

    // === 绘制区域多边形 ===
    const mode = opts.getMode()
    for (const r of regions) {
      const x = Number(r.properties?.mapX) || 0
      const y = Number(r.properties?.mapY) || 0
      if (x === 0 && y === 0) continue
      const color = opts.regionColor(r)

      const pts = opts.getTerritory(r)
      if (pts.length >= 3) {
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
        ctx.closePath()
        ctx.fillStyle = color + '60'
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.restore()

        // 仅在编辑模式下显示顶点
        if (mode === 'edit') {
          for (const p of pts) {
            ctx.beginPath()
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
            ctx.fillStyle = '#fff'
            ctx.fill()
            ctx.strokeStyle = color
            ctx.lineWidth = 1.5
            ctx.stroke()
          }
        }
      }

      // 标签
      ctx.fillStyle = '#3a2a1a'
      ctx.font = '11px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(r.name, x, y + 4)

      const rt2 = r.properties?.regionType as string || ''
      if (rt2) {
        ctx.fillStyle = '#9a8050'
        ctx.font = '8px Georgia, serif'
        ctx.fillText(rt2, x, y + 16)
      }
    }

    // === 选中区域高亮 ===
    const selectedId = opts.getSelectedRegionId()
    if (mode === 'edit' && selectedId) {
      const selRegion = regions.find(r => r.id === selectedId)
      if (selRegion) {
        const selPts = opts.getTerritory(selRegion)
        if (selPts.length >= 3) {
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(selPts[0].x, selPts[0].y)
          for (let k = 1; k < selPts.length; k++) ctx.lineTo(selPts[k].x, selPts[k].y)
          ctx.closePath()
          ctx.strokeStyle = '#FFD700'
          ctx.lineWidth = 4
          ctx.shadowColor = '#FFD700'
          ctx.shadowBlur = 12
          ctx.stroke()
          ctx.restore()
        }
        // 飞地联动高亮
        const enclaveRels = opts.getRelations().filter(r => r.type === 'enclave_of')
        for (const rel of enclaveRels) {
          let linkedId: string | null = null
          if (rel.sourceId === selectedId) linkedId = rel.targetId
          else if (rel.targetId === selectedId) linkedId = rel.sourceId
          if (linkedId) {
            const linkedRegion = regions.find(r => r.id === linkedId)
            if (linkedRegion) {
              const linkedPts = opts.getTerritory(linkedRegion)
              if (linkedPts.length >= 3) {
                ctx.save()
                ctx.beginPath()
                ctx.moveTo(linkedPts[0].x, linkedPts[0].y)
                for (let k = 1; k < linkedPts.length; k++) ctx.lineTo(linkedPts[k].x, linkedPts[k].y)
                ctx.closePath()
                ctx.strokeStyle = '#FFD700'
                ctx.lineWidth = 3
                ctx.shadowColor = '#FFD700'
                ctx.shadowBlur = 8
                ctx.stroke()
                ctx.restore()
              }
            }
          }
        }
      }
    }

    // === 接壤选择模式高亮 ===
    if (opts.adjoinSelectMode.value) {
      for (const r of regions) {
        if (!opts.adjoinSelectedIds.value.has(r.id)) continue
        const pts = opts.getTerritory(r)
        if (pts.length < 3) continue
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
        ctx.closePath()
        ctx.setLineDash([6, 3])
        ctx.strokeStyle = '#2ecc71'
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
      const srcPts = opts.adjoinSourceRegion.value ? opts.getTerritory(opts.adjoinSourceRegion.value) : []
      if (srcPts.length >= 3) {
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(srcPts[0].x, srcPts[0].y)
        for (let k = 1; k < srcPts.length; k++) ctx.lineTo(srcPts[k].x, srcPts[k].y)
        ctx.closePath()
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = '#e74c3c'
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
    }

    // === 偏移模式：边境线节点 ===
    if (opts.eraseMode.value === 'offset' && opts.eraseBorderVertices.value.length > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(opts.eraseBorderVertices.value[0].x, opts.eraseBorderVertices.value[0].y)
      for (let i = 1; i < opts.eraseBorderVertices.value.length; i++) {
        ctx.lineTo(opts.eraseBorderVertices.value[i].x, opts.eraseBorderVertices.value[i].y)
      }
      ctx.strokeStyle = '#e74c3c'
      ctx.lineWidth = 3
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])
      for (let i = 0; i < opts.eraseBorderVertices.value.length; i++) {
        const p = opts.eraseBorderVertices.value[i]
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = opts.eraseBorderFixedIndices.value.includes(i) ? '#999' : '#e74c3c'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.restore()
    }

    // === 重划模式：预览折线 ===
    if (opts.eraseMode.value === 'redraw' && opts.eraseRedrawPath.value.length > 1) {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(opts.eraseRedrawPath.value[0].x, opts.eraseRedrawPath.value[0].y)
      for (let i = 1; i < opts.eraseRedrawPath.value.length; i++) {
        ctx.lineTo(opts.eraseRedrawPath.value[i].x, opts.eraseRedrawPath.value[i].y)
      }
      ctx.strokeStyle = '#3498db'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()
    }

    // === 绘制模式：预览折线 ===
    if (opts.drawingPath.value.length > 1) {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(opts.drawingPath.value[0].x, opts.drawingPath.value[0].y)
      for (let i = 1; i < opts.drawingPath.value.length; i++) {
        ctx.lineTo(opts.drawingPath.value[i].x, opts.drawingPath.value[i].y)
      }
      ctx.strokeStyle = '#e74c3c'
      ctx.lineWidth = 3
      ctx.stroke()

      // 接近闭合时显示填充预览
      if (opts.drawingPath.value.length > 3) {
        ctx.beginPath()
        ctx.moveTo(opts.drawingPath.value[0].x, opts.drawingPath.value[0].y)
        for (let i = 1; i < opts.drawingPath.value.length; i++) {
          ctx.lineTo(opts.drawingPath.value[i].x, opts.drawingPath.value[i].y)
        }
        ctx.closePath()
        ctx.fillStyle = 'rgba(231,76,60,0.08)'
        ctx.fill()
      }
      ctx.restore()
    }

    ctx.restore()

    // === 图例（动态：从实际区域收集类型） ===
    const seenTypes = new Set<string>()
    const legendItems: { type: string; color: string }[] = []
    for (const r of regions) {
      const rt = r.properties?.regionType || '区域'
      if (!seenTypes.has(rt)) {
        seenTypes.add(rt)
        legendItems.push({ type: rt, color: opts.regionColor(r) })
      }
    }
    if (legendItems.length > 0) {
      ctx.fillStyle = 'rgba(245,236,215,0.9)'
      ctx.strokeStyle = '#c4a95a'
      ctx.lineWidth = 1
      const lh = legendItems.length * 18 + 10
      roundedRect(ctx, rect.width - 140, 8, 130, lh, 4)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#3a2a1a'
      ctx.font = '10px Georgia, serif'
      let ly = 14
      for (const item of legendItems) {
        ctx.fillStyle = item.color
        ctx.fillRect(rect.width - 132, ly + 1, 8, 8)
        ctx.fillStyle = '#3a2a1a'
        ctx.fillText(item.type.length > 8 ? item.type.slice(0, 7) + '..' : item.type, rect.width - 120, ly + 1)
        ly += 18
      }
    }
  }

  return { draw }
}

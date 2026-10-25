/**
 * motionMath —— 区域运动坐标数学（2026-10-25 形象图批 D4）。
 *
 * 区域百分比统一相对「图面显示区」（object-fit contain 的内容区，不含 letterbox）：
 * 渲染层 clip-path 相对元素盒（含留白），编辑器画布盒比例又与渲染容器不同——两侧都经
 * 显示区换算（displayBox = 图内容在盒内的偏移与尺寸，均为盒百分比）才能像素对齐。
 */
import type { MotionRegion } from '../types/entity'

/** 图内容在容器盒内的位置（全部为盒百分比） */
export interface DisplayBox {
  /** 内容区左上角偏移 */
  oX: number
  oY: number
  /** 内容区尺寸 */
  dW: number
  dH: number
}

/** 图原始尺寸 + 容器尺寸 → 显示区（contain 的 letterbox 补偿） */
export function computeDisplayBox(naturalW: number, naturalH: number, boxW: number, boxH: number): DisplayBox {
  if (!naturalW || !naturalH || !boxW || !boxH) return { oX: 0, oY: 0, dW: 100, dH: 100 }
  const scale = Math.min(boxW / naturalW, boxH / naturalH)
  const w = (naturalW * scale) / boxW * 100
  const h = (naturalH * scale) / boxH * 100
  return { oX: (100 - w) / 2, oY: (100 - h) / 2, dW: w, dH: h }
}

/** 图面区域 → 渲染层 clip-path inset(top right bottom left)（盒百分比） */
export function regionToClip(r: MotionRegion, box: DisplayBox): string {
  const left = box.oX + r.x * box.dW / 100
  const top = box.oY + r.y * box.dH / 100
  const right = 100 - (box.oX + (r.x + r.w) * box.dW / 100)
  const bottom = 100 - (box.oY + (r.y + r.h) * box.dH / 100)
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`
}

/** 盒内点（盒百分比）→ 图面区域坐标（图面百分比）；出界钳 0-100 */
export function boxPointToRegion(px: number, py: number, box: DisplayBox): { x: number; y: number } {
  const x = ((px - box.oX) / box.dW) * 100
  const y = ((py - box.oY) / box.dH) * 100
  return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
}

// ── E 批多关键帧：轨迹 → WAAPI 关键帧序列（单段/多帧统一换算，可纯函数测试） ──
import type { MotionTrack, MotionKeyframe } from '../types/entity'

function kfTransform(k: Pick<MotionKeyframe, 'dx' | 'dy' | 'rotate' | 'scale'>): string {
  const parts = [`translate(${k.dx ?? 0}%, ${k.dy ?? 0}%)`]
  if (k.rotate) parts.push(`rotate(${k.rotate}deg)`)
  if (k.scale && k.scale !== 1) parts.push(`scale(${k.scale})`) // 1 为恒等，省略
  return parts.join(' ')
}

/**
 * 轨迹 → WAAPI 关键帧数组（offset 0-1）：
 * - 有 keyframes：按 t 升序，t=0 恒等帧自动补，offset=t/duration（末帧不足 1 由 fill 承接）
 * - 无 keyframes：单段两帧（0 恒等 → 1 终值）——D3 数据等价路径
 * duration ≤0 防御回退单帧恒等。
 */
export function trackToKeyframes(track: MotionTrack): { offset: number; transform: string }[] {
  const dur = Math.max(0.1, track.duration)
  if (Array.isArray(track.keyframes) && track.keyframes.length) {
    const sorted = [...track.keyframes].sort((a, b) => a.t - b.t)
    const out: { offset: number; transform: string }[] = []
    if (sorted[0].t > 0) out.push({ offset: 0, transform: 'translate(0%, 0%)' })
    for (const k of sorted) {
      out.push({ offset: Math.max(0, Math.min(1, k.t / dur)), transform: kfTransform(k) })
    }
    return out
  }
  return [
    { offset: 0, transform: 'translate(0%, 0%)' },
    { offset: 1, transform: kfTransform(track) },
  ]
}
